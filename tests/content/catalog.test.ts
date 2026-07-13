import { describe, expect, it } from "vitest";

import {
  BLESSINGS,
  ENDGAME,
  ENEMIES,
  ENEMY_BEHAVIORS,
  HEROES,
  RELICS,
  ROUTES,
  STAGES,
} from "../../src/data";

function expectUniqueIds(items: readonly { readonly id: string }[]): void {
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
}

function containsFunction(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (Array.isArray(value)) return value.some(containsFunction);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsFunction);
  }
  return false;
}

describe("content catalog counts", () => {
  it("ships the promised launch catalog", () => {
    expect(HEROES).toHaveLength(16);
    expect(ENEMY_BEHAVIORS).toHaveLength(7);
    expect(ENEMIES.length).toBeGreaterThanOrEqual(20);
    expect(ROUTES).toHaveLength(10);
    expect(STAGES).toHaveLength(43);
    expect(BLESSINGS).toHaveLength(30);
    expect(RELICS).toHaveLength(32);
    expect(ENDGAME.oracleTower.floors).toHaveLength(30);
    expect(ENDGAME.stormRoute.nodes).toHaveLength(12);
    expect(ENDGAME.raid.phases).toHaveLength(3);
  });

  it("keeps every top-level id unique", () => {
    for (const catalog of [HEROES, ENEMY_BEHAVIORS, ENEMIES, ROUTES, STAGES, BLESSINGS, RELICS]) {
      expectUniqueIds(catalog);
    }
    expectUniqueIds(ENDGAME.oracleTower.floors);
  });
});

describe("Odyssey route structure", () => {
  it("preserves the canonical episode order", () => {
    expect(ROUTES.map((route) => route.id)).toEqual([
      "route-01-ogygia",
      "route-02-lotus",
      "route-03-cyclops",
      "route-04-aeolus",
      "route-05-circe",
      "route-06-underworld",
      "route-07-sirens",
      "route-08-strait",
      "route-09-thrinacia",
      "route-10-ithaca",
    ]);
  });

  it("uses seven four-stage routes and three five-stage core routes", () => {
    const regular = ROUTES.filter((route) => !route.coreRoute);
    const core = ROUTES.filter((route) => route.coreRoute);
    expect(regular).toHaveLength(7);
    expect(core).toHaveLength(3);
    expect(regular.every((route) => route.stageIds.length === 4)).toBe(true);
    expect(core.every((route) => route.stageIds.length === 5)).toBe(true);
    expect(core.map((route) => route.id)).toEqual([
      "route-03-cyclops",
      "route-08-strait",
      "route-10-ithaca",
    ]);
  });
});

describe("data-only authoring", () => {
  it("contains no embedded stage functions", () => {
    expect(containsFunction(STAGES)).toBe(false);
    expect(containsFunction(ENDGAME)).toBe(false);
  });

  it("uses only the seven common enemy behavior groups", () => {
    const behaviorIds = new Set(ENEMY_BEHAVIORS.map((behavior) => behavior.id));
    expect(behaviorIds).toEqual(
      new Set(["charger", "shooter", "shield", "heavy", "support", "splitter", "summoner"]),
    );
    expect(ENEMIES.every((enemy) => behaviorIds.has(enemy.behaviorId))).toBe(true);
  });
});

describe("canonical boss invariants", () => {
  it("locks Poly-meow-mus to one eye", () => {
    const stage = STAGES.find((candidate) => candidate.boss?.bossId === "poly-meow-mus");
    expect(stage).toBeDefined();
    expect(stage?.boss?.anatomy.eyes).toBe(1);
    const eyeCount = stage?.boss?.parts
      .filter((part) => part.kind === "eye")
      .reduce((sum, part) => sum + part.count, 0);
    expect(eyeCount).toBe(1);
  });

  it("locks Scylla to six heads, six necks, and two forepaws", () => {
    const stage = STAGES.find((candidate) => candidate.boss?.bossId === "scylla-cat");
    expect(stage).toBeDefined();
    expect(stage?.boss?.anatomy).toEqual({ heads: 6, necks: 6, forepaws: 2 });
    const count = (kind: "head" | "neck" | "forepaw") =>
      stage?.boss?.parts.filter((part) => part.kind === kind).reduce((sum, part) => sum + part.count, 0);
    expect(count("head")).toBe(6);
    expect(count("neck")).toBe(6);
    expect(count("forepaw")).toBe(2);
    expect(ENDGAME.raid.anatomy).toEqual({ heads: 6, necks: 6, forepaws: 2 });
  });
});

describe("endgame recipes", () => {
  it("has sequential tower floors and a boss every fifth floor", () => {
    ENDGAME.oracleTower.floors.forEach((floor, index) => {
      expect(floor.floor).toBe(index + 1);
      expect(floor.bossFloor).toBe((index + 1) % 5 === 0);
      expect(floor.lockoutFloors).toBe(3);
    });
  });

  it("defines the exact twelve-node weekly storm route", () => {
    expect(ENDGAME.stormRoute.nodeCount).toBe(12);
    expect(ENDGAME.stormRoute.nodes.map((node) => node.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(ENDGAME.stormRoute.nodes.at(-1)?.type).toBe("boss");
  });

  it("requires three non-overlapping four-hero raid parties", () => {
    expect(ENDGAME.raid.partiesRequired).toBe(3);
    expect(ENDGAME.raid.heroesPerParty).toBe(4);
    expect(ENDGAME.raid.duplicateHeroesAllowed).toBe(false);
    expect(ENDGAME.raid.phases.map((phase) => phase.party)).toEqual([1, 2, 3]);
  });
});
