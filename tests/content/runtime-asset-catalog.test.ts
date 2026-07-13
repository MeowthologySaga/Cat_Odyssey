import { describe, expect, it } from "vitest";
import { ENEMIES, HEROES, ROUTES, STAGES } from "../../src/data";
import {
  ENEMY_FALLBACK_TEXTURE_KEY,
  ENEMY_IMAGE_ASSETS,
  HERO_FALLBACK_TEXTURE_KEY,
  HERO_IMAGE_ASSETS,
  HAZARD_IMAGE_ASSETS,
  MAP_FALLBACK_TEXTURE_KEY,
  PROP_IMAGE_ASSETS,
  ROUTE_MAP_IMAGE_ASSETS,
  RUNTIME_IMAGE_ASSETS,
  enemyAssetUrl,
  heroAssetUrl,
  hazardTextureKey,
  propTextureKey,
  resolveEnemyTexture,
  resolveHeroTexture,
  resolveRouteMapTexture,
  resolveStageBackgroundTexture,
  routeMapAssetUrl,
  routeMapTextureKey,
  stageMapImageAsset,
  stageMapTextureKey,
  stagePropImageAssets,
  stagePropTextureKey,
  stageWallImageAssets,
  stageWallTextureKey,
  wallTextureKey,
  type TextureExistenceLookup,
} from "../../src/assets/runtimeAssetCatalog";

function textureLookup(...availableKeys: string[]): TextureExistenceLookup {
  const available = new Set(availableKeys);
  return { exists: (key: string) => available.has(key) };
}

describe("runtime image asset catalog", () => {
  it("preloads every hero by visualKey and the character flight convention", () => {
    expect(HERO_IMAGE_ASSETS).toHaveLength(HEROES.length);
    for (const hero of HEROES) {
      expect(HERO_IMAGE_ASSETS).toContainEqual({
        key: hero.visualKey,
        url: heroAssetUrl(hero.id),
        kind: "hero",
        sourceId: hero.id,
      });
      expect(heroAssetUrl(hero.id)).toBe(`assets/art/characters/${hero.id}-flight.webp`);
    }
  });

  it("preloads every normal enemy and boss by visualKey and type-specific convention", () => {
    expect(ENEMY_IMAGE_ASSETS).toHaveLength(ENEMIES.length);
    expect(ENEMY_IMAGE_ASSETS.filter((asset) => asset.kind === "enemy")).toHaveLength(
      ENEMIES.filter((enemy) => !enemy.boss).length,
    );
    expect(ENEMY_IMAGE_ASSETS.filter((asset) => asset.kind === "boss")).toHaveLength(
      ENEMIES.filter((enemy) => enemy.boss).length,
    );
    for (const enemy of ENEMIES) {
      const folder = enemy.boss ? "bosses" : "enemies";
      expect(ENEMY_IMAGE_ASSETS).toContainEqual({
        key: enemy.visualKey,
        url: `assets/art/${folder}/${enemy.id}.webp`,
        kind: enemy.boss ? "boss" : "enemy",
        sourceId: enemy.id,
      });
      expect(enemyAssetUrl(enemy)).toBe(`assets/art/${folder}/${enemy.id}.webp`);
    }
    expect(ENEMY_IMAGE_ASSETS.find((asset) => asset.sourceId === "wind-bag-tempest")).toEqual({
      key: "boss-wind-bag",
      url: "assets/art/bosses/wind-bag-tempest.webp",
      kind: "boss",
      sourceId: "wind-bag-tempest",
    });
  });

  it("loads each physical route base once and shares it across its stages", () => {
    expect(ROUTE_MAP_IMAGE_ASSETS).toHaveLength(ROUTES.length);
    expect(new Set(ROUTE_MAP_IMAGE_ASSETS.map((asset) => asset.url)).size).toBe(10);

    for (const route of ROUTES) {
      expect(ROUTE_MAP_IMAGE_ASSETS).toContainEqual({
        key: routeMapTextureKey(route.id),
        url: routeMapAssetUrl(route.id),
        kind: "route-map",
        sourceId: route.id,
      });
      expect(routeMapAssetUrl(route.id)).toBe(`assets/art/maps/routes/${route.id}.webp`);
    }
  });

  it("keeps every runtime texture key unique even when route files back several stages", () => {
    const keys = RUNTIME_IMAGE_ASSETS.map((asset) => asset.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(
      HEROES.length + ENEMIES.length + ROUTES.length + PROP_IMAGE_ASSETS.length + HAZARD_IMAGE_ASSETS.length,
    );
  });

  it("preloads stage props and hazard decals with deterministic semantic keys", () => {
    expect(PROP_IMAGE_ASSETS).toHaveLength(5);
    expect(HAZARD_IMAGE_ASSETS).toHaveLength(11);
    expect(PROP_IMAGE_ASSETS).toContainEqual({
      key: "prop-sleeping-sailor",
      url: "assets/art/props/sleeping-sailor.webp",
      kind: "prop",
      sourceId: "sleeping-sailor",
    });
    expect(HAZARD_IMAGE_ASSETS).toContainEqual({
      key: "hazard-whirlpool",
      url: "assets/art/hazards/whirlpool.webp",
      kind: "hazard",
      sourceId: "whirlpool",
    });
    expect(propTextureKey("axe-ring")).toBe("prop-axe-ring");
    expect(hazardTextureKey("portal")).toBe("hazard-portal");
    expect(stagePropTextureKey("rescue-a")).toBe("prop-sleeping-sailor");
    expect(stagePropTextureKey("memory")).toBe("hero-anticleia-ghost");
    expect(stagePropTextureKey("crystal-b")).toBe("prop-resonance-crystal");
    expect(stagePropTextureKey("paw-a")).toBe("prop-scylla-forepaw");
    expect(stagePropTextureKey("cattle-b")).toBe("prop-sacred-cattle");
    expect(stagePropTextureKey("ring-f")).toBe("prop-axe-ring");
    expect(stagePropTextureKey("unknown")).toBeUndefined();
  });

  it("registers stateful prop, wall and opt-in stage background art", () => {
    const prop = {
      id: "timber-tree-a",
      presentation: {
        visualId: "ogygia-tree-intact",
        stateVisualIds: { damaged: "ogygia-tree-damaged", stump: "ogygia-tree-stump" },
      },
    };
    expect(stagePropTextureKey(prop, "damaged")).toBe("prop-ogygia-tree-damaged");
    expect(stagePropImageAssets(prop).map((asset) => asset.key)).toEqual([
      "prop-ogygia-tree-intact",
      "prop-ogygia-tree-damaged",
      "prop-ogygia-tree-stump",
    ]);

    const wall = {
      id: "forest-edge",
      presentation: {
        visualId: "ogygia-root-wall",
        stateVisualIds: { damaged: "ogygia-root-wall-damaged" },
      },
    };
    expect(wallTextureKey("ogygia-root-wall")).toBe("wall-ogygia-root-wall");
    expect(stageWallTextureKey(wall, "damaged")).toBe("wall-ogygia-root-wall-damaged");
    expect(stageWallImageAssets(wall)).toHaveLength(2);

    expect(stageMapImageAsset({
      backgroundKey: "r01-s01-timber-grove",
      backgroundAssetUrl: "assets/art/maps/stages/r01-s01-timber-grove.webp",
    })).toEqual({
      key: "stage-map-r01-s01-timber-grove",
      url: "assets/art/maps/stages/r01-s01-timber-grove.webp",
      kind: "stage-map",
      sourceId: "r01-s01-timber-grove",
    });
  });

  it("resolves every Route 2 collider wall to the shared lotus wall sprite", () => {
    const routeTwoWalls = STAGES
      .filter((stage) => stage.routeId === "route-02-lotus")
      .flatMap((stage) => stage.walls);
    expect(routeTwoWalls).toHaveLength(8);
    for (const wall of routeTwoWalls) {
      expect(stageWallTextureKey(wall)).toBe("wall-lotus-dream-petal");
      expect(stageWallImageAssets(wall)).toEqual([{
        key: "wall-lotus-dream-petal",
        url: "assets/art/walls/wall-lotus-dream-petal.webp",
        kind: "wall",
        sourceId: "wall-lotus-dream-petal",
      }]);
    }
  });

  it("resolves Route 3 stone and wine-rack colliders to their authored wall sprites", () => {
    const routeThreeWalls = STAGES
      .filter((stage) => stage.routeId === "route-03-cyclops")
      .flatMap((stage) => stage.walls);
    expect(routeThreeWalls).toHaveLength(11);

    for (const wall of routeThreeWalls) {
      const visualId = wall.id.startsWith("wine-rack-")
        ? "wall-cyclops-wine-rack"
        : "wall-cyclops-slab";
      expect(stageWallTextureKey(wall)).toBe(visualId);
      expect(stageWallImageAssets(wall)).toEqual([{
        key: visualId,
        url: `assets/art/walls/${visualId}.webp`,
        kind: "wall",
        sourceId: visualId,
      }]);
    }
  });

  it("registers all four Route 4 foundation plates by their existing arena keys", () => {
    const routeFour = STAGES
      .filter((stage) => stage.routeId === "route-04-aeolus")
      .sort((left, right) => left.order - right.order);
    expect(routeFour.map((stage) => stageMapImageAsset(stage.arena))).toEqual(routeFour.map((stage) => ({
      key: stageMapTextureKey(stage.arena.backgroundKey),
      url: stage.arena.backgroundAssetUrl,
      kind: "stage-map",
      sourceId: stage.arena.backgroundKey,
    })));
  });

  it("resolves all eight Route 4 colliders to their biome-specific wall sprites", () => {
    const routeFour = STAGES
      .filter((stage) => stage.routeId === "route-04-aeolus")
      .sort((left, right) => left.order - right.order);
    const expectedVisualIds = [
      "wall-aeolus-cloud-crest",
      "wall-aeolus-bronze-gate",
      "wall-giant-harbor-breakwater",
      "wall-aeolus-bronze-gate",
    ];
    expect(routeFour.flatMap((stage) => stage.walls)).toHaveLength(8);
    for (const [stageIndex, stage] of routeFour.entries()) {
      const visualId = expectedVisualIds[stageIndex]!;
      for (const wall of stage.walls) {
        expect(stageWallTextureKey(wall)).toBe(visualId);
        expect(stageWallImageAssets(wall)).toEqual([{
          key: visualId,
          url: `assets/art/walls/${visualId}.webp`,
          kind: "wall",
          sourceId: visualId,
        }]);
      }
    }
  });

  it("uses visual keys when available and falls back safely when a load failed", () => {
    const hero = HEROES[0]!;
    const enemy = ENEMIES[0]!;
    const route = ROUTES[0]!;
    const available = textureLookup(
      hero.visualKey,
      enemy.visualKey,
      routeMapTextureKey(route.id),
      stageMapTextureKey("timber-grove"),
    );

    expect(resolveHeroTexture(available, hero)).toBe(hero.visualKey);
    expect(resolveEnemyTexture(available, enemy)).toBe(enemy.visualKey);
    expect(resolveRouteMapTexture(available, route.id)).toBe(routeMapTextureKey(route.id));
    expect(resolveStageBackgroundTexture(available, route.id, "timber-grove")).toBe(stageMapTextureKey("timber-grove"));
    expect(resolveStageBackgroundTexture(available, route.id, "missing-stage")).toBe(routeMapTextureKey(route.id));

    const missing = textureLookup();
    expect(resolveHeroTexture(missing, hero)).toBe(HERO_FALLBACK_TEXTURE_KEY);
    expect(resolveEnemyTexture(missing, enemy)).toBe(ENEMY_FALLBACK_TEXTURE_KEY);
    expect(resolveRouteMapTexture(missing, route.id)).toBe(MAP_FALLBACK_TEXTURE_KEY);
    expect(resolveStageBackgroundTexture(missing, route.id)).toBe(MAP_FALLBACK_TEXTURE_KEY);
  });

});
