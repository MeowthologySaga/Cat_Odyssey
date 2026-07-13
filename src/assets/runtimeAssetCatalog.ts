import { ENEMIES, HEROES, ROUTES } from "../data";
import type {
  ArenaDefinition,
  EnemyDefinition,
  HeroDefinition,
  ObjectPresentationDefinition,
  SpawnDefinition,
  WallDefinition,
} from "../data";

export const HERO_FALLBACK_TEXTURE_KEY = "cat-token";
export const ENEMY_FALLBACK_TEXTURE_KEY = "enemy-token";
export const MAP_FALLBACK_TEXTURE_KEY = "arena-cyclops";

export type RuntimeImageAssetKind =
  | "hero"
  | "enemy"
  | "boss"
  | "route-map"
  | "stage-map"
  | "prop"
  | "wall"
  | "hazard";

export interface RuntimeImageAsset {
  readonly key: string;
  readonly url: string;
  readonly kind: RuntimeImageAssetKind;
  readonly sourceId: string;
}

export interface TextureExistenceLookup {
  exists(key: string): boolean;
}

export function heroAssetUrl(heroId: string): string {
  return `assets/art/characters/${heroId}-flight.webp`;
}

export function enemyAssetUrl(enemy: Pick<EnemyDefinition, "id" | "boss">): string {
  return enemy.boss
    ? `assets/art/bosses/${enemy.id}.webp`
    : `assets/art/enemies/${enemy.id}.webp`;
}

export function routeMapTextureKey(routeId: string): string {
  return `route-map-${routeId}`;
}

export function routeMapAssetUrl(routeId: string): string {
  return `assets/art/maps/routes/${routeId}.webp`;
}

export function stageMapTextureKey(backgroundKey: string): string {
  return `stage-map-${backgroundKey}`;
}

export function stageMapImageAsset(arena: Pick<ArenaDefinition, "backgroundKey" | "backgroundAssetUrl">): RuntimeImageAsset | undefined {
  if (!arena.backgroundAssetUrl) return undefined;
  return {
    key: stageMapTextureKey(arena.backgroundKey),
    url: arena.backgroundAssetUrl,
    kind: "stage-map",
    sourceId: arena.backgroundKey,
  };
}

const PROP_IDS = [
  "sleeping-sailor",
  "resonance-crystal",
  "scylla-forepaw",
  "sacred-cattle",
  "axe-ring",
] as const;

const HAZARD_TYPES = [
  "slow-field",
  "wind-vector",
  "current",
  "whirlpool",
  "sound-wave",
  "portal",
  "lightning",
  "forbidden-target",
  "moving-bumper",
  "one-way-wall",
  "wave-front",
] as const;

export function propTextureKey(propId: string): string {
  return propId.startsWith("prop-") ? propId : `prop-${propId}`;
}

export function wallTextureKey(visualId: string): string {
  return visualId.startsWith("wall-") ? visualId : `wall-${visualId}`;
}

export function hazardTextureKey(hazardType: string): string {
  return `hazard-${hazardType}`;
}

function fallbackStagePropTextureKey(spawnId: string): string | undefined {
  if (spawnId.startsWith("rescue-")) return propTextureKey("sleeping-sailor");
  if (spawnId === "memory") return "hero-anticleia-ghost";
  if (spawnId.startsWith("crystal-")) return propTextureKey("resonance-crystal");
  if (spawnId.startsWith("paw-")) return propTextureKey("scylla-forepaw");
  if (spawnId === "cattle" || spawnId.startsWith("cattle-")) return propTextureKey("sacred-cattle");
  if (spawnId.startsWith("ring-")) return propTextureKey("axe-ring");
  return undefined;
}

function presentationVisualId(
  presentation: ObjectPresentationDefinition | undefined,
  visualState?: string,
): string | undefined {
  if (!presentation) return undefined;
  return (visualState ? presentation.stateVisualIds?.[visualState] : undefined) ?? presentation.visualId;
}

export function stagePropTextureKey(
  spawn: string | Pick<SpawnDefinition, "id" | "presentation">,
  visualState?: string,
): string | undefined {
  if (typeof spawn === "string") return fallbackStagePropTextureKey(spawn);
  const visualId = presentationVisualId(spawn.presentation, visualState);
  return visualId ? propTextureKey(visualId) : fallbackStagePropTextureKey(spawn.id);
}

export function stagePropImageAssets(
  spawn: Pick<SpawnDefinition, "id" | "presentation">,
): readonly RuntimeImageAsset[] {
  if (!spawn.presentation) return [];
  const ids = new Set([
    spawn.presentation.visualId,
    ...Object.values(spawn.presentation.stateVisualIds ?? {}),
  ]);
  return [...ids].map((visualId) => ({
    key: propTextureKey(visualId),
    url: `assets/art/props/${visualId}.webp`,
    kind: "prop" as const,
    sourceId: visualId,
  }));
}

export function stageWallTextureKey(
  wall: Pick<WallDefinition, "presentation">,
  visualState?: string,
): string | undefined {
  const visualId = presentationVisualId(wall.presentation, visualState);
  return visualId ? wallTextureKey(visualId) : undefined;
}

export function stageWallImageAssets(
  wall: Pick<WallDefinition, "id" | "presentation">,
): readonly RuntimeImageAsset[] {
  if (!wall.presentation) return [];
  const ids = new Set([
    wall.presentation.visualId,
    ...Object.values(wall.presentation.stateVisualIds ?? {}),
  ]);
  return [...ids].map((visualId) => ({
    key: wallTextureKey(visualId),
    url: `assets/art/walls/${visualId}.webp`,
    kind: "wall" as const,
    sourceId: visualId,
  }));
}

export const HERO_IMAGE_ASSETS: readonly RuntimeImageAsset[] = Object.freeze(HEROES.map((hero) => ({
  key: hero.visualKey,
  url: heroAssetUrl(hero.id),
  kind: "hero" as const,
  sourceId: hero.id,
})));

export const ENEMY_IMAGE_ASSETS: readonly RuntimeImageAsset[] = Object.freeze(ENEMIES.map((enemy) => ({
  key: enemy.visualKey,
  url: enemyAssetUrl(enemy),
  kind: enemy.boss ? "boss" as const : "enemy" as const,
  sourceId: enemy.id,
})));

export const ROUTE_MAP_IMAGE_ASSETS: readonly RuntimeImageAsset[] = Object.freeze(ROUTES.map((route) => ({
  key: routeMapTextureKey(route.id),
  url: routeMapAssetUrl(route.id),
  kind: "route-map" as const,
  sourceId: route.id,
})));

export const PROP_IMAGE_ASSETS: readonly RuntimeImageAsset[] = Object.freeze(PROP_IDS.map((id) => ({
  key: propTextureKey(id),
  url: `assets/art/props/${id}.webp`,
  kind: "prop" as const,
  sourceId: id,
})));

export const HAZARD_IMAGE_ASSETS: readonly RuntimeImageAsset[] = Object.freeze(HAZARD_TYPES.map((type) => ({
  key: hazardTextureKey(type),
  url: `assets/art/hazards/${type}.webp`,
  kind: "hazard" as const,
  sourceId: type,
})));

export const RUNTIME_IMAGE_ASSETS: readonly RuntimeImageAsset[] = Object.freeze([
  ...HERO_IMAGE_ASSETS,
  ...ENEMY_IMAGE_ASSETS,
  ...ROUTE_MAP_IMAGE_ASSETS,
  ...PROP_IMAGE_ASSETS,
  ...HAZARD_IMAGE_ASSETS,
]);

export function resolveHeroTexture(
  textures: TextureExistenceLookup,
  hero: Pick<HeroDefinition, "visualKey">,
): string {
  return textures.exists(hero.visualKey) ? hero.visualKey : HERO_FALLBACK_TEXTURE_KEY;
}

export function resolveEnemyTexture(
  textures: TextureExistenceLookup,
  enemy: Pick<EnemyDefinition, "visualKey">,
): string {
  return textures.exists(enemy.visualKey) ? enemy.visualKey : ENEMY_FALLBACK_TEXTURE_KEY;
}

/** Prefer an authored stage plate, then degrade safely to route and core art. */
export function resolveStageBackgroundTexture(
  textures: TextureExistenceLookup,
  routeId: string,
  backgroundKey?: string,
): string {
  if (backgroundKey) {
    const stageKey = stageMapTextureKey(backgroundKey);
    if (textures.exists(stageKey)) return stageKey;
  }
  const key = routeMapTextureKey(routeId);
  return textures.exists(key) ? key : MAP_FALLBACK_TEXTURE_KEY;
}

export function resolveRouteMapTexture(textures: TextureExistenceLookup, routeId: string): string {
  const key = routeMapTextureKey(routeId);
  return textures.exists(key) ? key : MAP_FALLBACK_TEXTURE_KEY;
}
