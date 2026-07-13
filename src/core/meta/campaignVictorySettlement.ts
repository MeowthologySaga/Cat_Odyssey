import { HERO_BY_ID, STAGE_BY_ID } from "../../data";
import {
  cloneSave,
  type GameSaveV1,
  type PendingCampaignVictorySettlement,
} from "../../state/saveSchema";
import {
  commitBattleRewardTicket,
  readPendingBattleRewardTicket,
  type BattleRewardTicket,
} from "./battleRewardTickets";
import { normalizeMetaSave } from "./compat";
import {
  completeCampaignStageWithRewards,
  type StageRewardReceipt,
} from "./rewards";

export const CAMPAIGN_VICTORY_SETTLEMENT_VERSION = 1 as const;

export interface CampaignVictoryMetrics {
  readonly stageId: string;
  readonly stars: 1 | 2 | 3;
  readonly turns: number;
  readonly bestCombo: number;
  readonly totalDamage: number;
  readonly hpRatio: number;
  readonly partyHeroIds: readonly string[];
  readonly fallenHeroIds: readonly string[];
}

export interface CampaignVictorySettlementFailure {
  readonly ok: false;
  readonly code:
    | "unknown_stage"
    | "invalid_metrics"
    | "ticket_missing"
    | "ticket_mismatch"
    | "battle_run_conflict"
    | "pending_victory_settlement"
    | "settlement_missing"
    | "settlement_conflict"
    | "reward_failed";
  readonly message: string;
  readonly save: GameSaveV1;
}

export interface PrepareCampaignVictorySettlementSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly settlement: PendingCampaignVictorySettlement;
}

export type PrepareCampaignVictorySettlementResult =
  | PrepareCampaignVictorySettlementSuccess
  | CampaignVictorySettlementFailure;

export interface SettleCampaignVictorySuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly settlement: PendingCampaignVictorySettlement;
  readonly ticket: BattleRewardTicket;
  readonly stars: 1 | 2 | 3;
  readonly newlyUnlockedRouteId: string;
  readonly rewards: StageRewardReceipt;
}

export type SettleCampaignVictoryResult =
  | SettleCampaignVictorySuccess
  | CampaignVictorySettlementFailure;

/**
 * Installs the durable victory hand-off while deliberately retaining the last
 * quiet battle checkpoint. The checkpoint is removed only by the same atomic
 * save snapshot that grants rewards and commits the ticket.
 */
export function prepareCampaignVictorySettlement(
  input: GameSaveV1,
  metrics: CampaignVictoryMetrics,
  wonAt = Date.now(),
): PrepareCampaignVictorySettlementResult {
  const save = normalizeMetaSave(input);
  if (!STAGE_BY_ID[metrics.stageId]) {
    return failure(save, "unknown_stage", `Unknown stage: ${metrics.stageId}`);
  }
  if (save.recovery.pendingEndgameVictorySettlement) {
    return failure(save, "settlement_conflict", "An endgame victory is already awaiting settlement.");
  }

  const existing = readPendingCampaignVictorySettlement(save);
  if (existing) {
    if (existing.stageId === metrics.stageId) {
      return { ok: true, save, settlement: existing };
    }
    return failure(save, "settlement_conflict", "Another campaign victory is awaiting settlement.");
  }

  const ticket = readPendingBattleRewardTicket(save, metrics.stageId, "campaign");
  if (!ticket) {
    return failure(save, "ticket_missing", "The campaign battle reward ticket is missing.");
  }
  const partyHeroIds = unique(metrics.partyHeroIds);
  const fallenHeroIds = unique(metrics.fallenHeroIds);
  if (
    partyHeroIds.length < 1
    || partyHeroIds.length > 3
    || partyHeroIds.some((heroId) => !HERO_BY_ID[heroId] || !save.roster.ownedHeroIds.includes(heroId))
    || fallenHeroIds.some((heroId) => !partyHeroIds.includes(heroId))
    || !Number.isInteger(metrics.stars)
    || metrics.stars < 1
    || metrics.stars > 3
    || !finiteNonNegative(metrics.turns)
    || !finiteNonNegative(metrics.bestCombo)
    || !finiteNonNegative(metrics.totalDamage)
    || !Number.isFinite(metrics.hpRatio)
  ) {
    return failure(save, "invalid_metrics", "Campaign victory metrics are invalid.");
  }

  const settlement: PendingCampaignVictorySettlement = {
    version: CAMPAIGN_VICTORY_SETTLEMENT_VERSION,
    stageId: metrics.stageId,
    rewardTicketToken: ticket.token,
    stars: metrics.stars,
    turns: Math.max(1, Math.floor(metrics.turns)),
    bestCombo: Math.floor(metrics.bestCombo),
    totalDamage: Math.floor(metrics.totalDamage),
    hpRatio: Math.min(1, Math.max(0, metrics.hpRatio)),
    partyHeroIds,
    fallenHeroIds,
    wonAt: Math.max(1, Math.floor(wonAt)),
  };
  save.recovery.pendingCampaignVictorySettlement = settlement;
  return { ok: true, save, settlement: cloneSettlement(settlement) };
}

/** Returns only a fully authoritative campaign settlement. */
export function readPendingCampaignVictorySettlement(
  save: GameSaveV1,
): PendingCampaignVictorySettlement | undefined {
  const settlement = save.recovery.pendingCampaignVictorySettlement;
  if (!settlement || settlement.version !== CAMPAIGN_VICTORY_SETTLEMENT_VERSION) return undefined;
  if (!STAGE_BY_ID[settlement.stageId]) return undefined;
  if (
    !Number.isInteger(settlement.rewardTicketToken)
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
    || !Number.isInteger(settlement.wonAt)
    || settlement.wonAt < 1
    || settlement.partyHeroIds.length < 1
    || settlement.partyHeroIds.length > 3
    || new Set(settlement.partyHeroIds).size !== settlement.partyHeroIds.length
    || settlement.partyHeroIds.some((heroId) => !HERO_BY_ID[heroId] || !save.roster.ownedHeroIds.includes(heroId))
    || settlement.fallenHeroIds.some((heroId) => !settlement.partyHeroIds.includes(heroId))
  ) {
    return undefined;
  }
  const ticket = readPendingBattleRewardTicket(save, settlement.stageId, "campaign");
  if (!ticket || ticket.token !== settlement.rewardTicketToken) return undefined;
  return cloneSettlement(settlement);
}

/**
 * Pure, exactly-once settlement transaction. The caller persists `save` with
 * one GameSaveStore.replace/update call; no intermediate rewarded state exists.
 */
export function settlePendingCampaignVictory(
  input: GameSaveV1,
): SettleCampaignVictoryResult {
  const settlement = readPendingCampaignVictorySettlement(input);
  if (!settlement) {
    return failure(normalizeMetaSave(input), "settlement_missing", "No recoverable campaign victory settlement exists.");
  }
  const ticket = readPendingBattleRewardTicket(input, settlement.stageId, "campaign");
  if (!ticket) {
    return failure(normalizeMetaSave(input), "ticket_missing", "The campaign battle reward ticket is missing.");
  }
  if (ticket.token !== settlement.rewardTicketToken) {
    return failure(normalizeMetaSave(input), "ticket_mismatch", "The victory settlement ticket no longer matches.");
  }

  const completion = completeCampaignStageWithRewards(input, {
    stageId: settlement.stageId,
    stars: settlement.stars,
    partyHeroIds: settlement.partyHeroIds,
  });
  if (!completion.ok) {
    return failure(completion.save, "reward_failed", completion.message);
  }
  let save = completion.save;
  save.records.bestRicochetChain = Math.max(save.records.bestRicochetChain, settlement.bestCombo);
  save.records.totalDamage += settlement.totalDamage;
  save.records.lastPlayedAt = settlement.wonAt;

  const committed = commitBattleRewardTicket(save, ticket);
  if (!committed.ok) {
    return failure(committed.save, committed.code, committed.message);
  }
  save = committed.save;
  save.recovery.activeCampaignBattle = null;
  save.recovery.pendingCampaignVictorySettlement = null;
  return {
    ok: true,
    save,
    settlement,
    ticket,
    stars: settlement.stars,
    newlyUnlockedRouteId: completion.newlyUnlockedRouteIds[0] ?? "",
    rewards: completion.rewards,
  };
}

export function clearPendingCampaignVictorySettlement(input: GameSaveV1): GameSaveV1 {
  if (!input.recovery.pendingCampaignVictorySettlement) return input;
  const save = cloneSave(input);
  save.recovery.pendingCampaignVictorySettlement = null;
  return save;
}

/** Drops structurally valid but orphaned/corrupted settlement payloads. */
export function sanitizePendingCampaignVictorySettlement(input: GameSaveV1): GameSaveV1 {
  if (!input.recovery.pendingCampaignVictorySettlement || readPendingCampaignVictorySettlement(input)) {
    return input;
  }
  return clearPendingCampaignVictorySettlement(input);
}

function cloneSettlement(
  settlement: PendingCampaignVictorySettlement,
): PendingCampaignVictorySettlement {
  return {
    ...settlement,
    partyHeroIds: [...settlement.partyHeroIds],
    fallenHeroIds: [...settlement.fallenHeroIds],
  };
}

function failure(
  save: GameSaveV1,
  code: CampaignVictorySettlementFailure["code"],
  message: string,
): CampaignVictorySettlementFailure {
  return { ok: false, code, message, save };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
