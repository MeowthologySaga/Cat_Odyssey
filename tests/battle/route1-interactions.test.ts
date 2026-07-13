import { describe, expect, it } from "vitest";

import {
  createBattleRuntime,
  restoreBattleRuntime,
  type BattleRuntime,
  type BattleSetup,
} from "../../src/core/battle";
import type { EnemyDefinition, HeroDefinition, StageDefinition } from "../../src/data";
import { normalize, vec2 } from "../../src/simulation";

const TEST_HERO: HeroDefinition = {
  id: "route-one-tester",
  canonicalRefId: "route-one-tester",
  name: "Route One Tester",
  original: "test",
  epithet: "test",
  rarity: 3,
  element: "sea",
  ricochetClass: "bounce",
  radius: 10,
  mass: 1,
  restitution: 1,
  stats: { hp: 200, attack: 100, speed: 100 },
  friendshipSkill: { name: "friend", effects: [] },
  activeSkill: { name: "active", chargeTurns: 3, effects: [] },
  unlock: "starter",
  visualKey: "route-one-tester",
  tags: [],
};

const TRIAL_BOSS: EnemyDefinition = {
  id: "cat-lypso-trial-test",
  name: "Cat-Lypso Trial",
  behaviorId: "support",
  element: "spirit",
  radius: 26,
  stats: { hp: 50, attack: 1, speed: 1 },
  attackCountdown: 99,
  attack: { kind: "support", power: 1, range: 80 },
  boss: true,
  visualKey: "cat-lypso-trial-test",
  tags: [],
};

function stage(overrides: Partial<StageDefinition>): StageDefinition {
  return {
    id: "route-one-runtime-test",
    routeId: "route-01-ogygia",
    order: 1,
    name: "Route One Runtime Test",
    recommendedPower: 1,
    arena: {
      id: "route-one-runtime-arena",
      theme: "ogygia",
      width: 720,
      height: 1040,
      backgroundKey: "route-one-runtime-test",
      musicKey: "none",
    },
    walls: [],
    spawns: [{ id: "party", kind: "party", x: 80, y: 100, radius: 10 }],
    enemies: [],
    hazards: [],
    objective: { type: "defeat-all", turnLimit: 12, targetIds: [] },
    rewards: {
      gold: 0,
      heroXp: 0,
      materials: {},
      firstClear: { kind: "material", id: "none", amount: 0 },
    },
    modifiers: [],
    boss: null,
    ...overrides,
  };
}

function setup(authoredStage: StageDefinition, enemies: readonly EnemyDefinition[] = []): BattleSetup {
  return {
    stage: authoredStage,
    party: [TEST_HERO],
    enemyCatalog: Object.fromEntries(enemies.map((enemy) => [enemy.id, enemy])),
    seed: "route-one-interactions",
    config: {
      fixedStep: 1 / 120,
      maxProjectileDuration: 0.65,
      minLaunchSpeed: 400,
      maxLaunchSpeed: 400,
      damageVariance: 0,
      criticalChance: 0,
    },
  };
}

function playToward(runtime: BattleRuntime, target: { x: number; y: number }): void {
  const actor = runtime.getSnapshot().party[runtime.getSnapshot().activePartyIndex]!;
  runtime.setAim({ direction: normalize(vec2(target.x - actor.position.x, target.y - actor.position.y)), power: 1 });
  expect(runtime.launch()).toBeTruthy();
  for (let index = 0; index < 1_000; index += 1) {
    if (runtime.getSnapshot().phase !== "projectile") return;
    runtime.advance(1 / 60);
  }
  throw new Error("Projectile did not resolve.");
}

describe("Route 1 interaction runtime", () => {
  it("progresses a durable tree through intact, damaged, fallen and persistent stump states", () => {
    const authored = stage({
      spawns: [
        { id: "party", kind: "party", x: 80, y: 100, radius: 10 },
        {
          id: "timber-tree-a",
          kind: "prop",
          x: 180,
          y: 100,
          radius: 24,
          interaction: { mode: "destructible", maxHp: 280 },
        },
      ],
      objective: { type: "break-parts", turnLimit: 8, targetIds: ["timber-tree-a"], requiredCount: 1 },
    });
    const runtime = createBattleRuntime(setup(authored));
    expect(runtime.getSnapshot().props[0]?.visualState).toBe("intact");

    playToward(runtime, runtime.getSnapshot().props[0]!.position);
    expect(runtime.getSnapshot().props[0]).toMatchObject({ visualState: "damaged", hp: 180, active: true });
    playToward(runtime, runtime.getSnapshot().props[0]!.position);
    expect(runtime.getSnapshot().props[0]).toMatchObject({ visualState: "fallen", hp: 80, active: true });
    playToward(runtime, runtime.getSnapshot().props[0]!.position);

    expect(runtime.getSnapshot().phase).toBe("victory");
    expect(runtime.getSnapshot().props[0]).toMatchObject({
      visualState: "stump",
      state: "broken",
      hp: 0,
      active: false,
    });
  });

  it("moves an assembly piece toward its clamped slot and disables it after lashing", () => {
    const authored = stage({
      spawns: [
        { id: "party", kind: "party", x: 80, y: 100, radius: 10 },
        {
          id: "raft-lash-a",
          kind: "prop",
          x: 180,
          y: 100,
          radius: 24,
          interaction: { mode: "assembly", hitsRequired: 2, destination: { x: 900, y: 100 } },
        },
      ],
      objective: { type: "assemble", turnLimit: 8, targetIds: ["raft-lash-a"], requiredCount: 1 },
    });
    const runtime = createBattleRuntime(setup(authored));
    playToward(runtime, runtime.getSnapshot().props[0]!.position);
    expect(runtime.getSnapshot().props[0]).toMatchObject({
      visualState: "positioned",
      progress: 1,
      requiredProgress: 2,
      active: true,
    });
    expect(runtime.getSnapshot().props[0]!.position.x).toBe(438);

    playToward(runtime, runtime.getSnapshot().props[0]!.position);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.phase).toBe("victory");
    expect(snapshot.objective.current).toBe(1);
    expect(snapshot.props[0]).toMatchObject({
      visualState: "lashed",
      state: "awakened",
      progress: 2,
      active: false,
      position: { x: 696, y: 100 },
    });
    expect(snapshot.objective.targets[0]?.active).toBe(false);
  });

  it("counts an assembly piece at most once when one ricochet crosses it twice", () => {
    const authored = stage({
      walls: [{
        id: "assembly-bounce-wall",
        shape: "segment",
        x: 300,
        y: 0,
        x2: 300,
        y2: 300,
        material: "wood",
        restitution: 1,
      }],
      spawns: [
        { id: "party", kind: "party", x: 80, y: 100, radius: 10 },
        {
          id: "raft-lash-a",
          kind: "prop",
          x: 180,
          y: 100,
          radius: 24,
          interaction: { mode: "assembly", hitsRequired: 2, destination: { x: 240, y: 100 } },
        },
      ],
      objective: { type: "assemble", turnLimit: 8, targetIds: ["raft-lash-a"], requiredCount: 1 },
    });
    const battleSetup = setup(authored);
    battleSetup.config!.maxProjectileDuration = 1.2;
    const runtime = createBattleRuntime(battleSetup);
    playToward(runtime, { x: 300, y: 100 });

    expect(runtime.getSnapshot().phase).toBe("awaitingAim");
    expect(runtime.getSnapshot().props[0]).toMatchObject({
      visualState: "positioned",
      progress: 1,
      requiredProgress: 2,
      active: true,
    });
  });

  it("keeps a nonlethal trial boss alive and wins by severing the authored island bond", () => {
    const authored = stage({
      spawns: [
        { id: "party", kind: "party", x: 80, y: 100, radius: 10 },
        { id: "cat-lypso", kind: "boss", x: 180, y: 100, radius: 26 },
        {
          id: "island-bond-a",
          kind: "prop",
          x: 400,
          y: 300,
          radius: 24,
          interaction: { mode: "bond", maxHp: 50 },
        },
      ],
      enemies: [{ enemyId: TRIAL_BOSS.id, spawnId: "cat-lypso", level: 1 }],
      objective: { type: "break-parts", turnLimit: 8, targetIds: ["island-bond-a"], requiredCount: 1 },
      modifiers: ["boss-cannot-be-killed"],
    });
    const runtime = createBattleRuntime(setup(authored, [TRIAL_BOSS]));
    playToward(runtime, { x: 180, y: 100 });
    expect(runtime.getSnapshot().enemies[0]).toMatchObject({ hp: 1, alive: true });
    expect(runtime.getSnapshot().phase).not.toBe("victory");

    playToward(runtime, runtime.getSnapshot().props[0]!.position);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.phase).toBe("victory");
    expect(snapshot.enemies[0]).toMatchObject({ hp: 1, alive: true });
    expect(snapshot.props[0]).toMatchObject({ visualState: "severed", active: false });
  });

  it("advances a horizontal wave on the y movement axis and hits a stationary hero at turn boundary", () => {
    const authored = stage({
      spawns: [{ id: "party", kind: "party", x: 80, y: 100, radius: 10 }],
      hazards: [{
        id: "wave-crest",
        type: "wave-front",
        x: 360,
        y: 100,
        radius: 36,
        parameters: {
          axis: "y",
          direction: 1,
          distance: 0,
          length: 720,
          warningTurns: 1,
          activeTurns: 1,
          damage: 30,
          pushDistance: 34,
        },
      }],
      objective: { type: "survive", turnLimit: 3, targetIds: [] },
    });
    const runtime = createBattleRuntime(setup(authored));
    playToward(runtime, { x: 140, y: 100 });
    expect(runtime.getSnapshot().party[0]).toMatchObject({ hp: 200, position: { y: 100 } });
    playToward(runtime, { x: 200, y: 100 });

    const snapshot = runtime.getSnapshot();
    expect(snapshot.hazards[0]).toMatchObject({ position: { x: 360, y: 100 } });
    expect(snapshot.party[0]).toMatchObject({ hp: 170, position: { y: 134 }, alive: true });
    expect(runtime.drainEvents().some((event) => event.type === "hazardTriggered" && event.effectKind === "wave-front")).toBe(true);
  });

  it("backfills new prop fields when restoring a legacy rescue snapshot", () => {
    const authored = stage({
      spawns: [
        { id: "party", kind: "party", x: 80, y: 100, radius: 10 },
        {
          id: "timber-tree-a",
          kind: "prop",
          x: 180,
          y: 100,
          radius: 24,
          interaction: { mode: "destructible", maxHp: 280 },
        },
      ],
      objective: { type: "break-parts", turnLimit: 8, targetIds: ["timber-tree-a"] },
    });
    const battleSetup = setup(authored);
    const snapshot = createBattleRuntime(battleSetup).getSnapshot();
    const legacyProp = snapshot.props[0] as Partial<(typeof snapshot.props)[number]>;
    delete legacyProp.origin;
    delete legacyProp.destination;
    delete legacyProp.visualState;
    delete legacyProp.interactionMode;
    delete legacyProp.progress;
    delete legacyProp.requiredProgress;

    const restored = restoreBattleRuntime(battleSetup, snapshot).getSnapshot().props[0]!;
    expect(restored).toMatchObject({
      origin: { x: 180, y: 100 },
      visualState: "intact",
      interactionMode: "destructible",
      progress: 0,
      requiredProgress: 280,
    });
  });
});
