import { HERO_BY_ID, type HeroDefinition, type StatBlock } from "../../data";
import type { GameSaveV1 } from "../../state/saveSchema";
import { MAX_HERO_LEVEL, levelCapForAscension } from "./constants";
import {
  assertNoWalletState,
  normalizeMetaSave,
  readHeroLevel,
  writeHeroLevel,
} from "./compat";
import type { MetaFailure } from "./types";
import { getBattleRelicModifiers } from "./relics";

export const HERO_LEVEL_HP_GROWTH = 0.055 as const;
export const HERO_LEVEL_ATTACK_GROWTH = 0.045 as const;
export const HERO_LEVEL_SPEED_GROWTH = 0.006 as const;
export const HERO_ASCENSION_HP_BONUS = 0.1 as const;
export const HERO_ASCENSION_ATTACK_BONUS = 0.08 as const;
export const HERO_ASCENSION_SPEED_BONUS = 0.025 as const;

export interface HeroXpProgressView {
  readonly heroId: string;
  readonly level: number;
  readonly levelCap: number;
  readonly awakening: number;
  /** Banked XP toward the next level. XP earned at an ascension cap is preserved. */
  readonly currentXp: number;
  readonly xpToNextLevel: number;
  readonly atLevelCap: boolean;
  readonly maxLevel: boolean;
}

export interface HeroXpGrantReceipt extends HeroXpProgressView {
  readonly xpGranted: number;
  readonly levelBefore: number;
  readonly levelsGained: number;
}

export interface HeroXpGrantSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly receipt: HeroXpGrantReceipt;
}

export type HeroXpGrantResult = HeroXpGrantSuccess | MetaFailure;

export interface HeroCombatProfile {
  readonly heroId: string;
  readonly level: number;
  readonly awakening: number;
  readonly baseStats: StatBlock;
  readonly stats: StatBlock;
  readonly multipliers: Readonly<StatBlock>;
}

/**
 * XP curve shared by rewards and UI. It starts briskly, then grows steadily so
 * early story clears visibly advance heroes without making late levels trivial.
 */
export function heroXpToNextLevel(level: number): number {
  const current = clampInteger(level, 1, MAX_HERO_LEVEL);
  if (current >= MAX_HERO_LEVEL) return 0;
  const offset = current - 1;
  return 70 + offset * 20 + Math.floor(Math.pow(offset, 1.45) * 4);
}

export function getHeroXpProgress(
  input: GameSaveV1,
  heroId: string,
): HeroXpProgressView | undefined {
  if (!HERO_BY_ID[heroId]) return undefined;
  const save = normalizeMetaSave(input);
  if (!save.roster.ownedHeroIds.includes(heroId)) return undefined;
  const awakening = clampInteger(save.roster.heroAwakening[heroId] ?? 0, 0, 5);
  const levelCap = levelCapForAscension(awakening);
  const level = Math.min(levelCap, readHeroLevel(save, heroId) || 1);
  const maxLevel = level >= MAX_HERO_LEVEL;
  return {
    heroId,
    level,
    levelCap,
    awakening,
    currentXp: nonNegativeInteger(save.roster.heroXp[heroId] ?? 0),
    xpToNextLevel: heroXpToNextLevel(level),
    atLevelCap: !maxLevel && level >= levelCap,
    maxLevel,
  };
}

/**
 * Grants XP and resolves every available level atomically. XP remains banked
 * when the hero reaches an ascension cap, so a stage reward is never discarded.
 */
export function grantHeroXp(
  input: GameSaveV1,
  heroId: string,
  amount: number,
): HeroXpGrantResult {
  const save = normalizeMetaSave(input);
  if (!HERO_BY_ID[heroId]) return failure(save, "unknown_hero", `Unknown hero: ${heroId}`);
  if (!save.roster.ownedHeroIds.includes(heroId)) {
    return failure(save, "hero_not_owned", `Hero is not owned: ${heroId}`);
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return failure(save, "invalid_amount", "Hero XP must be a non-negative finite number.");
  }

  const xpGranted = Math.floor(amount);
  const awakening = clampInteger(save.roster.heroAwakening[heroId] ?? 0, 0, 5);
  const levelCap = levelCapForAscension(awakening);
  const levelBefore = Math.min(levelCap, readHeroLevel(save, heroId) || 1);
  let level = levelBefore;
  let xp = nonNegativeInteger(save.roster.heroXp[heroId] ?? 0) + xpGranted;

  while (level < levelCap && level < MAX_HERO_LEVEL) {
    const threshold = heroXpToNextLevel(level);
    if (xp < threshold) break;
    xp -= threshold;
    level += 1;
  }

  writeHeroLevel(save, heroId, level);
  save.roster.heroXp[heroId] = xp;
  assertNoWalletState(save);

  const maxLevel = level >= MAX_HERO_LEVEL;
  return {
    ok: true,
    save,
    receipt: {
      heroId,
      xpGranted,
      levelBefore,
      level,
      levelsGained: level - levelBefore,
      levelCap,
      awakening,
      currentXp: xp,
      xpToNextLevel: heroXpToNextLevel(level),
      atLevelCap: !maxLevel && level >= levelCap,
      maxLevel,
    },
  };
}

/** Returns the authoritative level/awakening-scaled combat stats for a hero. */
export function getHeroCombatProfile(
  input: GameSaveV1,
  hero: HeroDefinition,
): HeroCombatProfile {
  const save = normalizeMetaSave(input);
  const owned = save.roster.ownedHeroIds.includes(hero.id);
  const awakening = owned
    ? clampInteger(save.roster.heroAwakening[hero.id] ?? 0, 0, 5)
    : 0;
  const levelCap = levelCapForAscension(awakening);
  const level = owned ? Math.min(levelCap, readHeroLevel(save, hero.id) || 1) : 1;
  const levelOffset = level - 1;
  const relicStats = getBattleRelicModifiers(save).stats;
  const multipliers: StatBlock = {
    hp: (1 + levelOffset * HERO_LEVEL_HP_GROWTH + awakening * HERO_ASCENSION_HP_BONUS) * relicStats.hp,
    attack:
      (1 + levelOffset * HERO_LEVEL_ATTACK_GROWTH + awakening * HERO_ASCENSION_ATTACK_BONUS) * relicStats.attack,
    speed:
      (1 + levelOffset * HERO_LEVEL_SPEED_GROWTH + awakening * HERO_ASCENSION_SPEED_BONUS) * relicStats.speed,
  };
  return {
    heroId: hero.id,
    level,
    awakening,
    baseStats: { ...hero.stats },
    stats: {
      hp: Math.round(hero.stats.hp * multipliers.hp),
      attack: Math.round(hero.stats.attack * multipliers.attack),
      speed: Math.round(hero.stats.speed * multipliers.speed),
    },
    multipliers,
  };
}

/**
 * Readable party strength shown beside authored stage recommendations.
 * Stats already contain level/awakening/relic scaling; the progression factor
 * keeps the 1→60 curve comparable to the campaign's 100→2340 recommendations.
 */
export function getPartyCombatPower(
  input: GameSaveV1,
  heroIds: readonly string[] = input.roster.partyHeroIds,
): number {
  const save = normalizeMetaSave(input);
  return Math.round(heroIds.reduce((total, heroId) => {
    const hero = HERO_BY_ID[heroId];
    if (!hero || !save.roster.ownedHeroIds.includes(heroId)) return total;
    const profile = getHeroCombatProfile(save, hero);
    const statScore = profile.stats.hp * 0.0125
      + profile.stats.attack * 0.09
      + profile.stats.speed * 0.04;
    const progression = 1 + (profile.level - 1) * 0.08 + profile.awakening * 0.3;
    return total + statScore * progression;
  }, 0));
}

/** Creates an immutable battle definition without mutating authored hero data. */
export function createBattleHeroDefinition(
  input: GameSaveV1,
  hero: HeroDefinition,
): HeroDefinition {
  const profile = getHeroCombatProfile(input, hero);
  const relicEffects = getBattleRelicModifiers(input).effects.map((effect) => ({
    kind: effect.kind,
    value: effect.value,
    target: effect.target,
    ...(effect.condition ? { condition: effect.condition } : {}),
    ...(effect.durationTurns !== undefined ? { durationTurns: effect.durationTurns } : {}),
    sourceId: effect.relicId,
    sourceLevel: effect.relicLevel,
  }));
  return { ...hero, stats: profile.stats, runtimeRelicEffects: relicEffects };
}

/**
 * BattleScene integration point. The returned order matches heroIds and unknown
 * or unowned heroes are omitted.
 */
export function createBattlePartyDefinitions(
  input: GameSaveV1,
  heroIds: readonly string[] = input.roster.partyHeroIds,
): readonly HeroDefinition[] {
  const save = normalizeMetaSave(input);
  return heroIds.flatMap((heroId) => {
    const hero = HERO_BY_ID[heroId];
    if (!hero || !save.roster.ownedHeroIds.includes(heroId)) return [];
    return [createBattleHeroDefinition(save, hero)];
  });
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, nonNegativeInteger(value)));
}

function failure(save: GameSaveV1, code: MetaFailure["code"], message: string): MetaFailure {
  return { ok: false, code, message, save };
}
