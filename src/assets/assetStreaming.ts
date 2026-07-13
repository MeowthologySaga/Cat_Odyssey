import type Phaser from "phaser";
import { ENEMY_BY_ID, HERO_BY_ID, type StageDefinition } from "../data";
import { compileStageDefinitionModifiers } from "../core/battle/stageModifiers";
import {
  firstAvailableNonBossEnemy,
  SCRIPTED_REINFORCEMENT_CANDIDATE_IDS,
  summonCandidateIdsForAttackKind,
} from "../core/battle/dynamicEnemyContract";
import {
  ENEMY_IMAGE_ASSETS,
  HAZARD_IMAGE_ASSETS,
  HERO_IMAGE_ASSETS,
  PROP_IMAGE_ASSETS,
  ROUTE_MAP_IMAGE_ASSETS,
  hazardTextureKey,
  routeMapTextureKey,
  stageMapImageAsset,
  stagePropImageAssets,
  stagePropTextureKey,
  stageWallImageAssets,
  type RuntimeImageAsset,
} from "./runtimeAssetCatalog";

export const CORE_IMAGE_ASSETS: readonly RuntimeImageAsset[] = Object.freeze([
  { key: "arena-cyclops", url: "assets/art/maps/route-03-cyclops-base.webp", kind: "route-map", sourceId: "fallback-arena" },
  { key: "harbor-hub", url: "assets/art/maps/harbor-hub.webp", kind: "route-map", sourceId: "harbor" },
]);

const HERO_ASSET_BY_ID = new Map(HERO_IMAGE_ASSETS.map((asset) => [asset.sourceId, asset]));
const ENEMY_ASSET_BY_ID = new Map(ENEMY_IMAGE_ASSETS.map((asset) => [asset.sourceId, asset]));
const ROUTE_ASSET_BY_KEY = new Map(ROUTE_MAP_IMAGE_ASSETS.map((asset) => [asset.key, asset]));
const PROP_ASSET_BY_KEY = new Map(PROP_IMAGE_ASSETS.map((asset) => [asset.key, asset]));
const HAZARD_ASSET_BY_KEY = new Map(HAZARD_IMAGE_ASSETS.map((asset) => [asset.key, asset]));
const TRANSIENT_BATTLE_ASSET_KINDS = new Set<RuntimeImageAsset["kind"]>([
  "stage-map",
  "wall",
  "prop",
  "enemy",
  "boss",
]);
const transientTextureLeases = new WeakMap<object, Map<string, number>>();

function compactUnique(assets: Array<RuntimeImageAsset | undefined>): RuntimeImageAsset[] {
  const byKey = new Map<string, RuntimeImageAsset>();
  for (const asset of assets) if (asset) byKey.set(asset.key, asset);
  return [...byKey.values()];
}

export function partyImageAssets(heroIds: readonly string[]): readonly RuntimeImageAsset[] {
  return compactUnique(heroIds.map((heroId) => HERO_ASSET_BY_ID.get(heroId)));
}

export function routeSelectionImageAssets(): readonly RuntimeImageAsset[] {
  return ROUTE_MAP_IMAGE_ASSETS;
}

/** Enemy definitions that can enter after the battle has already started. */
export function runtimeSpawnedEnemyIdsForStage(stage: StageDefinition): readonly string[] {
  const ids: string[] = [];
  for (const placement of stage.enemies) {
    const definition = ENEMY_BY_ID[placement.enemyId];
    if (!definition) continue;
    // Split children reuse their parent's definition and therefore its art.
    if (definition.behaviorId === "splitter") ids.push(definition.id);
    if (definition.behaviorId !== "summoner") continue;
    const summoned = firstAvailableNonBossEnemy(
      summonCandidateIdsForAttackKind(definition.attack.kind),
      ENEMY_BY_ID,
    );
    if (summoned) ids.push(summoned.id);
  }

  const hasScriptedReinforcement = compileStageDefinitionModifiers(stage).byCategory.enemy
    .some((effect) => effect.flag === "reinforcementTurn");
  if (hasScriptedReinforcement) {
    const reinforcement = firstAvailableNonBossEnemy(
      SCRIPTED_REINFORCEMENT_CANDIDATE_IDS,
      ENEMY_BY_ID,
    ) ?? Object.values(ENEMY_BY_ID).find((definition) => !definition.boss);
    if (reinforcement) ids.push(reinforcement.id);
  }
  return [...new Set(ids)];
}

export function battleImageAssets(stage: StageDefinition, heroIds: readonly string[]): readonly RuntimeImageAsset[] {
  const assets: Array<RuntimeImageAsset | undefined> = [
    stageMapImageAsset(stage.arena),
    ROUTE_ASSET_BY_KEY.get(routeMapTextureKey(stage.routeId)),
    ...heroIds.map((heroId) => HERO_ASSET_BY_ID.get(heroId)),
    ...stage.enemies.map((entry) => ENEMY_BY_ID[entry.enemyId] ? ENEMY_ASSET_BY_ID.get(entry.enemyId) : undefined),
    ...runtimeSpawnedEnemyIdsForStage(stage).map((enemyId) => ENEMY_ASSET_BY_ID.get(enemyId)),
    ...stage.hazards.map((hazard) => HAZARD_ASSET_BY_KEY.get(hazardTextureKey(hazard.type))),
    ...stage.spawns
      .filter((spawn) => spawn.kind === "prop")
      .flatMap<RuntimeImageAsset | undefined>((spawn) => {
        const authored = stagePropImageAssets(spawn);
        if (authored.length > 0) return [...authored];
        const key = stagePropTextureKey(spawn.id);
        return key ? [PROP_ASSET_BY_KEY.get(key) ?? HERO_IMAGE_ASSETS.find((asset) => asset.key === key)] : [];
      }),
    ...stage.walls.flatMap((wall) => [...stageWallImageAssets(wall)]),
  ];
  return compactUnique(assets);
}

/** Large encounter-only plates and actors must not accumulate across all 43
 * stages during a long session. Shared route, hero and hazard art stays hot. */
export function transientBattleImageKeys(assets: readonly RuntimeImageAsset[]): readonly string[] {
  return [...new Set(assets
    .filter((asset) => TRANSIENT_BATTLE_ASSET_KINDS.has(asset.kind))
    .map((asset) => asset.key))];
}

/** Retain transient textures for this Scene and evict them after its final
 * user releases the lease. This is safe even if two Scenes briefly overlap. */
export function releaseBattleImageAssetsOnShutdown(
  scene: Phaser.Scene,
  assets: readonly RuntimeImageAsset[],
): void {
  const keys = transientBattleImageKeys(assets);
  if (keys.length === 0) return;
  const managerKey = scene.textures as object;
  const leases = transientTextureLeases.get(managerKey) ?? new Map<string, number>();
  transientTextureLeases.set(managerKey, leases);
  for (const key of keys) leases.set(key, (leases.get(key) ?? 0) + 1);
  scene.events.once("shutdown", () => {
    for (const key of keys) {
      const remaining = Math.max(0, (leases.get(key) ?? 1) - 1);
      if (remaining > 0) {
        leases.set(key, remaining);
        continue;
      }
      leases.delete(key);
      if (scene.textures.exists(key)) scene.textures.remove(key);
    }
    if (leases.size === 0) transientTextureLeases.delete(managerKey);
  });
}

export function summonImageAssets(heroIds: readonly string[]): readonly RuntimeImageAsset[] {
  return compactUnique(heroIds
    .filter((heroId) => Boolean(HERO_BY_ID[heroId]))
    .map((heroId) => HERO_ASSET_BY_ID.get(heroId)));
}

/** Queue only missing textures during a Scene preload phase. */
export function queueImageAssets(
  scene: Phaser.Scene,
  assets: readonly RuntimeImageAsset[],
  loadingLabel?: string,
): number {
  let queued = 0;
  for (const asset of assets) {
    if (!scene.textures.exists(asset.key)) {
      scene.load.image(asset.key, asset.url);
      queued += 1;
    }
  }
  if (queued > 0 && loadingLabel) showLoadingVoyage(scene, loadingLabel);
  return queued;
}

function showLoadingVoyage(scene: Phaser.Scene, label: string): void {
  const depth = 20_000;
  const backdrop = scene.add.rectangle(360, 640, 720, 1280, 0x031017, 1).setDepth(depth);
  const compass = scene.add.graphics().setDepth(depth + 1);
  compass.lineStyle(5, 0x5fc8ca, 0.78).strokeCircle(360, 548, 70);
  compass.lineStyle(2, 0xe4bd63, 0.75)
    .lineBetween(360, 464, 360, 632)
    .lineBetween(276, 548, 444, 548);
  compass.fillStyle(0xe4bd63, 0.92).fillTriangle(360, 482, 344, 558, 376, 558);
  const title = scene.add.text(360, 674, label, {
    fontFamily: "Malgun Gothic, sans-serif",
    fontStyle: "bold",
    fontSize: "22px",
    color: "#f5dfaa",
  }).setOrigin(0.5).setDepth(depth + 1);
  const track = scene.add.rectangle(360, 722, 360, 8, 0x15343a, 1).setDepth(depth + 1);
  const bar = scene.add.rectangle(180, 722, 1, 8, 0x61d0cb, 1).setOrigin(0, 0.5).setDepth(depth + 2);
  const progress = (value: number) => bar.setDisplaySize(Math.max(2, 360 * value), 8);
  const cleanup = () => {
    scene.load.off("progress", progress);
    scene.load.off("complete", cleanup);
    scene.events.off("shutdown", cleanup);
    for (const object of [backdrop, compass, title, track, bar]) object.destroy();
  };
  scene.load.on("progress", progress);
  scene.load.once("complete", cleanup);
  scene.events.once("shutdown", cleanup);
}
