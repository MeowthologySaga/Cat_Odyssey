import { HERO_BY_ID, STAGE_BY_ID } from "../../data";
import type { GameSaveV1 } from "../../state";
import { normalizeMetaSave } from "./compat";
import { readPendingEndgameVictorySettlement } from "./endgameVictorySettlement";

export type BattleRewardMode = "campaign" | "oracleTower" | "stormRoute" | "scyllaRaid";

export interface BattleRewardTicket {
  readonly token: number;
  readonly stageId: string;
  readonly mode: BattleRewardMode;
}

export interface BeginBattleRewardTicketSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly ticket: BattleRewardTicket;
}

export interface BattleRewardTicketFailure {
  readonly ok: false;
  readonly code:
    | "unknown_stage"
    | "ticket_missing"
    | "ticket_mismatch"
    | "battle_run_conflict"
    | "pending_victory_settlement";
  readonly message: string;
  readonly save: GameSaveV1;
}

export type BeginBattleRewardTicketResult =
  | BeginBattleRewardTicketSuccess
  | BattleRewardTicketFailure;

export type CommitBattleRewardTicketResult = BeginBattleRewardTicketResult;

const SEQUENCE_KEY = "__meta:battle-reward-sequence";
const PENDING_PREFIX = "__meta:battle-reward-pending:";
const COMMITTED_PREFIX = "__meta:battle-reward-committed:";

export function battleRewardMode(
  endgameMode?: Exclude<BattleRewardMode, "campaign">,
): BattleRewardMode {
  return endgameMode ?? "campaign";
}

export function beginBattleRewardTicket(
  input: GameSaveV1,
  stageId: string,
  mode: BattleRewardMode,
): BeginBattleRewardTicketResult {
  const save = normalizeMetaSave(input);
  if (!STAGE_BY_ID[stageId]) {
    return { ok: false, code: "unknown_stage", message: `Unknown stage: ${stageId}`, save };
  }
  const pendingVictory = save.recovery.pendingCampaignVictorySettlement;
  if (
    pendingVictory?.version === 1
    && Boolean(STAGE_BY_ID[pendingVictory.stageId])
    && pendingVictory.rewardTicketToken > 0
    && Number.isInteger(pendingVictory.stars)
    && pendingVictory.stars >= 1
    && pendingVictory.stars <= 3
    && Number.isInteger(pendingVictory.turns)
    && pendingVictory.turns >= 1
    && Number.isInteger(pendingVictory.bestCombo)
    && pendingVictory.bestCombo >= 0
    && Number.isInteger(pendingVictory.totalDamage)
    && pendingVictory.totalDamage >= 0
    && Number.isFinite(pendingVictory.hpRatio)
    && pendingVictory.hpRatio >= 0
    && pendingVictory.hpRatio <= 1
    && Number.isInteger(pendingVictory.wonAt)
    && pendingVictory.wonAt >= 1
    && pendingVictory.partyHeroIds.length >= 1
    && pendingVictory.partyHeroIds.length <= 3
    && new Set(pendingVictory.partyHeroIds).size === pendingVictory.partyHeroIds.length
    && pendingVictory.partyHeroIds.every(
      (heroId) => Boolean(HERO_BY_ID[heroId]) && save.roster.ownedHeroIds.includes(heroId),
    )
    && pendingVictory.fallenHeroIds.every((heroId) => pendingVictory.partyHeroIds.includes(heroId))
    && Math.floor(save.endgame.bossAffinity[pendingKey(pendingVictory.stageId, "campaign")] ?? 0)
      === pendingVictory.rewardTicketToken
  ) {
    return {
      ok: false,
      code: "pending_victory_settlement",
      message: "A campaign victory must be settled before starting another battle.",
      save,
    };
  }
  const pendingEndgameVictory = readPendingEndgameVictorySettlement(save);
  if (pendingEndgameVictory) {
    return {
      ok: false,
      code: "pending_victory_settlement",
      message: "An endgame victory must be settled before starting another battle.",
      save,
    };
  }
  const pendingTickets = readPendingBattleRewardTickets(save);
  const matchingTicket = pendingTickets.find(
    (ticket) => ticket.stageId === stageId && ticket.mode === mode,
  );
  if (matchingTicket && pendingTickets.length === 1) {
    return { ok: true, save, ticket: matchingTicket };
  }
  if (pendingTickets.length > 0) {
    return {
      ok: false,
      code: "battle_run_conflict",
      message: "Another battle run must be explicitly abandoned before starting a new one.",
      save,
    };
  }
  const previous = Math.max(0, Math.floor(save.endgame.bossAffinity[SEQUENCE_KEY] ?? 0));
  const token = previous >= Number.MAX_SAFE_INTEGER - 1 ? 1 : previous + 1;
  const ticket = { token, stageId, mode } satisfies BattleRewardTicket;
  save.endgame.bossAffinity[SEQUENCE_KEY] = token;
  save.endgame.bossAffinity[pendingKey(stageId, mode)] = token;
  return { ok: true, save, ticket };
}

export function readPendingBattleRewardTicket(
  input: GameSaveV1,
  stageId: string,
  mode: BattleRewardMode,
): BattleRewardTicket | undefined {
  const token = Math.floor(input.endgame.bossAffinity[pendingKey(stageId, mode)] ?? 0);
  return token > 0 ? { token, stageId, mode } : undefined;
}

/** Returns every live ticket without mutating or silently choosing one. */
export function readPendingBattleRewardTickets(input: GameSaveV1): BattleRewardTicket[] {
  return Object.entries(input.endgame.bossAffinity).flatMap(([key, rawToken]) => {
    if (!key.startsWith(PENDING_PREFIX)) return [];
    const remainder = key.slice(PENDING_PREFIX.length);
    const separator = remainder.indexOf(":");
    if (separator < 1) return [];
    const mode = remainder.slice(0, separator);
    const stageId = remainder.slice(separator + 1);
    const token = Math.floor(rawToken ?? 0);
    if (
      (mode !== "campaign" && mode !== "oracleTower" && mode !== "stormRoute" && mode !== "scyllaRaid")
      || !STAGE_BY_ID[stageId]
      || token < 1
    ) return [];
    return [{ token, stageId, mode } satisfies BattleRewardTicket];
  }).sort((left, right) => right.token - left.token);
}

/**
 * Clears all unfinished ticket/checkpoint authority only after the UI obtained
 * explicit player confirmation. A pending victory is never abandonable here.
 */
export function abandonPendingBattleRun(input: GameSaveV1): GameSaveV1 {
  if (
    input.recovery.pendingCampaignVictorySettlement
    || readPendingEndgameVictorySettlement(input)
  ) {
    throw new Error("A pending victory must be settled, not abandoned.");
  }
  const save = normalizeMetaSave(input);
  // A malformed/outdated endgame hand-off has no reward authority and must not
  // strand the player behind an un-abandonable ticket conflict.
  save.recovery.pendingEndgameVictorySettlement = null;
  for (const key of Object.keys(save.endgame.bossAffinity)) {
    if (key.startsWith(PENDING_PREFIX)) delete save.endgame.bossAffinity[key];
  }
  save.recovery.activeCampaignBattle = null;
  return save;
}

export function commitBattleRewardTicket(
  input: GameSaveV1,
  ticket: BattleRewardTicket,
): CommitBattleRewardTicketResult {
  const save = normalizeMetaSave(input);
  const key = pendingKey(ticket.stageId, ticket.mode);
  const pendingToken = Math.floor(save.endgame.bossAffinity[key] ?? 0);
  if (pendingToken <= 0) {
    return {
      ok: false,
      code: "ticket_missing",
      message: "Battle reward ticket is missing or was already committed.",
      save,
    };
  }
  if (pendingToken !== ticket.token) {
    return {
      ok: false,
      code: "ticket_mismatch",
      message: "Battle reward ticket does not match the current battle.",
      save,
    };
  }
  delete save.endgame.bossAffinity[key];
  save.endgame.bossAffinity[committedKey(ticket.stageId, ticket.mode)] = ticket.token;
  return { ok: true, save, ticket };
}

export function wasBattleRewardCommitted(
  input: GameSaveV1,
  stageId: string,
  mode: BattleRewardMode,
): boolean {
  return (input.endgame.bossAffinity[committedKey(stageId, mode)] ?? 0) > 0
    && !readPendingBattleRewardTicket(input, stageId, mode);
}

function pendingKey(stageId: string, mode: BattleRewardMode): string {
  return `${PENDING_PREFIX}${mode}:${stageId}`;
}

function committedKey(stageId: string, mode: BattleRewardMode): string {
  return `${COMMITTED_PREFIX}${mode}:${stageId}`;
}
