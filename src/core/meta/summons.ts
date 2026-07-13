import { HEROES, HERO_BY_ID, type Rarity } from "../../data";
import { createSeededRandom, type SeededRandom } from "../../simulation/rng";
import type { GameSaveV1, JsonObject } from "../../state/saveSchema";
import { assertNoWalletState, normalizeMetaSave, writeHeroLevel } from "./compat";
import {
  DUPLICATE_SHARDS,
  DUPLICATE_FATE_DUST,
  SUMMON_FEATURED_CHANCE,
  SUMMON_HARD_PITY,
  SUMMON_SOFT_PITY_START,
} from "./constants";
import type { MetaFailure, SummonPullResult, SummonTransactionResult } from "./types";

export interface SummonBannerDefinition {
  readonly id: string;
  readonly featuredHeroId: string;
  readonly poolHeroIds: readonly string[];
  readonly baseFiveStarRate: number;
  readonly baseFourStarRate: number;
  readonly featuredChance: number;
  readonly softPityStart: number;
  readonly hardPity: number;
  readonly displayName?: string;
  readonly permanent?: boolean;
  readonly termsVersion?: string;
}

export interface SummonRequest {
  readonly seed: string | number;
  readonly count: 1 | 10;
  readonly banner?: SummonBannerDefinition;
}

export const DEFAULT_ORACLE_BANNER: SummonBannerDefinition = Object.freeze({
  id: "oracle-homecoming-v1",
  displayName: "귀향을 비추는 태양",
  permanent: true,
  termsVersion: "1.0",
  featuredHeroId: "heli-paws",
  poolHeroIds: HEROES.map((hero) => hero.id),
  baseFiveStarRate: 0.03,
  baseFourStarRate: 0.2,
  featuredChance: SUMMON_FEATURED_CHANCE,
  softPityStart: SUMMON_SOFT_PITY_START,
  hardPity: SUMMON_HARD_PITY,
});

export interface DecodedOraclePurchaseReward {
  readonly bannerId: string;
  readonly pulls: readonly SummonPullResult[];
  readonly pityAfter: number;
  readonly guaranteedFeaturedAfter: boolean;
}

/** Builds the exact deterministic result that must follow an oracle purchase retry. */
export function createOraclePurchaseReward(
  result: Pick<
    SummonTransactionResult,
    "bannerId" | "pulls" | "pityAfter" | "guaranteedFeaturedAfter"
  >,
): JsonObject {
  const pulls: JsonObject[] = result.pulls.map((pull) => ({
    index: pull.index,
    heroId: pull.heroId,
    rarity: pull.rarity,
    featured: pull.featured,
    duplicate: pull.duplicate,
    storyLocked: pull.storyLocked,
    heroGranted: pull.heroGranted,
    shardsGranted: pull.shardsGranted,
    pityBefore: pull.pityBefore,
    pityAfter: pull.pityAfter,
  }));
  return {
    bannerId: result.bannerId,
    pulls,
    pityAfter: result.pityAfter,
    guaranteedFeatured: result.guaranteedFeaturedAfter,
  };
}

/**
 * Restores a pending summon result from the save journal. Older rewards that did
 * not persist per-pull pity fields remain readable so an interrupted purchase can
 * still be completed without rolling a different result.
 */
export function decodeOraclePurchaseReward(
  reward: JsonObject,
): DecodedOraclePurchaseReward | undefined {
  if (!Array.isArray(reward.pulls) || reward.pulls.length === 0) return undefined;
  const fallbackPity = readFiniteInteger(reward.pityAfter, 0);
  const pulls: SummonPullResult[] = [];
  for (const [offset, raw] of reward.pulls.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const heroId = typeof raw.heroId === "string" ? raw.heroId : "";
    if (!heroId || !HERO_BY_ID[heroId]) return undefined;
    const rarity = raw.rarity === 5 ? 5 : raw.rarity === 4 ? 4 : raw.rarity === 3 ? 3 : undefined;
    if (!rarity) return undefined;
    const storyLocked = Boolean(raw.storyLocked);
    const duplicate = Boolean(raw.duplicate);
    pulls.push({
      index: readFiniteInteger(raw.index, offset + 1),
      heroId,
      rarity,
      featured: Boolean(raw.featured),
      duplicate,
      storyLocked,
      heroGranted: typeof raw.heroGranted === "boolean"
        ? raw.heroGranted
        : !duplicate && !storyLocked,
      shardsGranted: Math.max(0, readFiniteInteger(raw.shardsGranted, 0)),
      pityBefore: Math.max(0, readFiniteInteger(raw.pityBefore, 0)),
      pityAfter: Math.max(0, readFiniteInteger(raw.pityAfter, fallbackPity)),
    });
  }
  return {
    bannerId: typeof reward.bannerId === "string" && reward.bannerId.trim()
      ? reward.bannerId
      : DEFAULT_ORACLE_BANNER.id,
    pulls,
    pityAfter: Math.max(0, fallbackPity),
    guaranteedFeaturedAfter: Boolean(reward.guaranteedFeatured),
  };
}

export function resolveOracleSummons(
  input: GameSaveV1,
  request: SummonRequest,
): SummonTransactionResult | MetaFailure {
  const save = normalizeMetaSave(input);
  const banner = request.banner ?? DEFAULT_ORACLE_BANNER;
  const bannerError = validateBanner(banner);
  if (bannerError) {
    return { ok: false, code: "invalid_banner", message: bannerError, save };
  }
  if (request.count !== 1 && request.count !== 10) {
    return { ok: false, code: "invalid_amount", message: "Summon count must be 1 or 10.", save };
  }

  const seed = String(request.seed);
  const rng = createSeededRandom(`${seed}:${banner.id}:${save.summons.oraclePulls}`);
  const pools = groupPools(banner);
  const pulls: SummonPullResult[] = [];
  let pity = Math.min(banner.hardPity - 1, Math.max(0, save.summons.pityCount));
  let guaranteedFeatured = save.summons.guaranteedFeatured;
  let hasFourOrFive = false;

  for (let index = 0; index < request.count; index += 1) {
    const pityBefore = pity;
    const guaranteeFour = request.count === 10 && index === 9 && !hasFourOrFive;
    const rarity = drawRarity(rng, pityBefore, guaranteeFour, banner);
    const selection = selectHero(rng, rarity, guaranteedFeatured, banner, pools);
    const featured = selection.heroId === banner.featuredHeroId && rarity === 5;
    if (rarity === 5) {
      pity = 0;
      guaranteedFeatured = !featured;
    } else {
      pity = Math.min(banner.hardPity - 1, pity + 1);
    }
    hasFourOrFive ||= rarity >= 4;

    const selectedHero = HERO_BY_ID[selection.heroId]!;
    const duplicate = save.roster.ownedHeroIds.includes(selection.heroId);
    const storyLocked = selectedHero.unlock === "story" && !duplicate;
    const heroGranted = !duplicate && !storyLocked;
    const shardsGranted = duplicate || storyLocked ? DUPLICATE_SHARDS[rarity] : 0;
    if (duplicate || storyLocked) {
      save.roster.heroShards[selection.heroId] =
        (save.roster.heroShards[selection.heroId] ?? 0) + shardsGranted;
      if (duplicate) save.resources.fateDust += DUPLICATE_FATE_DUST[rarity];
    } else if (heroGranted) {
      save.roster.ownedHeroIds.push(selection.heroId);
      writeHeroLevel(save, selection.heroId, 1);
    }
    pulls.push({
      index: index + 1,
      heroId: selection.heroId,
      rarity,
      featured,
      duplicate,
      storyLocked,
      heroGranted,
      shardsGranted,
      pityBefore,
      pityAfter: pity,
    });
  }

  save.summons.oraclePulls += request.count;
  save.summons.pityCount = pity;
  save.summons.guaranteedFeatured = guaranteedFeatured;
  assertNoWalletState(save);
  return {
    ok: true,
    save,
    bannerId: banner.id,
    seed,
    pulls,
    pityAfter: pity,
    guaranteedFeaturedAfter: guaranteedFeatured,
  };
}

export interface SummonPoolDisclosure {
  readonly bannerId: string;
  readonly displayName: string;
  readonly permanent: boolean;
  readonly termsVersion: string;
  readonly rates: Readonly<Record<3 | 4 | 5, number>>;
  readonly featuredChance: number;
  readonly softPityStart: number;
  readonly hardPity: number;
  readonly heroIdsByRarity: Readonly<Record<3 | 4 | 5, readonly string[]>>;
  readonly storyShardOnlyHeroIds: readonly string[];
}

export function getSummonPoolDisclosure(
  input: GameSaveV1,
  banner: SummonBannerDefinition = DEFAULT_ORACLE_BANNER,
): SummonPoolDisclosure {
  const save = normalizeMetaSave(input);
  const pools = groupPools(banner);
  return {
    bannerId: banner.id,
    displayName: banner.displayName ?? banner.id,
    permanent: banner.permanent ?? true,
    termsVersion: banner.termsVersion ?? "1.0",
    rates: {
      5: banner.baseFiveStarRate,
      4: banner.baseFourStarRate,
      3: Math.max(0, 1 - banner.baseFiveStarRate - banner.baseFourStarRate),
    },
    featuredChance: banner.featuredChance,
    softPityStart: banner.softPityStart,
    hardPity: banner.hardPity,
    heroIdsByRarity: pools,
    storyShardOnlyHeroIds: banner.poolHeroIds.filter((heroId) => {
      const hero = HERO_BY_ID[heroId];
      return hero?.unlock === "story" && !save.roster.ownedHeroIds.includes(heroId);
    }),
  };
}

function drawRarity(
  rng: SeededRandom,
  pityBefore: number,
  guaranteeFour: boolean,
  banner: SummonBannerDefinition,
): Rarity {
  if (pityBefore >= banner.hardPity - 1) return 5;
  const softSteps = Math.max(0, pityBefore + 1 - banner.softPityStart + 1);
  const fiveRate = Math.min(1, banner.baseFiveStarRate + softSteps * 0.06);
  const roll = rng.next();
  if (roll < fiveRate) return 5;
  if (guaranteeFour || roll < fiveRate + banner.baseFourStarRate) return 4;
  return 3;
}

function selectHero(
  rng: SeededRandom,
  rarity: Rarity,
  guaranteedFeatured: boolean,
  banner: SummonBannerDefinition,
  pools: Readonly<Record<Rarity, readonly string[]>>,
): { readonly heroId: string } {
  if (rarity === 5) {
    const offBanner = pools[5].filter((heroId) => heroId !== banner.featuredHeroId);
    if (guaranteedFeatured || offBanner.length === 0 || rng.next() < banner.featuredChance) {
      return { heroId: banner.featuredHeroId };
    }
    return { heroId: rng.pick(offBanner) };
  }
  return { heroId: rng.pick(pools[rarity]) };
}

function groupPools(
  banner: SummonBannerDefinition,
): Readonly<Record<Rarity, readonly string[]>> {
  const byRarity: Record<Rarity, string[]> = { 3: [], 4: [], 5: [] };
  for (const heroId of banner.poolHeroIds) {
    const hero = HERO_BY_ID[heroId];
    if (hero) byRarity[hero.rarity].push(hero.id);
  }
  return byRarity;
}

function validateBanner(banner: SummonBannerDefinition): string | undefined {
  const featured = HERO_BY_ID[banner.featuredHeroId];
  if (!featured || featured.rarity !== 5) return "Featured hero must be a five-star catalog hero.";
  if (!banner.poolHeroIds.includes(banner.featuredHeroId)) return "Featured hero must be in the banner pool.";
  const pools = groupPools(banner);
  if (pools[3].length === 0 || pools[4].length === 0 || pools[5].length === 0) {
    return "Banner must contain at least one hero of every rarity.";
  }
  if (!(banner.baseFiveStarRate > 0 && banner.baseFiveStarRate < 1)) return "Invalid five-star rate.";
  if (!(banner.baseFourStarRate > 0 && banner.baseFourStarRate < 1)) return "Invalid four-star rate.";
  if (!(banner.featuredChance > 0 && banner.featuredChance <= 1)) return "Invalid featured chance.";
  if (banner.softPityStart < 1 || banner.hardPity <= banner.softPityStart) return "Invalid pity thresholds.";
  return undefined;
}

function readFiniteInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}
