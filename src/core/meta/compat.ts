import { HERO_BY_ID, RELIC_BY_ID, ROUTES, ROUTE_BY_ID, STAGES, STAGE_BY_ID } from "../../data";
import { repairVaultExpansionEntitlement } from "../../state/entitlements";
import { cloneSave, type GameSaveV1 } from "../../state/saveSchema";
import { BASE_LEVEL_CAP, LEVELS_PER_ASCENSION, MAX_ASCENSION } from "./constants";
import { STORY_HERO_UNLOCKS_BY_STAGE } from "./storyUnlocks";

export const META_COMPAT_PREFIX = "__meta:" as const;
const STAGE_STAR_PREFIX = `${META_COMPAT_PREFIX}stage-stars:`;
const HERO_LEVEL_PREFIX = `${META_COMPAT_PREFIX}hero-level:`;

const legacyRouteAliases: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(ROUTES.map((route, index) => [`route-${String(index + 1).padStart(2, "0")}`, route.id])),
);

export function canonicalRouteId(routeId: string | null): string | null {
  if (routeId === null) return null;
  if (ROUTE_BY_ID[routeId]) return routeId;
  return legacyRouteAliases[routeId] ?? null;
}

export function stageStarKey(stageId: string): string {
  return `${STAGE_STAR_PREFIX}${stageId}`;
}

export function heroLevelKey(heroId: string): string {
  return `${HERO_LEVEL_PREFIX}${heroId}`;
}

export function readStageStars(save: GameSaveV1, stageId: string): 0 | 1 | 2 | 3 {
  if (!STAGE_BY_ID[stageId]) return 0;
  return clampInteger(save.progress.stageStars?.[stageId], 0, 3) as 0 | 1 | 2 | 3;
}

export function writeStageStars(save: GameSaveV1, stageId: string, stars: number): void {
  if (!STAGE_BY_ID[stageId]) throw new Error(`Unknown stage: ${stageId}`);
  save.progress.stageStars ??= {};
  save.progress.stageStars[stageId] = clampInteger(stars, 0, 3);
}

export function readHeroLevel(save: GameSaveV1, heroId: string): number {
  if (!HERO_BY_ID[heroId] || !save.roster.ownedHeroIds.includes(heroId)) return 0;
  return clampInteger(save.roster.heroLevels?.[heroId] ?? 1, 1, 60);
}

export function writeHeroLevel(save: GameSaveV1, heroId: string, level: number): void {
  if (!HERO_BY_ID[heroId]) throw new Error(`Unknown hero: ${heroId}`);
  save.roster.heroLevels ??= {};
  save.roster.heroLevels[heroId] = clampInteger(level, 1, 60);
}

export function normalizeMetaSave(input: GameSaveV1): GameSaveV1 {
  const save = cloneSave(input);
  save.progress.stageStars ??= {};
  save.roster.heroLevels ??= {};
  for (const [key, value] of Object.entries(save.endgame.bossAffinity)) {
    if (key.startsWith(STAGE_STAR_PREFIX)) {
      const stageId = key.slice(STAGE_STAR_PREFIX.length);
      if (STAGE_BY_ID[stageId] && !(stageId in save.progress.stageStars)) {
        save.progress.stageStars[stageId] = clampInteger(value, 0, 3);
      }
      delete save.endgame.bossAffinity[key];
    } else if (key.startsWith(HERO_LEVEL_PREFIX)) {
      const heroId = key.slice(HERO_LEVEL_PREFIX.length);
      if (HERO_BY_ID[heroId] && !(heroId in save.roster.heroLevels)) {
        save.roster.heroLevels[heroId] = clampInteger(value, 1, 60);
      }
      delete save.endgame.bossAffinity[key];
    }
  }
  const completedStageIds = unique(
    save.progress.completedStageIds.filter((stageId) => Boolean(STAGE_BY_ID[stageId])),
  );
  const claimedFirstClearStageIds = unique(
    save.progress.claimedFirstClearStageIds.filter((stageId) => Boolean(STAGE_BY_ID[stageId])),
  );
  // A durable first-clear claim is also proof that the stage was completed.
  // Older builds occasionally persisted the claim before the completion list.
  save.progress.completedStageIds = unique([...completedStageIds, ...claimedFirstClearStageIds]);
  save.progress.claimedFirstClearStageIds = claimedFirstClearStageIds;

  const completed = new Set(save.progress.completedStageIds);
  let highestDerivedRouteIndex = 0;
  for (const [index, route] of ROUTES.entries()) {
    if (route.stageIds.some((stageId) => completed.has(stageId))) {
      highestDerivedRouteIndex = Math.max(highestDerivedRouteIndex, index);
    }
    if (route.stageIds.length > 0 && route.stageIds.every((stageId) => completed.has(stageId))) {
      highestDerivedRouteIndex = Math.max(highestDerivedRouteIndex, Math.min(ROUTES.length - 1, index + 1));
    }
  }
  // Route access is entirely campaign-derived; stale legacy flags must neither
  // strand completed progress nor leave future routes open accidentally.
  save.progress.unlockedRouteIds = ROUTES
    .slice(0, highestDerivedRouteIndex + 1)
    .map((route) => route.id);

  const activeRouteId = canonicalRouteId(save.progress.activeRouteId);
  save.progress.activeRouteId = activeRouteId && save.progress.unlockedRouteIds.includes(activeRouteId)
    ? activeRouteId
    : ROUTES[highestDerivedRouteIndex]?.id ?? save.progress.unlockedRouteIds[0] ?? null;
  save.progress.campaignComplete = STAGES.length > 0
    && STAGES.every((stage) => completed.has(stage.id));
  save.progress.stageStars = Object.fromEntries(
    Object.entries(save.progress.stageStars)
      .filter(([stageId]) => Boolean(STAGE_BY_ID[stageId]))
      .map(([stageId, stars]) => [stageId, clampInteger(stars, 0, 3)]),
  );
  const permanentStoryHeroIds = unique([
    ...save.progress.completedStageIds.flatMap(
      (stageId) => STORY_HERO_UNLOCKS_BY_STAGE[stageId] ?? [],
    ),
    ...save.progress.claimedFirstClearStageIds.flatMap((stageId) => {
      const reward = STAGE_BY_ID[stageId]?.rewards.firstClear;
      return reward?.kind === "hero" ? [reward.id] : [];
    }),
  ]).filter((heroId) => Boolean(HERO_BY_ID[heroId]));
  save.roster.ownedHeroIds = unique([
    ...save.roster.ownedHeroIds.filter((heroId) => Boolean(HERO_BY_ID[heroId])),
    ...permanentStoryHeroIds,
  ]);
  save.roster.partyHeroIds = unique(
    save.roster.partyHeroIds.filter(
      (heroId) => Boolean(HERO_BY_ID[heroId]) && save.roster.ownedHeroIds.includes(heroId),
    ),
  );
  save.roster.partyPresets = Array.from({ length: 3 }, (_, index) => unique(
    (save.roster.partyPresets?.[index] ?? []).filter(
      (heroId) => Boolean(HERO_BY_ID[heroId]) && save.roster.ownedHeroIds.includes(heroId),
    ),
  ).slice(0, 3));
  save.roster.heroXp = normalizeCountRecord(
    save.roster.heroXp,
    (heroId) => Boolean(HERO_BY_ID[heroId]),
  );
  save.resources.materials = normalizeCountRecord(save.resources.materials);
  save.inventory.relicIds = unique(
    save.inventory.relicIds.filter((relicId) => Boolean(RELIC_BY_ID[relicId])),
  );
  save.inventory.equippedRelicIds = unique(
    save.inventory.equippedRelicIds.filter(
      (relicId) => Boolean(RELIC_BY_ID[relicId]) && save.inventory.relicIds.includes(relicId),
    ),
  ).slice(0, 3);
  save.inventory.relicLevels = Object.fromEntries(
    Object.entries(save.inventory.relicLevels)
      .filter(([relicId]) => save.inventory.relicIds.includes(relicId))
      .map(([relicId, level]) => [relicId, clampInteger(level, 1, 5)]),
  );
  for (const relicId of save.inventory.relicIds) {
    save.inventory.relicLevels[relicId] = clampInteger(
      save.inventory.relicLevels[relicId] ?? 1,
      1,
      5,
    );
  }
  if (
    save.inventory.selectedTitleId
    && !save.inventory.skinIds.includes(save.inventory.selectedTitleId)
  ) {
    save.inventory.selectedTitleId = null;
  }

  save.roster.heroLevels = Object.fromEntries(
    Object.entries(save.roster.heroLevels)
      .filter(([heroId]) => Boolean(HERO_BY_ID[heroId]) && save.roster.ownedHeroIds.includes(heroId))
      .map(([heroId, level]) => [heroId, clampInteger(level, 1, 60)]),
  );
  for (const heroId of save.roster.ownedHeroIds) {
    const level = readHeroLevel(save, heroId) || 1;
    const minimumAwakening = Math.min(
      MAX_ASCENSION,
      Math.max(0, Math.ceil((level - BASE_LEVEL_CAP) / LEVELS_PER_ASCENSION)),
    );
    save.roster.heroAwakening[heroId] = Math.max(
      minimumAwakening,
      clampInteger(save.roster.heroAwakening[heroId], 0, MAX_ASCENSION),
    );
    writeHeroLevel(save, heroId, level);
    save.roster.heroShards[heroId] = Math.max(0, Math.floor(save.roster.heroShards[heroId] ?? 0));
  }
  repairVaultExpansionEntitlement(save);
  return save;
}

export function assertNoWalletState(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/walletBalance|diamondBalance|diamonds/i.test(serialized)) {
    throw new Error("Meta state must never store wallet or diamond balance.");
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  const numeric = Number(value);
  const finite = Number.isFinite(numeric) ? Math.floor(numeric) : minimum;
  return Math.min(maximum, Math.max(minimum, finite));
}

function normalizeCountRecord(
  value: unknown,
  acceptsKey: (key: string) => boolean = () => true,
): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, amount]) => [key.trim(), Math.max(0, Math.floor(Number(amount) || 0))] as const)
      .filter(([key]) => Boolean(key) && acceptsKey(key)),
  );
}
