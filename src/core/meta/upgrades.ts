import { HERO_BY_ID } from "../../data";
import type { GameSaveV1 } from "../../state/saveSchema";
import {
  assertNoWalletState,
  normalizeMetaSave,
  readHeroLevel,
  writeHeroLevel,
} from "./compat";
import { MAX_ASCENSION, levelCapForAscension } from "./constants";
import { grantHeroXp } from "./heroProgression";
import { getHeroProgress } from "./roster";
import type { MetaFailure, UpgradeCost, UpgradeResult } from "./types";

export function quoteLevelUpgrade(
  input: GameSaveV1,
  heroId: string,
  levels = 1,
): UpgradeCost | MetaFailure {
  const save = normalizeMetaSave(input);
  const hero = HERO_BY_ID[heroId];
  if (!hero) return failure(save, "unknown_hero", `Unknown hero: ${heroId}`);
  if (!save.roster.ownedHeroIds.includes(heroId)) {
    return failure(save, "hero_not_owned", `Hero is not owned: ${heroId}`);
  }
  if (!Number.isFinite(levels) || !Number.isInteger(levels) || levels <= 0) {
    return failure(save, "invalid_amount", "Level amount must be a positive integer.");
  }
  const amount = levels;
  const currentLevel = readHeroLevel(save, heroId);
  const ascension = save.roster.heroAwakening[heroId] ?? 0;
  const cap = levelCapForAscension(ascension);
  if (currentLevel + amount > cap) {
    return failure(save, "level_cap", `Level ${cap} cap requires ascension.`);
  }
  let gold = 0;
  for (let level = currentLevel; level < currentLevel + amount; level += 1) {
    gold += levelTransitionGold(level, hero.rarity);
  }
  return { gold, shards: 0, awakeningMaterials: 0 };
}

export function upgradeHeroLevel(
  input: GameSaveV1,
  heroId: string,
  levels = 1,
): UpgradeResult {
  const save = normalizeMetaSave(input);
  const quote = quoteLevelUpgrade(save, heroId, levels);
  if (isMetaFailure(quote)) return quote;
  if (save.resources.gold < quote.gold) {
    return failure(save, "insufficient_gold", `Need ${quote.gold} gold.`);
  }
  save.resources.gold -= quote.gold;
  writeHeroLevel(save, heroId, readHeroLevel(save, heroId) + Math.floor(levels));
  const hero = getHeroProgress(save, heroId);
  if (!hero) return failure(save, "unknown_hero", `Unknown hero: ${heroId}`);
  assertNoWalletState(save);
  return { ok: true, save, hero, cost: quote };
}

export function quoteAscension(input: GameSaveV1, heroId: string): UpgradeCost | MetaFailure {
  const save = normalizeMetaSave(input);
  const hero = HERO_BY_ID[heroId];
  if (!hero) return failure(save, "unknown_hero", `Unknown hero: ${heroId}`);
  if (!save.roster.ownedHeroIds.includes(heroId)) {
    return failure(save, "hero_not_owned", `Hero is not owned: ${heroId}`);
  }
  const currentAscension = Math.max(0, Math.floor(save.roster.heroAwakening[heroId] ?? 0));
  if (currentAscension >= MAX_ASCENSION) {
    return failure(save, "max_ascension", `${heroId} is fully ascended.`);
  }
  const currentLevel = readHeroLevel(save, heroId);
  const currentCap = levelCapForAscension(currentAscension);
  if (currentLevel < currentCap) {
    return failure(
      save,
      "ascension_level_required",
      `Reach level ${currentCap} before ascension.`,
    );
  }
  const nextRank = currentAscension + 1;
  return {
    gold: 500 * nextRank * nextRank + hero.rarity * 100,
    shards: 10 * nextRank + (hero.rarity - 3) * 10,
    awakeningMaterials: nextRank,
  };
}

export function ascendHero(input: GameSaveV1, heroId: string): UpgradeResult {
  let save = normalizeMetaSave(input);
  const quote = quoteAscension(save, heroId);
  if (isMetaFailure(quote)) return quote;
  if (save.resources.gold < quote.gold) {
    return failure(save, "insufficient_gold", `Need ${quote.gold} gold.`);
  }
  if ((save.roster.heroShards[heroId] ?? 0) < quote.shards) {
    return failure(save, "insufficient_shards", `Need ${quote.shards} hero shards.`);
  }
  if (save.resources.awakeningMaterials < quote.awakeningMaterials) {
    return failure(
      save,
      "insufficient_awakening_materials",
      `Need ${quote.awakeningMaterials} awakening materials.`,
    );
  }
  save.resources.gold -= quote.gold;
  save.roster.heroShards[heroId] = (save.roster.heroShards[heroId] ?? 0) - quote.shards;
  save.resources.awakeningMaterials -= quote.awakeningMaterials;
  save.roster.heroAwakening[heroId] = (save.roster.heroAwakening[heroId] ?? 0) + 1;
  const settledXp = grantHeroXp(save, heroId, 0);
  if (settledXp.ok) save = settledXp.save;
  const hero = getHeroProgress(save, heroId);
  if (!hero) return failure(save, "unknown_hero", `Unknown hero: ${heroId}`);
  assertNoWalletState(save);
  return { ok: true, save, hero, cost: quote };
}

function levelTransitionGold(currentLevel: number, rarity: 3 | 4 | 5): number {
  return 75 + currentLevel * 30 + (rarity - 3) * 40;
}

function failure(save: GameSaveV1, code: MetaFailure["code"], message: string): MetaFailure {
  return { ok: false, code, message, save };
}

function isMetaFailure(value: UpgradeCost | MetaFailure): value is MetaFailure {
  return "ok" in value && value.ok === false;
}
