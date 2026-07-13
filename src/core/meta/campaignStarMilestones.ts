import type { GameSaveV1 } from "../../state/saveSchema";
import { getTotalCampaignStars } from "./campaign";
import { assertNoWalletState, normalizeMetaSave } from "./compat";

export interface CampaignStarMilestoneRewards {
  readonly gold?: number;
  readonly awakeningMaterials?: number;
  readonly relicDust?: number;
  readonly fateDust?: number;
  readonly raidKeys?: number;
}

export interface CampaignStarMilestoneDefinition {
  readonly id: string;
  readonly requiredStars: number;
  /** The title is both the visible reward and the durable one-time claim marker. */
  readonly titleId: string;
  readonly rewards: CampaignStarMilestoneRewards;
}

export interface CampaignStarMilestoneReceipt {
  readonly milestoneId: string;
  readonly requiredStars: number;
  readonly totalStars: number;
  readonly titleId: string;
  readonly rewards: CampaignStarMilestoneRewards;
}

export interface CampaignStarMilestoneProgress {
  readonly milestoneId: string;
  readonly requiredStars: number;
  readonly currentStars: number;
  readonly remainingStars: number;
  readonly titleId: string;
  readonly reached: boolean;
  readonly claimed: boolean;
}

export interface ReconcileCampaignStarMilestonesResult {
  readonly save: GameSaveV1;
  readonly totalStars: number;
  readonly receipts: readonly CampaignStarMilestoneReceipt[];
}

/**
 * Permanent, non-wallet campaign mastery track. Every resource already exists
 * in the local save economy; this path never reads or mints host diamonds.
 */
export const CAMPAIGN_STAR_MILESTONES: readonly CampaignStarMilestoneDefinition[] = Object.freeze([
  {
    id: "campaign-stars-030",
    requiredStars: 30,
    titleId: "title:star-voyager",
    rewards: Object.freeze({ gold: 1_500, relicDust: 50 }),
  },
  {
    id: "campaign-stars-060",
    requiredStars: 60,
    titleId: "title:wave-reader",
    rewards: Object.freeze({ gold: 3_000, awakeningMaterials: 1, fateDust: 10 }),
  },
  {
    id: "campaign-stars-090",
    requiredStars: 90,
    titleId: "title:fate-ricocheter",
    rewards: Object.freeze({ gold: 5_000, awakeningMaterials: 2, relicDust: 150 }),
  },
  {
    id: "campaign-stars-120",
    requiredStars: 120,
    titleId: "title:homecoming-navigator",
    rewards: Object.freeze({ gold: 7_500, awakeningMaterials: 3, raidKeys: 1 }),
  },
  {
    id: "campaign-stars-129",
    requiredStars: 129,
    titleId: "title:all-stars-captain",
    rewards: Object.freeze({
      gold: 10_000,
      awakeningMaterials: 5,
      relicDust: 300,
      fateDust: 50,
      raidKeys: 2,
    }),
  },
]);

/**
 * Claims every newly qualified milestone in one pure save transaction. Calling
 * this repeatedly, including after a save round-trip, is idempotent because a
 * milestone's canonical title is installed atomically with its resources.
 */
export function reconcileCampaignStarMilestones(
  input: GameSaveV1,
): ReconcileCampaignStarMilestonesResult {
  const save = normalizeMetaSave(input);
  const totalStars = getTotalCampaignStars(save);
  const receipts: CampaignStarMilestoneReceipt[] = [];

  for (const milestone of CAMPAIGN_STAR_MILESTONES) {
    if (totalStars < milestone.requiredStars || save.inventory.skinIds.includes(milestone.titleId)) {
      continue;
    }
    save.inventory.skinIds.push(milestone.titleId);
    grantMilestoneResources(save, milestone.rewards);
    receipts.push({
      milestoneId: milestone.id,
      requiredStars: milestone.requiredStars,
      totalStars,
      titleId: milestone.titleId,
      rewards: { ...milestone.rewards },
    });
  }

  assertNoWalletState(save);
  return { save, totalStars, receipts };
}

/** Pure collection-facing view; it never performs a claim or mutates a save. */
export function getCampaignStarMilestoneProgress(
  input: GameSaveV1,
): readonly CampaignStarMilestoneProgress[] {
  const totalStars = getTotalCampaignStars(input);
  const ownedTitles = new Set(input.inventory.skinIds);
  return CAMPAIGN_STAR_MILESTONES.map((milestone) => ({
    milestoneId: milestone.id,
    requiredStars: milestone.requiredStars,
    currentStars: totalStars,
    remainingStars: Math.max(0, milestone.requiredStars - totalStars),
    titleId: milestone.titleId,
    reached: totalStars >= milestone.requiredStars,
    claimed: ownedTitles.has(milestone.titleId),
  }));
}

function grantMilestoneResources(save: GameSaveV1, rewards: CampaignStarMilestoneRewards): void {
  save.resources.gold += rewards.gold ?? 0;
  save.resources.awakeningMaterials += rewards.awakeningMaterials ?? 0;
  save.resources.relicDust += rewards.relicDust ?? 0;
  save.resources.fateDust += rewards.fateDust ?? 0;
  save.endgame.raidKeys += rewards.raidKeys ?? 0;
}
