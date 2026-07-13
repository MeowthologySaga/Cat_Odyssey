import { describe, expect, it } from "vitest";
import { HEROES, STAGES } from "../../src/data";
import {
  CORE_IMAGE_ASSETS,
  battleImageAssets,
  partyImageAssets,
  routeSelectionImageAssets,
  runtimeSpawnedEnemyIdsForStage,
  summonImageAssets,
  transientBattleImageKeys,
} from "../../src/assets/assetStreaming";

describe("scene-scoped asset streaming", () => {
  it("keeps boot assets intentionally small", () => {
    expect(CORE_IMAGE_ASSETS.map((asset) => asset.key)).toEqual(["arena-cyclops", "harbor-hub"]);
  });

  it("loads only requested party and summon heroes", () => {
    const ids = HEROES.slice(0, 3).map((hero) => hero.id);
    expect(partyImageAssets(ids).map((asset) => asset.sourceId)).toEqual(ids);
    expect(summonImageAssets(ids).map((asset) => asset.sourceId)).toEqual(ids);
  });

  it("deduplicates a battle's route, heroes, enemies, hazards and props", () => {
    const stage = STAGES.find((entry) => entry.id === "r02-s02")!;
    const assets = battleImageAssets(stage, HEROES.slice(0, 3).map((hero) => hero.id));
    const keys = assets.map((asset) => asset.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("route-map-route-02-lotus");
    expect(keys).toContain("prop-sleeping-sailor");
    expect(keys).toContain("hazard-slow-field");
  });

  it.each([
    ["cave-herder", "foam-crab"],
    ["abyss-priest", "underworld-wisp"],
    ["suitor-captain", "suitor-hoplon"],
    ["storm-avatar", "storm-jelly"],
    ["circe-apprentice", "split-anemone"],
  ] as const)("preloads the runtime minion for %s", (summonerId, minionId) => {
    const stage = {
      ...STAGES[0]!,
      enemies: [{ enemyId: summonerId, spawnId: "e1", level: 1 }],
      modifiers: [],
    };
    const dynamicIds = runtimeSpawnedEnemyIdsForStage(stage);
    const sourceIds = battleImageAssets(stage, []).map((asset) => asset.sourceId);
    expect(dynamicIds).toContain(minionId);
    expect(sourceIds).toContain(minionId);
  });

  it("preloads only the relevant summoned family and authored scripted reinforcement", () => {
    const stage = {
      ...STAGES[0]!,
      enemies: [{ enemyId: "cave-herder", spawnId: "e1", level: 1 }],
      modifiers: ["reinforcement-at-turn-six"],
    };
    expect(runtimeSpawnedEnemyIdsForStage(stage)).toEqual(["foam-crab", "suitor-sniper"]);
    const sourceIds = battleImageAssets(stage, []).map((asset) => asset.sourceId);
    expect(sourceIds).toContain("foam-crab");
    expect(sourceIds).toContain("suitor-sniper");
    expect(sourceIds).not.toContain("storm-jelly");
    expect(sourceIds).not.toContain("underworld-wisp");
    expect(sourceIds).not.toContain("split-anemone");
  });

  it("defers all ten route maps until route selection", () => {
    expect(routeSelectionImageAssets()).toHaveLength(10);
  });

  it("evicts large encounter-only art while retaining shared route, hero, and hazard textures", () => {
    const stage = STAGES.find((entry) => entry.id === "r03-s05")!;
    const assets = battleImageAssets(stage, [HEROES[0]!.id]);
    const transient = transientBattleImageKeys(assets);
    expect(transient).toContain(`stage-map-${stage.arena.backgroundKey}`);
    expect(transient.some((key) => key.startsWith("wall-"))).toBe(true);
    expect(transient).toContain(ENEMY_BY_STAGE(stage));
    expect(transient).not.toContain(`route-map-${stage.routeId}`);
    expect(transient).not.toContain(HEROES[0]!.visualKey);
    expect(transient.some((key) => key.startsWith("hazard-"))).toBe(false);
  });
});

function ENEMY_BY_STAGE(stage: (typeof STAGES)[number]): string {
  const enemyId = stage.enemies[0]!.enemyId;
  return battleImageAssets(stage, []).find((asset) => asset.sourceId === enemyId)!.key;
}
