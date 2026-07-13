import {
  BLESSINGS,
  ENEMY_BEHAVIOR_BY_ID,
  ENEMY_BY_ID,
  ENDGAME,
  HERO_BY_ID,
  RELIC_BY_ID,
  STAGE_BY_ID,
} from "../../data";
import {
  cloneSave,
  type EndgameVictoryMode,
  type GameSaveV1,
  type PendingEndgameVictorySettlement,
} from "../../state/saveSchema";
import { BATTLE_SNAPSHOT_VERSION } from "../battle";
import {
  commitBattleRewardTicket,
  readPendingBattleRewardTicket,
  type BattleRewardTicket,
} from "./battleRewardTickets";
import { normalizeMetaSave } from "./compat";
import {
  advanceScyllaAffinity,
  getCurrentScyllaSquad,
  getCurrentStormNode,
  getScyllaRaidClearCount,
  getScyllaRaidRewardHeroIds,
  getStormNodeStageId,
  grantEndgameStageRewards,
  lockOraclePartyAfterVictory,
  settleScyllaRaidPhase,
  settleStormBattleVictory,
} from "./endgameLoop";
import type { StageRewardReceipt } from "./rewards";

export const ENDGAME_VICTORY_SETTLEMENT_VERSION = 1 as const;

export interface EndgameVictoryMetrics {
  readonly mode: EndgameVictoryMode;
  readonly stageId: string;
  readonly stars: 1 | 2 | 3;
  readonly turns: number;
  readonly bestCombo: number;
  readonly totalDamage: number;
  readonly hpRatio: number;
  readonly partyHeroIds: readonly string[];
  readonly fallenHeroIds: readonly string[];
  readonly weeklyScoreEnabled?: boolean;
}

export interface EndgameVictorySettlementFailure {
  readonly ok: false;
  readonly code:
    | "unknown_stage"
    | "invalid_metrics"
    | "invalid_endgame_context"
    | "ticket_missing"
    | "ticket_mismatch"
    | "settlement_conflict"
    | "settlement_missing"
    | "reward_failed";
  readonly message: string;
  readonly save: GameSaveV1;
}

export interface PrepareEndgameVictorySettlementSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly settlement: PendingEndgameVictorySettlement;
}

export type PrepareEndgameVictorySettlementResult =
  | PrepareEndgameVictorySettlementSuccess
  | EndgameVictorySettlementFailure;

export interface SettleEndgameVictorySuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly settlement: PendingEndgameVictorySettlement;
  readonly ticket: BattleRewardTicket;
  readonly stars: 1 | 2 | 3;
  readonly rewards: StageRewardReceipt;
  readonly raidNextPhase?: number;
}

export type SettleEndgameVictoryResult =
  | SettleEndgameVictorySuccess
  | EndgameVictorySettlementFailure;

interface EndgameContext {
  readonly contextIndex: number;
  readonly runOrdinal: number;
  readonly stormWeekId: number | null;
  readonly scyllaPhaseIndex: 0 | 1 | 2 | null;
  readonly weeklyScoreEnabled: boolean;
  readonly rewardHeroIds: readonly string[];
}

/** Freeze the endgame reward authority before BattleScene is allowed to leave. */
export function prepareEndgameVictorySettlement(
  input: GameSaveV1,
  metrics: EndgameVictoryMetrics,
  wonAt = Date.now(),
): PrepareEndgameVictorySettlementResult {
  const save = normalizeMetaSave(input);
  if (!STAGE_BY_ID[metrics.stageId]) {
    return failure(save, "unknown_stage", `Unknown stage: ${metrics.stageId}`);
  }
  if (save.recovery.pendingCampaignVictorySettlement) {
    return failure(save, "settlement_conflict", "A campaign victory is already awaiting settlement.");
  }
  const existing = readPendingEndgameVictorySettlement(save);
  if (existing) {
    if (existing.mode === metrics.mode && existing.stageId === metrics.stageId) {
      return { ok: true, save, settlement: existing };
    }
    return failure(save, "settlement_conflict", "Another endgame victory is awaiting settlement.");
  }

  const ticket = readPendingBattleRewardTicket(save, metrics.stageId, metrics.mode);
  if (!ticket) {
    return failure(save, "ticket_missing", "The endgame battle reward ticket is missing.");
  }
  const context = resolveEndgameContext(save, metrics.mode, metrics.stageId);
  if (!context) {
    return failure(save, "invalid_endgame_context", "The endgame run no longer matches this victory.");
  }

  const partyHeroIds = unique(metrics.partyHeroIds);
  const fallenHeroIds = unique(metrics.fallenHeroIds);
  const maximumPartySize = metrics.mode === "scyllaRaid" ? 4 : 3;
  const validPartySize = metrics.mode === "stormRoute"
    ? partyHeroIds.length === 3
    : partyHeroIds.length >= 1 && partyHeroIds.length <= maximumPartySize;
  if (
    !validPartySize
    || partyHeroIds.some((heroId) => !HERO_BY_ID[heroId] || !save.roster.ownedHeroIds.includes(heroId))
    || fallenHeroIds.some((heroId) => !partyHeroIds.includes(heroId))
    || (metrics.mode === "scyllaRaid"
      && context.rewardHeroIds.length !== ENDGAME.raid.partiesRequired * ENDGAME.raid.heroesPerParty)
    || (metrics.mode === "scyllaRaid" && !sameStrings(partyHeroIds, getCurrentScyllaSquad(save)))
    || (metrics.mode === "stormRoute" && !sameStrings(partyHeroIds, save.endgame.stormRoute.partyHeroIds))
    || !Number.isInteger(metrics.stars)
    || metrics.stars < 1
    || metrics.stars > 3
    || !finiteNonNegative(metrics.turns)
    || !finiteNonNegative(metrics.bestCombo)
    || !finiteNonNegative(metrics.totalDamage)
    || !Number.isFinite(metrics.hpRatio)
    || metrics.hpRatio < 0
    || metrics.hpRatio > 1
    || !Number.isFinite(wonAt)
  ) {
    return failure(save, "invalid_metrics", "Endgame victory metrics are invalid.");
  }

  const settlement: PendingEndgameVictorySettlement = {
    version: ENDGAME_VICTORY_SETTLEMENT_VERSION,
    mode: metrics.mode,
    stageId: metrics.stageId,
    rewardTicketToken: ticket.token,
    stars: metrics.stars,
    turns: Math.max(1, Math.floor(metrics.turns)),
    bestCombo: Math.floor(metrics.bestCombo),
    totalDamage: Math.floor(metrics.totalDamage),
    hpRatio: metrics.hpRatio,
    partyHeroIds,
    fallenHeroIds,
    rewardHeroIds: metrics.mode === "scyllaRaid" ? [...context.rewardHeroIds] : [...partyHeroIds],
    // The authored storm node is authoritative; stale scene data cannot opt in.
    weeklyScoreEnabled: context.weeklyScoreEnabled,
    contextIndex: context.contextIndex,
    runOrdinal: context.runOrdinal,
    stormWeekId: context.stormWeekId,
    scyllaPhaseIndex: context.scyllaPhaseIndex,
    contentRevision: endgameVictoryContentRevision(metrics.stageId, metrics.mode),
    runStateRevision: endgameVictoryRunStateRevision(save, metrics.mode),
    wonAt: Math.max(1, Math.floor(wonAt)),
  };
  save.recovery.pendingEndgameVictorySettlement = settlement;
  return { ok: true, save, settlement: cloneSettlement(settlement) };
}

/** Returns only a ticket-backed settlement for the unchanged authored run. */
export function readPendingEndgameVictorySettlement(
  save: GameSaveV1,
): PendingEndgameVictorySettlement | undefined {
  const settlement = save.recovery.pendingEndgameVictorySettlement;
  if (!settlement || settlement.version !== ENDGAME_VICTORY_SETTLEMENT_VERSION) return undefined;
  if (!STAGE_BY_ID[settlement.stageId]) return undefined;
  const maximumPartySize = settlement.mode === "scyllaRaid" ? 4 : 3;
  if (
    !validMode(settlement.mode)
    || !Number.isInteger(settlement.rewardTicketToken)
    || settlement.rewardTicketToken < 1
    || !Number.isInteger(settlement.stars)
    || settlement.stars < 1
    || settlement.stars > 3
    || !Number.isInteger(settlement.turns)
    || settlement.turns < 1
    || !Number.isInteger(settlement.bestCombo)
    || settlement.bestCombo < 0
    || !Number.isInteger(settlement.totalDamage)
    || settlement.totalDamage < 0
    || !Number.isFinite(settlement.hpRatio)
    || settlement.hpRatio < 0
    || settlement.hpRatio > 1
    || !Number.isInteger(settlement.contextIndex)
    || settlement.contextIndex < 0
    || !Number.isInteger(settlement.runOrdinal)
    || settlement.runOrdinal < 0
    || !Number.isInteger(settlement.wonAt)
    || settlement.wonAt < 1
    || settlement.partyHeroIds.length < 1
    || settlement.partyHeroIds.length > maximumPartySize
    || (settlement.mode === "stormRoute" && settlement.partyHeroIds.length !== 3)
    || new Set(settlement.partyHeroIds).size !== settlement.partyHeroIds.length
    || settlement.partyHeroIds.some((heroId) => !HERO_BY_ID[heroId] || !save.roster.ownedHeroIds.includes(heroId))
    || settlement.fallenHeroIds.some((heroId) => !settlement.partyHeroIds.includes(heroId))
    || new Set(settlement.fallenHeroIds).size !== settlement.fallenHeroIds.length
    || settlement.rewardHeroIds.length < 1
    || settlement.rewardHeroIds.length > 12
    || new Set(settlement.rewardHeroIds).size !== settlement.rewardHeroIds.length
    || settlement.rewardHeroIds.some((heroId) => !HERO_BY_ID[heroId] || !save.roster.ownedHeroIds.includes(heroId))
    || !settlement.contentRevision
    || !settlement.runStateRevision
  ) return undefined;

  const context = resolveEndgameContext(save, settlement.mode, settlement.stageId);
  if (
    !context
    || context.contextIndex !== settlement.contextIndex
    || context.runOrdinal !== settlement.runOrdinal
    || context.stormWeekId !== settlement.stormWeekId
    || context.scyllaPhaseIndex !== settlement.scyllaPhaseIndex
    || context.weeklyScoreEnabled !== settlement.weeklyScoreEnabled
    || !sameStrings(
      settlement.mode === "scyllaRaid" ? context.rewardHeroIds : settlement.partyHeroIds,
      settlement.rewardHeroIds,
    )
    || (settlement.mode === "scyllaRaid" && !sameStrings(settlement.partyHeroIds, getCurrentScyllaSquad(save)))
    || (settlement.mode === "stormRoute" && !sameStrings(settlement.partyHeroIds, save.endgame.stormRoute.partyHeroIds))
    || settlement.contentRevision !== endgameVictoryContentRevision(settlement.stageId, settlement.mode)
    || settlement.runStateRevision !== endgameVictoryRunStateRevision(save, settlement.mode)
  ) return undefined;
  const ticket = readPendingBattleRewardTicket(save, settlement.stageId, settlement.mode);
  if (!ticket || ticket.token !== settlement.rewardTicketToken) return undefined;
  return cloneSettlement(settlement);
}

/** Pure exactly-once reward, progression, ticket, and settlement transaction. */
export function settlePendingEndgameVictory(
  input: GameSaveV1,
): SettleEndgameVictoryResult {
  const settlement = readPendingEndgameVictorySettlement(input);
  const original = normalizeMetaSave(input);
  if (!settlement) {
    return failure(original, "settlement_missing", "No recoverable endgame victory settlement exists.");
  }
  const ticket = readPendingBattleRewardTicket(input, settlement.stageId, settlement.mode);
  if (!ticket) return failure(original, "ticket_missing", "The endgame reward ticket is missing.");
  if (ticket.token !== settlement.rewardTicketToken) {
    return failure(original, "ticket_mismatch", "The endgame victory ticket no longer matches.");
  }

  try {
    if (settlement.mode === "scyllaRaid" && settlement.scyllaPhaseIndex !== null && settlement.scyllaPhaseIndex < 2) {
      const phase = settleScyllaRaidPhase(input);
      let save = phase.save;
      applyVictoryRecords(save, settlement);
      const committed = commitBattleRewardTicket(save, ticket);
      if (!committed.ok) return failure(
        original,
        committed.code === "ticket_mismatch" ? "ticket_mismatch" : "ticket_missing",
        committed.message,
      );
      save = committed.save;
      save.recovery.pendingEndgameVictorySettlement = null;
      const rewards: StageRewardReceipt = {
        gold: 0,
        heroXp: 0,
        heroXpHeroIds: [],
        heroProgress: [],
        materials: {},
        storyHeroes: [],
        endgameLabel: `스킬라 ${settlement.scyllaPhaseIndex + 1}페이즈 돌파`,
      };
      return {
        ok: true,
        save,
        settlement,
        ticket,
        stars: settlement.stars,
        rewards,
        raidNextPhase: phase.nextPhaseIndex,
      };
    }

    const granted = grantEndgameStageRewards(input, {
      mode: settlement.mode,
      stageId: settlement.stageId,
      partyHeroIds: settlement.rewardHeroIds,
    });
    if (!granted.ok) return failure(original, "reward_failed", granted.message);
    let save = granted.save;
    let rewards = granted.rewards;
    applyVictoryRecords(save, settlement);
    if (settlement.mode === "oracleTower") {
      save = lockOraclePartyAfterVictory(save, settlement.partyHeroIds);
      save.endgame.oracleTowerFloor = Math.min(30, save.endgame.oracleTowerFloor + 1);
    } else if (settlement.mode === "stormRoute") {
      const storm = settleStormBattleVictory(
        save,
        settlement.fallenHeroIds,
        settlement.weeklyScoreEnabled ? settlement.totalDamage : 0,
      );
      save = storm.save;
      if (storm.weeklyScore > 0) {
        const tierText = storm.scoreRewards.length
          ? ` · 점수 보상 ${storm.scoreRewards.map((tier) => tier.label).join(" · ")}`
          : "";
        rewards = {
          ...rewards,
          endgameLabel: `${rewards.endgameLabel ?? "폭풍 항로"} · 주간 점수 ${storm.weeklyScore.toLocaleString()}${tierText}`,
        };
      }
    } else {
      save = settleScyllaRaidPhase(save).save;
      const affinity = advanceScyllaAffinity(save);
      save = affinity.save;
      const milestoneText = affinity.milestones.length
        ? ` · ${affinity.milestones.map((milestone) => milestone.label).join(" · ")}`
        : "";
      rewards = {
        ...rewards,
        endgameLabel: `${rewards.endgameLabel ?? "스킬라 토벌"} · 항해 인연 ${affinity.level}/99${milestoneText}`,
      };
    }

    const committed = commitBattleRewardTicket(save, ticket);
    if (!committed.ok) return failure(
      original,
      committed.code === "ticket_mismatch" ? "ticket_mismatch" : "ticket_missing",
      committed.message,
    );
    save = committed.save;
    save.recovery.pendingEndgameVictorySettlement = null;
    return {
      ok: true,
      save,
      settlement,
      ticket,
      stars: settlement.stars,
      rewards,
    };
  } catch (error) {
    return failure(
      original,
      "reward_failed",
      error instanceof Error ? error.message : "Endgame reward settlement failed.",
    );
  }
}

export function clearPendingEndgameVictorySettlement(input: GameSaveV1): GameSaveV1 {
  if (!input.recovery.pendingEndgameVictorySettlement) return input;
  const save = cloneSave(input);
  save.recovery.pendingEndgameVictorySettlement = null;
  return save;
}

export function sanitizePendingEndgameVictorySettlement(input: GameSaveV1): GameSaveV1 {
  if (!input.recovery.pendingEndgameVictorySettlement || readPendingEndgameVictorySettlement(input)) return input;
  return clearPendingEndgameVictorySettlement(input);
}

/** Compatibility fingerprint, not a security primitive. */
export function endgameVictoryContentRevision(stageId: string, mode: EndgameVictoryMode): string {
  return fingerprint({
    version: ENDGAME_VICTORY_SETTLEMENT_VERSION,
    snapshotVersion: BATTLE_SNAPSHOT_VERSION,
    mode,
    stage: STAGE_BY_ID[stageId] ?? null,
    enemies: ENEMY_BY_ID,
    behaviors: ENEMY_BEHAVIOR_BY_ID,
    heroes: HERO_BY_ID,
    relics: RELIC_BY_ID,
    blessings: BLESSINGS,
    endgame: ENDGAME,
  });
}

export function endgameVictoryRunStateRevision(save: GameSaveV1, mode: EndgameVictoryMode): string {
  if (mode === "oracleTower") {
    return fingerprint({
      floor: save.endgame.oracleTowerFloor,
      locks: save.endgame.oracleHeroLockUntilFloor,
    });
  }
  if (mode === "stormRoute") {
    return fingerprint({
      weeklyRuns: save.endgame.weeklyStormRuns,
      route: save.endgame.stormRoute,
      markers: relevantAffinity(save, "storm"),
    });
  }
  return fingerprint({
    raidKeys: save.endgame.raidKeys,
    raid: save.endgame.scyllaRaid,
    markers: relevantAffinity(save, "scylla"),
  });
}

function resolveEndgameContext(
  save: GameSaveV1,
  mode: EndgameVictoryMode,
  stageId: string,
): EndgameContext | undefined {
  if (mode === "oracleTower") {
    const floorIndex = Math.min(29, Math.max(0, save.endgame.oracleTowerFloor));
    if (ENDGAME.oracleTower.floors[floorIndex]?.stageId !== stageId) return undefined;
    return {
      contextIndex: floorIndex,
      runOrdinal: Math.max(0, Math.floor(save.endgame.oracleTowerFloor)),
      stormWeekId: null,
      scyllaPhaseIndex: null,
      weeklyScoreEnabled: false,
      rewardHeroIds: [], // replaced by the deployed party below
    };
  }
  if (mode === "stormRoute") {
    const node = getCurrentStormNode(save);
    if (!save.endgame.stormRoute.active || node.rewardScale <= 0 || getStormNodeStageId(save) !== stageId) return undefined;
    return {
      contextIndex: save.endgame.stormRoute.nodeIndex,
      runOrdinal: save.endgame.weeklyStormRuns,
      stormWeekId: save.endgame.stormRoute.weekId,
      scyllaPhaseIndex: null,
      weeklyScoreEnabled: node.rules.includes("weekly-score-enabled"),
      rewardHeroIds: [...save.endgame.stormRoute.partyHeroIds],
    };
  }
  const phaseIndex = Math.min(2, Math.max(0, save.endgame.scyllaRaid.phaseIndex)) as 0 | 1 | 2;
  if (!save.endgame.scyllaRaid.active || stageId !== "r08-s05") return undefined;
  return {
    contextIndex: phaseIndex,
    runOrdinal: getScyllaRaidClearCount(save),
    stormWeekId: null,
    scyllaPhaseIndex: phaseIndex,
    weeklyScoreEnabled: false,
    rewardHeroIds: [...getScyllaRaidRewardHeroIds(save)],
  };
}

function applyVictoryRecords(save: GameSaveV1, settlement: PendingEndgameVictorySettlement): void {
  save.records.wins += 1;
  save.records.bestRicochetChain = Math.max(save.records.bestRicochetChain, settlement.bestCombo);
  save.records.totalDamage += settlement.totalDamage;
  save.records.lastPlayedAt = settlement.wonAt;
}

function cloneSettlement(settlement: PendingEndgameVictorySettlement): PendingEndgameVictorySettlement {
  return {
    ...settlement,
    partyHeroIds: [...settlement.partyHeroIds],
    fallenHeroIds: [...settlement.fallenHeroIds],
    rewardHeroIds: [...settlement.rewardHeroIds],
  };
}

function failure(
  save: GameSaveV1,
  code: EndgameVictorySettlementFailure["code"],
  message: string,
): EndgameVictorySettlementFailure {
  return { ok: false, code, message, save };
}

function relevantAffinity(save: GameSaveV1, kind: "storm" | "scylla"): Record<string, number> {
  return Object.fromEntries(Object.entries(save.endgame.bossAffinity).filter(([key]) => (
    kind === "storm"
      ? key.includes("storm")
      : key.includes("scylla") || key === "scylla-cat"
  )));
}

function fingerprint(value: unknown): string {
  const payload = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function validMode(value: unknown): value is EndgameVictoryMode {
  return value === "oracleTower" || value === "stormRoute" || value === "scyllaRaid";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
