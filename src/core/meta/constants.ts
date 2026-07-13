export const CAMPAIGN_PARTY_MIN_SIZE = 1 as const;
export const CAMPAIGN_PARTY_MAX_SIZE = 3 as const;
/** @deprecated Use CAMPAIGN_PARTY_MAX_SIZE when describing the slot cap. */
export const CAMPAIGN_PARTY_SIZE = CAMPAIGN_PARTY_MAX_SIZE;
export const DEFAULT_CAMPAIGN_PARTY = [
  "meow-dysseus",
] as const;

export const MAX_HERO_LEVEL = 60 as const;
export const MAX_ASCENSION = 5 as const;
export const BASE_LEVEL_CAP = 10 as const;
export const LEVELS_PER_ASCENSION = 10 as const;

export const SUMMON_SOFT_PITY_START = 35 as const;
export const SUMMON_HARD_PITY = 45 as const;
export const SUMMON_FEATURED_CHANCE = 0.5 as const;
export const DUPLICATE_SHARDS = Object.freeze({ 3: 10, 4: 25, 5: 60 }) as Readonly<
  Record<3 | 4 | 5, number>
>;
export const DUPLICATE_FATE_DUST = Object.freeze({ 3: 2, 4: 6, 5: 20 }) as Readonly<
  Record<3 | 4 | 5, number>
>;
export const FATE_DUST_FEATURED_GUARANTEE_COST = 100 as const;

export function levelCapForAscension(ascension: number): number {
  const rank = Math.min(MAX_ASCENSION, Math.max(0, Math.floor(ascension)));
  return Math.min(MAX_HERO_LEVEL, BASE_LEVEL_CAP + rank * LEVELS_PER_ASCENSION);
}
