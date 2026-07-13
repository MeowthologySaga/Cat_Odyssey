import { HERO_BY_ID, RELIC_BY_ID, STAGE_BY_ID } from "../../data";
import type { GameSaveV1 } from "../../state/saveSchema";
import { completeCampaignStage, type CompleteStageInput, type CompleteStageSuccess } from "./campaign";
import {
  reconcileCampaignStarMilestones,
  type CampaignStarMilestoneReceipt,
} from "./campaignStarMilestones";
import { assertNoWalletState, normalizeMetaSave } from "./compat";
import { grantHeroXp, type HeroXpGrantReceipt } from "./heroProgression";
import { getRelicRewardModifiers } from "./relics";
import { grantHero } from "./roster";
import { grantRelicToVault, type RelicVaultGrantReason } from "./relics";
import { CAMPAIGN_PARTY_MAX_SIZE } from "./constants";
import { STORY_HERO_UNLOCKS_BY_STAGE } from "./storyUnlocks";
import type { MetaFailure } from "./types";

export { STORY_HERO_UNLOCKS_BY_STAGE } from "./storyUnlocks";

export interface FirstClearRewardReceipt {
  readonly kind: "hero" | "relic" | "fragment" | "material";
  readonly id: string;
  readonly amount: number;
  readonly granted: boolean;
  readonly newlyOwned?: boolean;
  readonly replacement?: {
    readonly kind: "heroShards" | "relicDust";
    readonly id: string;
    readonly amount: number;
    readonly reason?: Exclude<RelicVaultGrantReason, "granted">;
  };
}

export interface StoryHeroRewardReceipt {
  readonly heroId: string;
  readonly newlyOwned: boolean;
}

export interface EndgameBonusRewardReceipt {
  readonly kind: "material" | "fragment" | "hero" | "relic" | "title" | "relicDust";
  readonly id: string;
  readonly amount: number;
  readonly granted: boolean;
  readonly reason?: Exclude<RelicVaultGrantReason, "granted">;
  readonly sourceRelicId?: string;
}

export interface StageRewardReceipt {
  readonly gold: number;
  /** XP is granted in full to each active party hero listed in heroXpHeroIds. */
  readonly heroXp: number;
  readonly heroXpHeroIds: readonly string[];
  readonly heroProgress: readonly HeroXpGrantReceipt[];
  readonly materials: Readonly<Record<string, number>>;
  readonly firstClear?: FirstClearRewardReceipt;
  readonly storyHeroes: readonly StoryHeroRewardReceipt[];
  /** Earnable key path; awarded on the first clear of milestone boss stages. */
  readonly raidKeys?: number;
  /** Newly claimed non-wallet rewards for total campaign-star thresholds. */
  readonly starMilestones?: readonly CampaignStarMilestoneReceipt[];
  readonly endgameLabel?: string;
  readonly endgameBonuses?: readonly EndgameBonusRewardReceipt[];
}

export interface GrantRepeatableStageRewardsInput {
  readonly stageId: string;
  readonly partyHeroIds?: readonly string[];
  readonly goldMultiplier?: number;
  readonly heroXpMultiplier?: number;
  readonly materialMultiplier?: number;
}

export interface GrantRepeatableStageRewardsSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly stageId: string;
  readonly rewards: StageRewardReceipt;
}

export type GrantRepeatableStageRewardsResult = GrantRepeatableStageRewardsSuccess | MetaFailure;

export interface CompleteCampaignStageWithRewardsSuccess extends CompleteStageSuccess {
  readonly rewards: StageRewardReceipt;
}

export type CompleteCampaignStageWithRewardsResult =
  | CompleteCampaignStageWithRewardsSuccess
  | MetaFailure;

export interface FirstClearRewardValidation {
  readonly valid: boolean;
  readonly code?: MetaFailure["code"];
  readonly message?: string;
}

export function grantRepeatableStageRewards(
  input: GameSaveV1,
  options: GrantRepeatableStageRewardsInput,
): GrantRepeatableStageRewardsResult {
  let save = normalizeMetaSave(input);
  const stage = STAGE_BY_ID[options.stageId];
  if (!stage) return failure(save, "unknown_stage", `Unknown stage: ${options.stageId}`);

  const relicRewards = getRelicRewardModifiers(save);
  const gold = scaledAmount(
    stage.rewards.gold,
    (options.goldMultiplier ?? 1) * relicRewards.goldMultiplier,
  );
  const heroXp = scaledAmount(stage.rewards.heroXp, options.heroXpMultiplier);
  const heroXpHeroIds = unique(options.partyHeroIds ?? save.roster.partyHeroIds).filter(
    (heroId) => Boolean(HERO_BY_ID[heroId]) && save.roster.ownedHeroIds.includes(heroId),
  );
  const materials = Object.fromEntries(
    Object.entries(stage.rewards.materials)
      .map(([id, amount]) => [id, scaledAmount(amount, options.materialMultiplier)] as const)
      .filter(([, amount]) => amount > 0),
  );

  save.resources.gold += gold;
  const heroProgress: HeroXpGrantReceipt[] = [];
  for (const heroId of heroXpHeroIds) {
    const result = grantHeroXp(save, heroId, heroXp);
    if (!result.ok) continue;
    save = result.save;
    heroProgress.push(result.receipt);
  }
  for (const [materialId, amount] of Object.entries(materials)) {
    save.resources.materials[materialId] = (save.resources.materials[materialId] ?? 0) + amount;
  }
  assertNoWalletState(save);
  return {
    ok: true,
    save,
    stageId: stage.id,
    rewards: { gold, heroXp, heroXpHeroIds, heroProgress, materials, storyHeroes: [] },
  };
}

export function completeCampaignStageWithRewards(
  input: GameSaveV1,
  completionInput: CompleteStageInput & { readonly partyHeroIds?: readonly string[] },
): CompleteCampaignStageWithRewardsResult {
  const firstClearValidation = validateFirstClearReward(completionInput.stageId);
  if (!firstClearValidation.valid) {
    return failure(
      normalizeMetaSave(input),
      firstClearValidation.code ?? "invalid_amount",
      firstClearValidation.message ?? `Invalid first-clear reward: ${completionInput.stageId}`,
    );
  }
  // Use the durable pre-transaction roster, not its compatibility-normalized
  // clone. Normalization may itself repair a just-completed story recruit; that
  // repair must still count as a new unlock rather than a duplicate reward.
  const ownedHeroIdsBeforeCompletion = new Set(
    input.roster.ownedHeroIds.filter((heroId) => Boolean(HERO_BY_ID[heroId])),
  );
  const completion = completeCampaignStage(input, completionInput);
  if (!completion.ok) return completion;

  const repeatable = grantRepeatableStageRewards(completion.save, {
    stageId: completion.stageId,
    partyHeroIds: completionInput.partyHeroIds,
  });
  if (!repeatable.ok) return repeatable;

  let save = repeatable.save;
  let firstClear: FirstClearRewardReceipt | undefined;
  let storyHeroes: StoryHeroRewardReceipt[] = [];
  let raidKeys = 0;
  const firstClearUnclaimed = !save.progress.claimedFirstClearStageIds.includes(completion.stageId);
  if (firstClearUnclaimed) {
    const firstClearResult = grantFirstClearReward(
      save,
      completion.stageId,
      getRelicRewardModifiers(save).firstClearMaterialMultiplier,
      ownedHeroIdsBeforeCompletion,
    );
    save = firstClearResult.save;
    firstClear = firstClearResult.receipt;
    const storyResult = grantStoryHeroes(
      save,
      completion.stageId,
      firstClear?.kind === "hero" ? firstClear.id : undefined,
      ownedHeroIdsBeforeCompletion,
    );
    save = storyResult.save;
    storyHeroes = storyResult.receipts;
    if (FREE_RAID_KEY_STAGE_IDS.has(completion.stageId)) {
      save.endgame.raidKeys += 1;
      raidKeys = 1;
    }
    save.progress.claimedFirstClearStageIds.push(completion.stageId);
  }
  const milestoneResult = reconcileCampaignStarMilestones(save);
  save = milestoneResult.save;
  assertNoWalletState(save);

  return {
    ...completion,
    save,
    rewards: {
      ...repeatable.rewards,
      firstClear,
      storyHeroes,
      ...(raidKeys ? { raidKeys } : {}),
      ...(milestoneResult.receipts.length ? { starMilestones: milestoneResult.receipts } : {}),
    },
  };
}

/** Campaign completion supplies the first free raid entry; repeat keys remain endgame rewards. */
export const FREE_RAID_KEY_STAGE_IDS: ReadonlySet<string> = new Set(["r10-s05"]);

/** Runtime guard mirroring the content validator: an invalid authored reward
 * must never become a durable first-clear claim. */
export function validateFirstClearReward(stageId: string): FirstClearRewardValidation {
  const reward = STAGE_BY_ID[stageId]?.rewards.firstClear;
  if (!reward) {
    return { valid: false, code: "unknown_stage", message: `Unknown stage: ${stageId}` };
  }
  if (!["hero", "relic", "fragment", "material"].includes(reward.kind as string)) {
    return { valid: false, code: "invalid_amount", message: `Invalid first-clear reward kind: ${stageId}` };
  }
  if (!Number.isInteger(reward.amount) || reward.amount <= 0) {
    return {
      valid: false,
      code: "invalid_amount",
      message: `First-clear reward amount must be a positive integer: ${stageId}`,
    };
  }
  if ((reward.kind === "hero" || reward.kind === "fragment") && !HERO_BY_ID[reward.id]) {
    return {
      valid: false,
      code: "unknown_hero",
      message: `Unknown first-clear ${reward.kind} hero: ${reward.id}`,
    };
  }
  if (reward.kind === "relic" && !RELIC_BY_ID[reward.id]) {
    return { valid: false, code: "unknown_relic", message: `Unknown first-clear relic: ${reward.id}` };
  }
  if (reward.kind === "material" && (typeof reward.id !== "string" || !reward.id.trim())) {
    return { valid: false, code: "invalid_amount", message: `First-clear material id is empty: ${stageId}` };
  }
  return { valid: true };
}

function grantFirstClearReward(
  input: GameSaveV1,
  stageId: string,
  materialMultiplier = 1,
  ownedHeroIdsBeforeCompletion?: ReadonlySet<string>,
): { save: GameSaveV1; receipt: FirstClearRewardReceipt } {
  let save = normalizeMetaSave(input);
  const reward = STAGE_BY_ID[stageId]!.rewards.firstClear;
  const amount = reward.kind === "material"
    ? scaledFirstClearMaterialAmount(reward.amount, materialMultiplier)
    : Math.max(0, Math.floor(reward.amount));
  let granted = false;
  let newlyOwned: boolean | undefined;
  let replacement: FirstClearRewardReceipt["replacement"];

  if (
    reward.kind === "hero"
    && HERO_BY_ID[reward.id]
    && (STORY_HERO_UNLOCKS_BY_STAGE[stageId] ?? []).includes(reward.id)
    && save.roster.ownedHeroIds.includes(reward.id)
  ) {
    // Compatibility normalization may already have repaired the same hero from
    // this completed story milestone. Whether the repair happened this turn or
    // in an earlier load, it must not later turn into duplicate shards.
    newlyOwned = ownedHeroIdsBeforeCompletion
      ? !ownedHeroIdsBeforeCompletion.has(reward.id)
      : false;
    granted = true;
  } else if (reward.kind === "hero" && HERO_BY_ID[reward.id]) {
    const duplicateShards = Math.max(20, HERO_BY_ID[reward.id]!.rarity * 10);
    const result = grantHero(save, reward.id, duplicateShards);
    if (result.ok) {
      save = result.save;
      newlyOwned = result.newlyOwned;
      granted = result.newlyOwned;
      if (!result.newlyOwned && result.shardsGranted > 0) {
        replacement = { kind: "heroShards", id: reward.id, amount: result.shardsGranted };
      }
    }
  } else if (reward.kind === "relic" && RELIC_BY_ID[reward.id]) {
    const relicGrant = grantRelicToVault(save, reward.id);
    if (relicGrant.ok) {
      save = relicGrant.save;
      granted = relicGrant.receipt.granted;
      if (!relicGrant.receipt.granted) {
        replacement = {
          kind: "relicDust",
          id: "relic-dust",
          amount: relicGrant.receipt.relicDustGranted,
          reason: relicGrant.receipt.reason === "vault_full" ? "vault_full" : "duplicate",
        };
      }
    }
  } else if (reward.kind === "fragment" && HERO_BY_ID[reward.id] && amount > 0) {
    save.roster.heroShards[reward.id] = (save.roster.heroShards[reward.id] ?? 0) + amount;
    granted = true;
  } else if (reward.kind === "material" && reward.id.trim() && amount > 0) {
    save.resources.materials[reward.id] = (save.resources.materials[reward.id] ?? 0) + amount;
    granted = true;
  }

  return {
    save,
    receipt: {
      kind: reward.kind,
      id: reward.id,
      amount,
      granted,
      ...(newlyOwned !== undefined ? { newlyOwned } : {}),
      ...(replacement ? { replacement } : {}),
    },
  };
}

function grantStoryHeroes(
  input: GameSaveV1,
  stageId: string,
  alreadyGrantedHeroId?: string,
  ownedHeroIdsBeforeCompletion?: ReadonlySet<string>,
): { save: GameSaveV1; receipts: StoryHeroRewardReceipt[] } {
  let save = normalizeMetaSave(input);
  const receipts: StoryHeroRewardReceipt[] = [];
  for (const heroId of unique(STORY_HERO_UNLOCKS_BY_STAGE[stageId] ?? [])) {
    if (heroId === alreadyGrantedHeroId || !HERO_BY_ID[heroId]) continue;
    const result = grantHero(save, heroId, 0);
    if (!result.ok) continue;
    save = result.save;
    const newlyOwned = ownedHeroIdsBeforeCompletion
      ? !ownedHeroIdsBeforeCompletion.has(heroId)
      : result.newlyOwned;
    if (
      newlyOwned
      && save.roster.partyHeroIds.length < CAMPAIGN_PARTY_MAX_SIZE
      && !save.roster.partyHeroIds.includes(heroId)
    ) {
      save.roster.partyHeroIds.push(heroId);
    }
    receipts.push({ heroId, newlyOwned });
  }
  return { save, receipts };
}

function scaledAmount(value: number, multiplier = 1): number {
  const safeMultiplier = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1;
  return Math.max(0, Math.round(value * safeMultiplier));
}

function scaledFirstClearMaterialAmount(value: number, multiplier = 1): number {
  const safeMultiplier = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1;
  return Math.max(0, Math.ceil(value * safeMultiplier));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function failure(save: GameSaveV1, code: MetaFailure["code"], message: string): MetaFailure {
  return { ok: false, code, message, save };
}
