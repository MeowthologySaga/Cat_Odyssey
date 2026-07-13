import { describe, expect, it } from "vitest";
import {
  BATTLE_RUNTIME_MODIFIER_FLAGS,
  BATTLE_SCENE_MODIFIER_FLAGS,
  createBattleRuntime,
  restoreBattleRuntime,
  type BattleEnemyIntentState,
  type BattleEnemyState,
  type BattleSetup,
  type BattleSnapshot,
} from "../../src/core/battle";
import { compileStageDefinitionModifiers } from "../../src/core/battle/stageModifiers";
import type {
  EnemyDefinition,
  HeroDefinition,
  StageDefinition,
} from "../../src/data/types";
import { ENEMY_BY_ID, HEROES, STAGES } from "../../src/data";
import { vec2 } from "../../src/simulation";

function hero(id: string, overrides: Partial<HeroDefinition> = {}): HeroDefinition {
  return {
    id,
    canonicalRefId: id,
    name: id,
    original: id,
    epithet: "test",
    rarity: 3,
    element: "sea",
    ricochetClass: "bounce",
    radius: 10,
    mass: 1,
    restitution: 1,
    stats: { hp: 200, attack: 50, speed: 100 },
    friendshipSkill: { name: "friend", effects: [] },
    activeSkill: { name: "active", chargeTurns: 3, effects: [] },
    unlock: "starter",
    visualKey: id,
    tags: [],
    ...overrides,
  };
}

function enemy(id: string, overrides: Partial<EnemyDefinition> = {}): EnemyDefinition {
  return {
    id,
    name: id,
    behaviorId: "charger",
    element: "earth",
    radius: 20,
    stats: { hp: 300, attack: 40, speed: 50 },
    attackCountdown: 3,
    attack: { kind: "melee", power: 30, range: 100 },
    boss: false,
    visualKey: id,
    tags: [],
    ...overrides,
  };
}

function stage(
  enemyIds: readonly string[],
  options: { wallX?: number; turnLimit?: number; enemyX?: number } = {},
): StageDefinition {
  const enemyX = options.enemyX ?? 300;
  return {
    id: "test-stage",
    routeId: "test-route",
    order: 1,
    name: "Test",
    recommendedPower: 1,
    arena: {
      id: "test-arena",
      theme: "test",
      width: 720,
      height: 1040,
      backgroundKey: "none",
      musicKey: "none",
    },
    walls: options.wallX === undefined ? [] : [{
      id: "right-wall",
      shape: "segment",
      x: options.wallX,
      y: 0,
      x2: options.wallX,
      y2: 300,
      material: "stone",
      restitution: 1,
    }],
    spawns: [
      { id: "party", kind: "party", x: 100, y: 100, radius: 10 },
      ...enemyIds.map((id, index) => ({
        id: `enemy-${index}`,
        kind: "enemy" as const,
        x: enemyX + index * 80,
        y: 100,
        radius: 20,
      })),
    ],
    enemies: enemyIds.map((id, index) => ({ enemyId: id, spawnId: `enemy-${index}`, level: 1 })),
    hazards: [],
    objective: { type: "defeat-all", turnLimit: options.turnLimit ?? 20, targetIds: [] },
    rewards: {
      gold: 1,
      heroXp: 1,
      materials: {},
      firstClear: { kind: "material", id: "test", amount: 1 },
    },
    modifiers: [],
    boss: null,
  };
}

function setup(
  party: readonly HeroDefinition[],
  enemies: readonly EnemyDefinition[],
  options: {
    wallX?: number;
    enemyX?: number;
    seed?: string;
    duration?: number;
    weakpoint?: boolean;
    turnLimit?: number;
  } = {},
): BattleSetup {
  return {
    stage: stage(enemies.map((entry) => entry.id), options),
    party,
    enemyCatalog: Object.fromEntries(enemies.map((entry) => [entry.id, entry])),
    seed: options.seed ?? "battle-seed",
    config: {
      fixedStep: 1 / 120,
      maxProjectileDuration: options.duration ?? 0.3,
      minLaunchSpeed: 400,
      maxLaunchSpeed: 400,
      damageVariance: 0.08,
      criticalChance: 0.15,
    },
    partyPositions: party.map((_, index) => vec2(100, 100 + index * 80)),
    weakpoints: options.weakpoint ? [{
      id: "eye",
      enemyInstanceId: "enemy-0",
      partId: "eye",
      position: vec2((options.enemyX ?? 300), 100),
      radius: 5,
      maxHp: 40,
      damageMultiplier: 1.5,
      breakable: true,
    }] : undefined,
  };
}

function playOneTurn(runtime: ReturnType<typeof createBattleRuntime>, chunk = 1 / 60): void {
  playTurn(runtime, vec2(1, 0), chunk);
}

function playTurn(
  runtime: ReturnType<typeof createBattleRuntime>,
  direction: ReturnType<typeof vec2>,
  chunk = 1 / 60,
): void {
  runtime.setAim({ direction, power: 1 });
  runtime.launch();
  for (let index = 0; index < 1000; index += 1) {
    if (runtime.getSnapshot().phase !== "projectile") return;
    runtime.advance(chunk);
  }
  throw new Error("Projectile turn did not finish.");
}

function resolutionIntent(
  runtime: ReturnType<typeof createBattleRuntime>,
  enemyId = "enemy-0",
): BattleEnemyIntentState {
  const inspectable = runtime as unknown as {
    state: BattleSnapshot;
    enemyIntentForResolution(enemy: BattleEnemyState): BattleEnemyIntentState;
  };
  const enemyState = inspectable.state.enemies.find((entry) => entry.id === enemyId);
  if (!enemyState) throw new Error(`Missing enemy '${enemyId}'.`);
  return inspectable.enemyIntentForResolution(enemyState);
}

describe("BattleRuntime", () => {
  it("publishes the exact enemy-centered area radius used by a phased boss", () => {
    const heavyBoss = enemy("area-boss", {
      behaviorId: "heavy",
      boss: true,
      attackCountdown: 1,
      radius: 20,
      attack: { kind: "shockwave", power: 40, range: 60 },
    });
    const battleSetup = setup([hero("area-target")], [heavyBoss], { enemyX: 170 });
    const initial = createBattleRuntime(battleSetup).getSnapshot();
    initial.stagePhase = 3;
    const snapshot = restoreBattleRuntime(battleSetup, initial).getSnapshot();

    expect(snapshot.enemyIntents[0]).toMatchObject({
      intentKind: "area",
      targetPosition: { x: 170, y: 100 },
      areaRadius: 86,
    });
  });

  it("honors the target announced before the launched cat changes nearest-target order", () => {
    const shooter = enemy("intent-shooter", {
      behaviorId: "shooter",
      attackCountdown: 1,
      attack: { kind: "shot", power: 20, range: 700 },
    });
    const runtime = createBattleRuntime(setup(
      [hero("announced-target"), hero("near-after-shot")],
      [shooter],
      { enemyX: 300, duration: 0.3 },
    ));
    expect(runtime.getSnapshot().enemyIntents[0]?.primaryTargetId).toBe("announced-target");
    runtime.drainEvents();

    playTurn(runtime, vec2(0, 1));
    const action = runtime.drainEvents().find((event) => event.type === "enemyActionStarted");
    expect(action?.targetId).toBe("announced-target");
  });

  it("rechecks newly raised cover while preserving the announced ranged target", () => {
    const shooter = enemy("dynamic-cover-shooter", {
      behaviorId: "shooter",
      attackCountdown: 1,
      attack: { kind: "dynamic-shot", power: 20, range: 700 },
    });
    const runtime = createBattleRuntime(setup(
      [hero("announced-target")],
      [shooter],
      { enemyX: 700 },
    ));
    const inspectable = runtime as unknown as { state: BattleSnapshot };
    expect(inspectable.state.enemyIntents[0]).toMatchObject({
      primaryTargetId: "announced-target",
      targetIds: ["announced-target"],
      blockedBy: undefined,
    });

    inspectable.state.hazards.push({
      id: "late-friend-wall",
      type: "moving-bumper",
      origin: vec2(400, 100),
      position: vec2(400, 100),
      radius: 30,
      active: true,
      phase: 0,
      remainingTurns: 3,
      spawnedBy: "announced-target",
      parameters: {
        shape: "segment",
        length: 220,
        angle: Math.PI / 2,
        fixed: true,
        distance: 0,
        hp: 100,
        maxHp: 100,
      },
    });

    expect(resolutionIntent(runtime)).toMatchObject({
      primaryTargetId: "announced-target",
      targetIds: ["announced-target"],
      status: "blocked",
      blockedBy: "cover",
    });
  });

  it("clears stale cover after the announced ranged shot's wall is broken", () => {
    const shooter = enemy("broken-cover-shooter", {
      behaviorId: "shooter",
      attackCountdown: 1,
      attack: { kind: "dynamic-shot", power: 20, range: 700 },
    });
    const battleSetup = setup(
      [hero("announced-target")],
      [shooter],
      { enemyX: 700, wallX: 400 },
    );
    const runtime = createBattleRuntime(battleSetup);
    const inspectable = runtime as unknown as { state: BattleSnapshot };
    expect(inspectable.state.enemyIntents[0]).toMatchObject({
      primaryTargetId: "announced-target",
      targetIds: ["announced-target"],
      status: "blocked",
      blockedBy: "cover",
    });

    inspectable.state.walls[0]!.broken = true;
    inspectable.state.walls[0]!.active = false;

    expect(resolutionIntent(runtime)).toMatchObject({
      primaryTargetId: "announced-target",
      targetIds: ["announced-target"],
      status: "ready",
      blockedBy: undefined,
    });
  });

  it("rotates living party members in stable party order", () => {
    const foe = enemy("dummy", { attackCountdown: 99, stats: { hp: 9999, attack: 1, speed: 1 } });
    const runtime = createBattleRuntime(setup(
      [hero("h1"), hero("h2"), hero("h3"), hero("h4")],
      [foe],
      { enemyX: 900, duration: 0.05 },
    ));
    runtime.drainEvents();

    playOneTurn(runtime);
    expect(runtime.getSnapshot().activePartyIndex).toBe(1);
    playOneTurn(runtime);
    expect(runtime.getSnapshot().activePartyIndex).toBe(2);
    playOneTurn(runtime);
    expect(runtime.getSnapshot().activePartyIndex).toBe(3);
    playOneTurn(runtime);
    expect(runtime.getSnapshot().activePartyIndex).toBe(0);
    expect(runtime.getSnapshot().turnNumber).toBe(5);
  });

  it("keeps aim preview and launched trajectory identical", () => {
    const runtime = createBattleRuntime(setup([hero("h1")], [enemy("dummy")], { wallX: 500, duration: 1.2 }));
    const preview = runtime.setAim({ direction: vec2(1, 0), power: 0.75 });
    expect(runtime.getSnapshot().phase).toBe("aiming");
    const launch = runtime.launch();
    expect(runtime.getSnapshot().phase).toBe("projectile");
    expect(launch?.trajectory).toEqual(preview?.trajectory);
  });

  it("blocks stunned heroes from aiming or launching and consumes the blocked turn safely", () => {
    const battleSetup = setup([hero("stunned")], [enemy("watcher", { attackCountdown: 99 })], {
      enemyX: 700,
      duration: 0.05,
    });
    const initial = createBattleRuntime(battleSetup).getSnapshot();
    initial.effects.push({
      id: "stage:stunned:stun",
      sourceId: "stage",
      targetId: "stunned",
      kind: "stun",
      value: 1,
      remainingTurns: 1,
      appliedTurn: 0,
    });
    const runtime = restoreBattleRuntime(battleSetup, initial);
    runtime.drainEvents();

    expect(runtime.getActionAvailability()).toEqual({ actorId: "stunned", allowed: false, reason: "stun" });
    expect(runtime.setAim({ direction: vec2(1, 0), power: 1 })).toBeNull();
    expect(runtime.launch({ direction: vec2(1, 0), power: 1 })).toBeNull();
    expect(runtime.skipBlockedTurn()).toMatchObject({ actorId: "stunned", allowed: false, reason: "stun" });
    expect(runtime.getActionAvailability()).toEqual({ actorId: "stunned", allowed: true });
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "heroActionBlocked",
      actorId: "stunned",
      effectKind: "stun",
    }));
  });

  it("does not enter an enemy phase when an objective stage has no living enemies", () => {
    const authoredStage = STAGES.find((entry) => entry.id === "r01-s01")!;
    const battleSetup: BattleSetup = {
      stage: authoredStage,
      party: [hero("lumber-cat")],
      enemyCatalog: ENEMY_BY_ID,
      seed: "enemyless-objective",
      config: { maxProjectileDuration: 0.02, minLaunchSpeed: 200, maxLaunchSpeed: 200 },
      partyPositions: [vec2(360, 920)],
    };
    const runtime = createBattleRuntime(battleSetup);
    runtime.drainEvents();
    playTurn(runtime, vec2(1, 0));
    const events = runtime.drainEvents();
    expect(runtime.getSnapshot().phase).toBe("awaitingAim");
    expect(events.some((event) => event.type === "enemyPhaseStarted" || event.type === "enemyPhaseEnded")).toBe(false);
  });

  it("resolves wall ricochets, body hits, weakpoints, and combo counters", () => {
    const foe = enemy("boss", { stats: { hp: 5000, attack: 1, speed: 1 }, attackCountdown: 99, boss: true });
    const runtime = createBattleRuntime(setup(
      [hero("h1", { stats: { hp: 200, attack: 60, speed: 100 } })],
      [foe],
      { wallX: 500, enemyX: 300, duration: 2.2, weakpoint: true },
    ));
    runtime.drainEvents();
    playOneTurn(runtime, 1 / 60);

    const snapshot = runtime.getSnapshot();
    const events = runtime.drainEvents();
    expect(snapshot.ricochetCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.comboCount).toBeGreaterThanOrEqual(3);
    expect(snapshot.bestCombo).toBe(snapshot.comboCount);
    expect(snapshot.enemies[0]!.hp).toBeLessThan(snapshot.enemies[0]!.maxHp);
    expect(snapshot.enemies[0]!.weakpoints[0]!.broken).toBe(true);
    expect(events.some((event) => event.type === "ricochet")).toBe(true);
    expect(events.some((event) => event.type === "enemyHit")).toBe(true);
    expect(events.some((event) => event.type === "weakpointHit")).toBe(true);
    expect(events.some((event) => event.type === "weakpointBroken")).toBe(true);
  });

  it("produces the same outcome for different render update chunk sizes", () => {
    const battleSetup = setup(
      [hero("h1")],
      [enemy("dummy", { stats: { hp: 1000, attack: 20, speed: 1 }, attackCountdown: 1 })],
      { wallX: 500, duration: 1.4, seed: "fixed-step" },
    );
    const a = createBattleRuntime(battleSetup);
    const b = createBattleRuntime(battleSetup);
    a.drainEvents();
    b.drainEvents();
    playOneTurn(a, 1 / 30);
    playOneTurn(b, 1 / 120);
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
    expect(a.drainEvents()).toEqual(b.drainEvents());
  });

  it("resolves enemy retaliation and a party defeat", () => {
    const fragile = hero("fragile", { stats: { hp: 20, attack: 1, speed: 100 } });
    const lethal = enemy("lethal", {
      stats: { hp: 9999, attack: 999, speed: 1 },
      attackCountdown: 1,
      attack: { kind: "smash", power: 999, range: 999 },
    });
    const runtime = createBattleRuntime(setup([fragile], [lethal], { enemyX: 900, duration: 0.05 }));
    runtime.drainEvents();
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    const events = runtime.drainEvents();
    expect(snapshot.phase).toBe("defeat");
    expect(snapshot.outcome).toEqual({ victory: false, reason: "partyDefeated", turnNumber: 1 });
    expect(events.some((event) => event.type === "enemyAttack")).toBe(true);
    expect(events.some((event) => event.type === "heroDefeated")).toBe(true);
    expect(events.at(-1)?.type).toBe("defeat");
  });

  it("keeps render-safe enemy intents in the snapshot before any retaliation event", () => {
    const shooter = enemy("intent-shooter", {
      behaviorId: "shooter",
      attackCountdown: 2,
      attack: { kind: "coral-bolt", power: 40, range: 999 },
    });
    const runtime = createBattleRuntime(setup(
      [hero("intent-target")],
      [shooter],
      { enemyX: 600, duration: 0.05 },
    ));

    expect(runtime.getSnapshot().enemyIntents).toEqual([expect.objectContaining({
      enemyId: "enemy-0",
      behaviorId: "shooter",
      attackKind: "coral-bolt",
      intentKind: "ranged",
      status: "countdown",
      countdown: 2,
      willActAfterCurrentTurn: false,
      primaryTargetId: "intent-target",
      targetIds: ["intent-target"],
      targetPosition: { x: 100, y: 100 },
      range: 999,
      areaRadius: 0,
    })]);
  });

  it("links telegraph, action, attack, and attributed damage with one action id", () => {
    const shooter = enemy("event-shooter", {
      behaviorId: "shooter",
      stats: { hp: 9999, attack: 70, speed: 1 },
      attackCountdown: 1,
      attack: { kind: "spirit-arrow", power: 70, range: 999 },
    });
    const runtime = createBattleRuntime(setup(
      [hero("event-target", { stats: { hp: 500, attack: 1, speed: 100 } })],
      [shooter],
      { enemyX: 600, duration: 0.05 },
    ));
    runtime.drainEvents();

    playOneTurn(runtime);
    const events = runtime.drainEvents();
    const actionStarted = events.find((event) => event.type === "enemyActionStarted");
    const attack = events.find((event) => event.type === "enemyAttack");
    const damaged = events.find((event) => event.type === "heroDamaged");
    const actionResolved = events.find((event) => event.type === "enemyActionResolved");

    expect(actionStarted?.actionId).toBeTruthy();
    expect(attack).toMatchObject({
      actionId: actionStarted?.actionId,
      sourceKind: "enemyAttack",
      actorId: "enemy-0",
      targetId: "event-target",
      attackKind: "spirit-arrow",
      intentKind: "ranged",
      outcomeKind: "hit",
    });
    expect(damaged).toMatchObject({
      actionId: actionStarted?.actionId,
      sourceKind: "enemyAttack",
      actorId: "enemy-0",
      targetId: "event-target",
      attackKind: "spirit-arrow",
      intentKind: "ranged",
      outcomeKind: "hit",
      hpBefore: 500,
    });
    expect(damaged!.hpBefore! - damaged!.hpAfter!).toBe(damaged!.amount);
    expect(actionResolved).toMatchObject({
      actionId: actionStarted?.actionId,
      actorId: "enemy-0",
      targetIds: ["event-target"],
      attackKind: "spirit-arrow",
      outcomeKind: "hit",
    });

    const eventOrder = (type: string) => events.findIndex((event) => event.type === type);
    expect(eventOrder("enemyPhaseStarted")).toBeLessThan(eventOrder("enemyTelegraph"));
    expect(eventOrder("enemyTelegraph")).toBeLessThan(eventOrder("enemyActionStarted"));
    expect(eventOrder("enemyActionStarted")).toBeLessThan(eventOrder("enemyAttack"));
    expect(eventOrder("enemyAttack")).toBeLessThan(eventOrder("heroDamaged"));
    expect(eventOrder("heroDamaged")).toBeLessThan(eventOrder("enemyActionResolved"));
    expect(eventOrder("enemyActionResolved")).toBeLessThan(eventOrder("enemyPhaseEnded"));
    expect(eventOrder("enemyPhaseEnded")).toBeLessThan(eventOrder("turnStarted"));
  });

  it("declares victory when the final enemy is defeated", () => {
    const weak = enemy("weak", { stats: { hp: 5, attack: 1, speed: 1 }, attackCountdown: 99 });
    const runtime = createBattleRuntime(setup(
      [hero("h1", { stats: { hp: 200, attack: 200, speed: 100 } })],
      [weak],
      { enemyX: 220, duration: 0.5 },
    ));
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(0.5);
    expect(runtime.getSnapshot().phase).toBe("victory");
    expect(runtime.getSnapshot().outcome?.reason).toBe("allEnemiesDefeated");
    expect(runtime.drainEvents().some((event) => event.type === "victory")).toBe(true);
  });

  it("restores a mid-flight JSON snapshot with identical seeded results", () => {
    const battleSetup = setup(
      [hero("h1")],
      [enemy("dummy", { stats: { hp: 1000, attack: 30, speed: 1 }, attackCountdown: 1 })],
      { wallX: 500, duration: 1.4, seed: "snapshot-replay" },
    );
    const original = createBattleRuntime(battleSetup);
    original.drainEvents();
    original.setAim({ direction: vec2(1, 0), power: 1 });
    original.launch();
    original.advance(0.2);

    const serialized = original.serialize();
    expect(() => JSON.parse(serialized)).not.toThrow();
    const restored = restoreBattleRuntime(battleSetup, serialized);
    original.drainEvents();
    restored.drainEvents();

    for (let index = 0; index < 200; index += 1) {
      if (original.getSnapshot().phase !== "projectile") break;
      original.advance(1 / 60);
      restored.advance(1 / 60);
    }
    expect(restored.getSnapshot()).toEqual(original.getSnapshot());
    expect(restored.drainEvents()).toEqual(original.drainEvents());
  });

  it("awakens every authored rescue prop and wins immediately at 2/2", () => {
    const foe = enemy("watcher", { stats: { hp: 9999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([hero("h1", { stats: { hp: 200, attack: 100, speed: 100 } })], [foe], {
      enemyX: 900,
      duration: 0.7,
    });
    const rescueStage: StageDefinition = {
      ...battleSetup.stage,
      spawns: [
        { id: "party", kind: "party", x: 100, y: 100, radius: 10 },
        { id: "rescue-a", kind: "prop", x: 190, y: 100, radius: 12 },
        { id: "rescue-b", kind: "prop", x: 300, y: 100, radius: 12 },
        { id: "enemy-0", kind: "enemy", x: 900, y: 100, radius: 20 },
      ],
      objective: { type: "protect", turnLimit: 8, targetIds: ["rescue-a", "rescue-b"], requiredCount: 2 },
      modifiers: ["ally-contact-cleanses-sleep"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: rescueStage });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(1);

    const snapshot = runtime.getSnapshot();
    const events = runtime.drainEvents();
    expect(snapshot.phase).toBe("victory");
    expect(snapshot.outcome?.reason).toBe("protected");
    expect(snapshot.objective.current).toBe(2);
    expect(snapshot.props.map((prop) => prop.state)).toEqual(["awakened", "awakened"]);
    expect(events.filter((event) => event.type === "objectiveProgressed")).toHaveLength(2);
  });

  it("does not auto-win an enemyless break-parts stage and completes prop targets on contact", () => {
    const battleSetup = setup([hero("h1")], [], { duration: 0.5 });
    const ringStage: StageDefinition = {
      ...battleSetup.stage,
      spawns: [
        { id: "party", kind: "party", x: 100, y: 100, radius: 10 },
        { id: "ring-a", kind: "prop", x: 220, y: 100, radius: 12 },
      ],
      objective: { type: "break-parts", turnLimit: 3, targetIds: ["ring-a"], requiredCount: 1 },
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: ringStage });
    expect(runtime.getSnapshot().phase).toBe("awaitingAim");
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(1);
    expect(runtime.getSnapshot().phase).toBe("victory");
    expect(runtime.getSnapshot().outcome?.reason).toBe("targetsCompleted");
    expect(runtime.getSnapshot().props[0]?.state).toBe("broken");
  });

  it("synthesizes the missing north exit and completes an escape objective", () => {
    const battleSetup = setup([hero("h1")], [], { duration: 1 });
    const escapeStage: StageDefinition = {
      ...battleSetup.stage,
      spawns: [{ id: "party", kind: "party", x: 360, y: 150, radius: 10 }],
      objective: { type: "escape", turnLimit: 3, targetIds: ["north-exit"], requiredCount: 1 },
    };
    const runtime = createBattleRuntime({
      ...battleSetup,
      stage: escapeStage,
      partyPositions: [vec2(360, 150)],
    });
    expect(runtime.getSnapshot().objective.targets[0]).toMatchObject({
      id: "north-exit",
      kind: "exit",
    });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(0, -1), power: 1 });
    runtime.launch();
    runtime.advance(1);
    expect(runtime.getSnapshot().outcome?.reason).toBe("escaped");
  });

  it("fails a protect objective when a forbidden target is struck", () => {
    const battleSetup = setup([hero("h1")], [], { duration: 0.5 });
    const tabooStage: StageDefinition = {
      ...battleSetup.stage,
      spawns: [
        { id: "party", kind: "party", x: 100, y: 100, radius: 10 },
        { id: "cattle", kind: "prop", x: 220, y: 100, radius: 20 },
      ],
      hazards: [{
        id: "taboo",
        type: "forbidden-target",
        x: 220,
        y: 100,
        radius: 25,
        parameters: { failOnHit: true },
      }],
      objective: { type: "protect", turnLimit: 3, targetIds: ["cattle"], requiredCount: 1 },
      modifiers: ["forbidden-target-contact-fails-stage"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: tabooStage });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(1);
    expect(runtime.getSnapshot().outcome?.reason).toBe("objectiveFailed");
    expect(runtime.drainEvents().some((event) => event.type === "objectiveFailed")).toBe(true);
  });

  it("counts contact with an unbreakable boss core toward a seal objective", () => {
    const foe = enemy("seal-boss", { stats: { hp: 9999, attack: 1, speed: 1 }, attackCountdown: 99, boss: true });
    const battleSetup = setup([hero("h1")], [foe], { enemyX: 220, duration: 0.5, weakpoint: true });
    const sealStage: StageDefinition = {
      ...battleSetup.stage,
      objective: { type: "seal", turnLimit: 3, targetIds: ["core"], requiredCount: 1 },
    };
    const runtime = createBattleRuntime({
      ...battleSetup,
      stage: sealStage,
      weakpoints: [{
        id: "core-instance",
        enemyInstanceId: "enemy-0",
        partId: "core",
        position: vec2(220, 100),
        radius: 8,
        maxHp: 9999,
        breakable: false,
      }],
    });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(1);
    expect(runtime.getSnapshot().outcome?.reason).toBe("sealed");
    expect(runtime.getSnapshot().objective.current).toBe(1);
  });

  it("damages breakable walls and advances moving-bumper state each turn", () => {
    const foe = enemy("watcher", { stats: { hp: 9999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([hero("h1", { stats: { hp: 200, attack: 999, speed: 100 } })], [foe], {
      enemyX: 900,
      duration: 0.5,
    });
    const mechanicStage: StageDefinition = {
      ...battleSetup.stage,
      walls: [{
        id: "break-wall",
        shape: "segment",
        x: 220,
        y: 0,
        x2: 220,
        y2: 300,
        material: "wood",
        restitution: 1,
        breakable: true,
        hp: 10,
      }],
      hazards: [{
        id: "bumper",
        type: "moving-bumper",
        x: 500,
        y: 500,
        radius: 20,
        parameters: { axis: "x", distance: 100, periodTurns: 2 },
      }],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: mechanicStage });
    runtime.drainEvents();
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    const events = runtime.drainEvents();
    expect(snapshot.walls[0]).toMatchObject({ broken: true, hp: 0 });
    expect(snapshot.hazards[0]?.position.x).not.toBe(snapshot.hazards[0]?.origin.x);
    expect(events.some((event) => event.type === "wallBroken")).toBe(true);
    expect(events.some((event) => event.type === "hazardMoved")).toBe(true);
  });

  const friendshipEffectKinds = [
    "nearest-barrage",
    "line-pierce",
    "projectile-guard",
    "bind",
    "regeneration",
    "chain-bounce",
    "push-wave",
    "cross-slash",
    "temporary-wall",
    "mark-weakpoint",
    "wind-vector",
    "shrink-enemy",
    "telegraph-extend",
    "wall-phase",
    "orbiting-blade",
    "follow-up-shot",
  ] as const;

  it.each(friendshipEffectKinds)("executes friendship effect '%s' on ally contact", (kind) => {
    const actor = hero("actor");
    const ally = hero("ally", {
      friendshipSkill: {
        name: `skill-${kind}`,
        effects: [{ kind, value: kind === "chain-bounce" ? 3 : 25, target: "test", durationTurns: 2 }],
      },
    });
    const foe = enemy("dummy", { stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([actor, ally], [foe], { enemyX: 340, duration: 0.35 });
    const runtime = createBattleRuntime({
      ...battleSetup,
      partyPositions: [vec2(100, 100), vec2(180, 100)],
    });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(0.5);
    const events = runtime.drainEvents();
    expect(events).toContainEqual(expect.objectContaining({
      type: "allySkillTriggered",
      actorId: "ally",
      targetId: "actor",
      effectKind: kind,
    }));
    const statusKinds = new Set([
      "projectile-guard", "bind", "regeneration", "temporary-wall", "mark-weakpoint",
      "wind-vector", "shrink-enemy", "telegraph-extend", "wall-phase",
    ]);
    if (statusKinds.has(kind)) {
      expect(events.some((event) => event.type === "statusEffectApplied" && event.effectKind === kind)).toBe(true);
    } else {
      expect(events.some((event) => event.type === "enemyHit" && event.effectKind === kind)).toBe(true);
    }
  });

  it("merges explicit scene weakpoints with missing authored objective parts", () => {
    const boss = enemy("objective-boss", { boss: true, stats: { hp: 9999, attack: 1, speed: 1 } });
    const battleSetup = setup([hero("h1")], [boss], { enemyX: 300, duration: 0.2 });
    const objectiveStage: StageDefinition = {
      ...battleSetup.stage,
      objective: {
        type: "break-parts",
        turnLimit: 10,
        targetIds: ["anti-shield", "anti-core"],
        requiredCount: 2,
      },
      boss: {
        bossId: boss.id,
        supportBossIds: [],
        phaseIds: [],
        anatomy: {},
        parts: [
          { id: "anti-shield", kind: "shield", count: 1, collider: "capsule", weakpoint: false, breakable: true },
          { id: "anti-core", kind: "core", count: 1, collider: "circle", weakpoint: true, breakable: true },
        ],
      },
    };
    const runtime = createBattleRuntime({
      ...battleSetup,
      stage: objectiveStage,
      weakpoints: [{
        id: "scene-core",
        enemyInstanceId: "enemy-0",
        partId: "anti-core",
        position: vec2(300, 100),
        radius: 8,
      }],
    });
    const snapshot = runtime.getSnapshot();
    expect(snapshot.enemies[0]?.weakpoints.map((part) => part.partId).sort()).toEqual(["anti-core", "anti-shield"]);
    expect(snapshot.objective.targets).toHaveLength(2);
  });

  it("moves chargers toward the nearest hero before resolving their hit", () => {
    const charger = enemy("charger", {
      behaviorId: "charger",
      attackCountdown: 1,
      stats: { hp: 9999, attack: 20, speed: 100 },
      attack: { kind: "charge", power: 20, range: 100 },
    });
    const battleSetup = setup([hero("h1")], [charger], { enemyX: 500, duration: 0.05 });
    const runtime = createBattleRuntime(battleSetup);
    runtime.drainEvents();
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.enemies[0]?.position.x).toBeLessThan(500);
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({ type: "enemyMoved", effectKind: "charger" }));
  });

  it("keeps shooters range-bound and emits a telegraph before repositioning", () => {
    const shooter = enemy("shooter", {
      behaviorId: "shooter",
      attackCountdown: 1,
      stats: { hp: 9999, attack: 100, speed: 50 },
      attack: { kind: "shot", power: 100, range: 100 },
    });
    const battleSetup = setup([hero("h1")], [shooter], { enemyX: 700, duration: 0.05 });
    const runtime = createBattleRuntime(battleSetup);
    runtime.drainEvents();
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    const events = runtime.drainEvents();
    expect(snapshot.party[0]?.hp).toBe(snapshot.party[0]?.maxHp);
    expect(snapshot.enemies[0]?.position.x).toBeLessThan(700);
    expect(events.some((event) => event.type === "enemyTelegraph")).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: "enemyMoved", effectKind: "shooter-reposition" }));
  });

  it("reduces shield-front damage and rewards rear contacts", () => {
    const guard = enemy("guard", {
      behaviorId: "shield",
      stats: { hp: 5000, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const base = setup([hero("h1", { stats: { hp: 200, attack: 100, speed: 100 } })], [guard], {
      enemyX: 300,
      duration: 0.55,
    });
    const centeredStage: StageDefinition = {
      ...base.stage,
      spawns: [
        { id: "party", kind: "party", x: 300, y: 500, radius: 10 },
        { id: "enemy-0", kind: "enemy", x: 300, y: 300, radius: 20 },
      ],
    };
    const common = {
      ...base,
      stage: centeredStage,
      config: { ...base.config, criticalChance: 0, damageVariance: 0, maxProjectileDuration: 0.55 },
    };
    const front = createBattleRuntime({ ...common, partyPositions: [vec2(300, 500)] });
    front.drainEvents();
    front.setAim({ direction: vec2(0, -1), power: 1 });
    front.launch();
    front.advance(1);
    const rear = createBattleRuntime({ ...common, partyPositions: [vec2(300, 100)] });
    rear.drainEvents();
    rear.setAim({ direction: vec2(0, 1), power: 1 });
    rear.launch();
    rear.advance(1);
    const frontDamage = front.getSnapshot().enemies[0]!.maxHp - front.getSnapshot().enemies[0]!.hp;
    const rearDamage = rear.getSnapshot().enemies[0]!.maxHp - rear.getSnapshot().enemies[0]!.hp;
    expect(rearDamage).toBeGreaterThan(frontDamage);
  });

  it("lets heavy enemies damage every hero inside their authored range", () => {
    const heavy = enemy("heavy", {
      behaviorId: "heavy",
      attackCountdown: 1,
      stats: { hp: 9999, attack: 40, speed: 1 },
      attack: { kind: "slam", power: 40, range: 220 },
    });
    const battleSetup = setup([hero("h1"), hero("h2")], [heavy], { enemyX: 300, duration: 0.05 });
    const runtime = createBattleRuntime({
      ...battleSetup,
      partyPositions: [vec2(280, 220), vec2(330, 220)],
    });
    runtime.drainEvents();
    playOneTurn(runtime);
    expect(runtime.getSnapshot().party.every((member) => member.hp < member.maxHp)).toBe(true);
  });

  it("moves heavy enemies toward the nearest target when their slam is out of range", () => {
    const heavy = enemy("approaching-heavy", {
      behaviorId: "heavy",
      attackCountdown: 1,
      stats: { hp: 9999, attack: 20, speed: 110 },
      attack: { kind: "slam", power: 20, range: 55 },
    });
    const runtime = createBattleRuntime(setup([hero("h1")], [heavy], { enemyX: 650, duration: 0.05 }));
    const before = runtime.getSnapshot().enemies[0]!.position.x;
    runtime.drainEvents();
    playTurn(runtime, vec2(0, 1));
    const events = runtime.drainEvents();
    expect(runtime.getSnapshot().enemies[0]!.position.x).toBeLessThan(before);
    expect(events).toContainEqual(expect.objectContaining({ type: "enemyMoved", actorId: "enemy-0" }));
  });

  it("lets support enemies heal their weakest ally and accelerate its countdown", () => {
    const support = enemy("support", {
      behaviorId: "support",
      attackCountdown: 1,
      attack: { kind: "heal", power: 50, range: 300 },
    });
    const allyEnemy = enemy("ally-enemy", { attackCountdown: 5, stats: { hp: 1000, attack: 1, speed: 1 } });
    const battleSetup = setup([hero("h1")], [support, allyEnemy], { enemyX: 700, duration: 0.05 });
    const initial = createBattleRuntime(battleSetup).getSnapshot();
    initial.enemies[1]!.hp = 100;
    const runtime = restoreBattleRuntime(battleSetup, initial);
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.enemies[1]!.hp).toBeGreaterThan(100);
    expect(snapshot.enemies[1]!.attackCountdown).toBeLessThan(4);
    expect(runtime.drainEvents().some((event) => event.type === "enemyHealed")).toBe(true);
  });

  it("splits a defeated splitter exactly once into renderable child states", () => {
    const splitter = enemy("splitter", {
      behaviorId: "splitter",
      stats: { hp: 5, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([hero("h1", { stats: { hp: 200, attack: 200, speed: 100 } })], [splitter], {
      enemyX: 220,
      duration: 0.5,
    });
    const runtime = createBattleRuntime(battleSetup);
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(1);
    const children = runtime.getSnapshot().enemies.filter((entry) => entry.parentId === "enemy-0" && entry.alive);
    expect(children).toHaveLength(2);
    expect(children.every((entry) => entry.splitUsed && entry.generation === 1)).toBe(true);
    expect(runtime.drainEvents().filter((event) => event.type === "enemySpawned")).toHaveLength(2);
    expect(runtime.getSnapshot().objective).toMatchObject({ current: 1, required: 3, completed: false });
  });

  it("lets summoners create capped catalog minions with unique instance ids", () => {
    const summoner = enemy("summoner", {
      behaviorId: "summoner",
      attackCountdown: 1,
      attack: { kind: "summon-foam-crab", power: 0, range: 200 },
    });
    const minion = enemy("foam-crab", { behaviorId: "charger" });
    const battleSetup = setup([hero("h1")], [summoner], { enemyX: 700, duration: 0.05 });
    const runtime = createBattleRuntime({
      ...battleSetup,
      enemyCatalog: { summoner, "foam-crab": minion },
    });
    runtime.drainEvents();
    playOneTurn(runtime);
    const spawned = runtime.getSnapshot().enemies.find((entry) => entry.parentId === "enemy-0");
    expect(spawned).toMatchObject({ definitionId: "foam-crab", generation: 1, alive: true });
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "enemySpawned",
      actorId: "enemy-0",
      targetId: "enemy-0:summon:1",
    }));
    expect(runtime.getSnapshot().objective).toMatchObject({ current: 0, required: 2, completed: false });
  });

  it("does not replace a blocked announced summon with surprise damage", () => {
    const summonerA = enemy("summoner-a", {
      behaviorId: "summoner",
      attackCountdown: 1,
      attack: { kind: "summon-foam-crab", power: 200, range: 200 },
    });
    const summonerB = enemy("summoner-b", {
      behaviorId: "summoner",
      attackCountdown: 1,
      attack: { kind: "summon-foam-crab", power: 200, range: 200 },
    });
    const fillers = Array.from({ length: 9 }, (_, index) => enemy(`idle-${index}`, {
      attackCountdown: 99,
      stats: { hp: 9999, attack: 1, speed: 1 },
    }));
    const foamCrab = enemy("foam-crab", { attackCountdown: 99 });
    const placed = [summonerA, summonerB, ...fillers];
    const battleSetup = setup([hero("h1")], placed, { enemyX: 650, duration: 0.01 });
    const runtime = createBattleRuntime({
      ...battleSetup,
      enemyCatalog: Object.fromEntries([...placed, foamCrab].map((entry) => [entry.id, entry])),
    });
    expect(runtime.getSnapshot().enemyIntents.filter((intent) => intent.intentKind === "summon")).toHaveLength(2);

    playTurn(runtime, vec2(0, -1));

    const snapshot = runtime.getSnapshot();
    expect(snapshot.enemies.filter((entry) => entry.alive)).toHaveLength(12);
    expect(snapshot.party[0]).toMatchObject({ hp: 200, alive: true });
    const summonActions = runtime.drainEvents().filter(
      (event) => event.type === "enemyActionResolved"
        && (event.actorId === "enemy-0" || event.actorId === "enemy-1"),
    );
    expect(summonActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: "enemy-0", outcomeKind: "summoned" }),
      expect.objectContaining({ actorId: "enemy-1", outcomeKind: "blocked" }),
    ]));
  });

  it("charges an active skill on its owner's completed turn and exposes readiness", () => {
    const caster = hero("caster", { activeSkill: { name: "ready", chargeTurns: 1, effects: [] } });
    const foe = enemy("dummy", { stats: { hp: 9999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const runtime = createBattleRuntime(setup([caster], [foe], { enemyX: 900, duration: 0.05 }));
    runtime.drainEvents();
    playOneTurn(runtime);
    expect(runtime.previewActiveSkill()).toMatchObject({ charge: 1, requiredCharge: 1, ready: true });
    const events = runtime.drainEvents();
    expect(events.some((event) => event.type === "activeSkillCharged")).toBe(true);
    expect(events.some((event) => event.type === "activeSkillReady")).toBe(true);
  });

  const activeEffects = [
    ["preview-extend", 3], ["weakpoint-multiplier", 65], ["ally-launch", 45], ["shield-break", 100],
    ["stun", 1], ["reveal-weakpoint", 2], ["heal", 22], ["countdown-delay", 2], ["cleanse", 1],
    ["speed-up", 18], ["temporary-bumper", 2], ["velocity-multiplier", 32], ["damage-redirect", 55],
    ["afterimage-strikes", 4], ["radial-launch", 88], ["mirror-clone", 3], ["trajectory-perfect", 6],
    ["revive", 35], ["arena-beam", 180], ["portal-pair", 1],
  ] as const;

  it.each(activeEffects)("activates data effect '%s' with a real state change", (kind, value) => {
    const caster = hero("caster", {
      activeSkill: {
        name: `active-${kind}`,
        chargeTurns: 1,
        effects: [{ kind, value, target: "test", durationTurns: 3 }],
      },
    });
    const ally = hero("ally");
    const guard = enemy("guard", {
      behaviorId: "shield",
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
      boss: true,
    });
    const battleSetup = setup([caster, ally], [guard], { enemyX: 700, duration: 0.05, weakpoint: true });
    const initial = createBattleRuntime(battleSetup).getSnapshot();
    initial.party[0]!.activeSkill = { charge: 1, requiredCharge: 1, ready: true, uses: 0 };
    initial.party[1]!.hp = 50;
    if (kind === "revive") {
      initial.party[1]!.hp = 0;
      initial.party[1]!.alive = false;
    }
    if (kind === "cleanse") {
      initial.effects.push({
        id: "hazard:caster:slow-field",
        sourceId: "hazard",
        targetId: "caster",
        kind: "slow-field",
        value: 0.5,
        remainingTurns: 2,
      });
      initial.effects.push({
        id: "lotus:caster:sleep-stack",
        sourceId: "lotus",
        targetId: "caster",
        kind: "sleep-stack",
        value: 2,
        remainingTurns: 3,
      });
    }
    const hpBefore = initial.enemies[0]!.hp;
    const countdownBefore = initial.enemies[0]!.attackCountdown;
    const runtime = restoreBattleRuntime(battleSetup, initial);
    expect(runtime.previewActiveSkill("caster")?.ready).toBe(true);
    expect(runtime.activateActiveSkill({
      actorId: "caster",
      position: vec2(240, 240),
      secondaryPosition: vec2(480, 480),
    })).not.toBeNull();
    const snapshot = runtime.getSnapshot();
    const events = runtime.drainEvents();
    expect(snapshot.party[0]!.activeSkill).toMatchObject({ charge: 0, ready: false, uses: 1 });
    expect(events).toContainEqual(expect.objectContaining({
      type: "activeSkillEffect",
      actorId: "caster",
      effectKind: kind,
    }));

    if (["ally-launch", "afterimage-strikes", "radial-launch", "mirror-clone", "arena-beam"].includes(kind)) {
      expect(snapshot.enemies[0]!.hp).toBeLessThan(hpBefore);
    } else if (kind === "heal") {
      expect(snapshot.party[1]!.hp).toBeGreaterThan(50);
    } else if (kind === "countdown-delay") {
      expect(snapshot.enemies[0]!.attackCountdown).toBeGreaterThan(countdownBefore);
    } else if (kind === "cleanse") {
      expect(snapshot.effects.some((effect) => effect.targetId === "caster" && effect.kind === "slow-field")).toBe(false);
      expect(snapshot.effects.some((effect) => effect.targetId === "caster" && effect.kind === "sleep-stack")).toBe(false);
    } else if (kind === "temporary-bumper") {
      expect(snapshot.hazards.some((hazard) => hazard.spawnedBy === "caster" && hazard.type === "moving-bumper")).toBe(true);
    } else if (kind === "portal-pair") {
      expect(snapshot.hazards.filter((hazard) => hazard.spawnedBy === "caster" && hazard.type === "portal")).toHaveLength(2);
    } else if (kind === "revive") {
      expect(snapshot.party[1]).toMatchObject({ alive: true, hp: 70 });
    } else {
      expect(events.some((event) => event.type === "statusEffectApplied")).toBe(true);
    }
  });

  it("resolves an ally-launch through the normal hazard contact pipeline", () => {
    const caster = hero("caster", {
      activeSkill: {
        name: "launch-through-potion",
        chargeTurns: 1,
        effects: [{ kind: "ally-launch", value: 45, target: "highest-attack-ally" }],
      },
    });
    const ally = hero("launched-ally", { stats: { hp: 200, attack: 80, speed: 100 } });
    const foe = enemy("launch-target", { stats: { hp: 9999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([caster, ally], [foe], { enemyX: 700, duration: 0.05 });
    const potionStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [{
        id: "growth-potion",
        type: "moving-bumper",
        x: 300,
        y: 153,
        radius: 45,
        parameters: { onContactRadiusMultiplier: 1.3, durationTurns: 2, distance: 0, periodTurns: 999 },
      }],
      modifiers: ["size-changes-collider"],
    };
    const charged = createBattleRuntime({ ...battleSetup, stage: potionStage }).getSnapshot();
    charged.party[0]!.activeSkill = { charge: 1, requiredCharge: 1, ready: true, uses: 0 };
    const runtime = restoreBattleRuntime({ ...battleSetup, stage: potionStage }, charged);

    expect(runtime.activateActiveSkill({ actorId: "caster", targetId: "launched-ally" })).not.toBeNull();

    expect(runtime.getSnapshot().effects).toContainEqual(expect.objectContaining({
      sourceId: "growth-potion",
      targetId: "launched-ally",
      kind: "radius-multiplier",
      value: 1.3,
    }));
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "hazardTriggered",
      actorId: "launched-ally",
      targetId: "growth-potion",
    }));
  });

  it.each([
    ["ally-launch", [hero("solo-caster")], "no_ally"],
    ["revive", [hero("revive-caster"), hero("healthy-ally")], "no_fallen_ally"],
  ] as const)("does not consume a charged %s skill without a valid target", (kind, party, blockedReason) => {
    const caster = hero(party[0]!.id, {
      activeSkill: { name: `blocked-${kind}`, chargeTurns: 1, effects: [{ kind, value: 40, target: "test" }] },
    });
    const battleParty = [caster, ...party.slice(1)];
    const foe = enemy("target-dummy", { stats: { hp: 9999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup(battleParty, [foe], { enemyX: 700, duration: 0.05 });
    const charged = createBattleRuntime(battleSetup).getSnapshot();
    charged.party[0]!.activeSkill = { charge: 1, requiredCharge: 1, ready: true, uses: 0 };
    const runtime = restoreBattleRuntime(battleSetup, charged);

    expect(runtime.previewActiveSkill(charged.party[0]!.id)).toMatchObject({ ready: false, blockedReason });
    expect(runtime.activateActiveSkill({ actorId: charged.party[0]!.id })).toBeNull();
    expect(runtime.getSnapshot().party[0]!.activeSkill).toMatchObject({ charge: 1, ready: true, uses: 0 });
  });

  it("assigns every authored typed modifier flag to runtime or Scene ownership", () => {
    const authoredSources = new Set(STAGES.flatMap((authoredStage) => authoredStage.modifiers));
    const authoredFlags = new Set<string>(STAGES.flatMap((authoredStage) =>
      compileStageDefinitionModifiers(authoredStage).effects.map((effect) => effect.flag)));
    const ownedFlags = new Set<string>([
      ...BATTLE_RUNTIME_MODIFIER_FLAGS,
      ...BATTLE_SCENE_MODIFIER_FLAGS,
    ]);
    expect(authoredSources.size).toBe(61);
    expect(authoredFlags.size).toBe(60);
    expect([...authoredFlags].filter((flag) => !ownedFlags.has(flag))).toEqual([]);
    expect([...ownedFlags].filter((flag) => !authoredFlags.has(flag))).toEqual([]);
  });

  it("materializes compiled modifier state exactly once per authored effect", () => {
    for (const authoredStage of STAGES) {
      const compilation = compileStageDefinitionModifiers(authoredStage);
      const runtime = createBattleRuntime({
        stage: authoredStage,
        party: HEROES.slice(0, 4),
        enemyCatalog: ENEMY_BY_ID,
        seed: `modifier-state:${authoredStage.id}`,
      });
      expect(runtime.getSnapshot().modifiers, authoredStage.id).toHaveLength(compilation.effects.length);
      expect(runtime.getSnapshot().modifiers.map((modifier) => modifier.flag), authoredStage.id).toEqual(
        compilation.effects.map((effect) => effect.flag),
      );
    }
  });

  it("clamps an authored boss at minimum HP and crosses typed phase thresholds", () => {
    const boss = enemy("phase-boss", {
      boss: true,
      stats: { hp: 100, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([hero("h1", { stats: { hp: 200, attack: 1000, speed: 100 } })], [boss], {
      enemyX: 220,
      duration: 0.5,
    });
    const phaseStage: StageDefinition = {
      ...battleSetup.stage,
      modifiers: ["boss-hp-stops-at-one", "boss-phase-at:65", "boss-phase-at:30"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: phaseStage });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(1);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.enemies[0]?.hp).toBe(1);
    expect(snapshot.stagePhase).toBe(3);
    expect(snapshot.phase).not.toBe("victory");
    expect(snapshot.modifiers
      .filter((modifier) => modifier.flag === "phaseHpThresholdPercent")
      .every((modifier) => modifier.triggerCount > 0)).toBe(true);
  });

  it("suppresses first-shot aggro and executes retaliation from the second shot", () => {
    const lethal = enemy("lethal", {
      behaviorId: "charger",
      stats: { hp: 9999, attack: 999, speed: 100 },
      attackCountdown: 1,
      attack: { kind: "charge", power: 999, range: 999 },
    });
    const battleSetup = setup([hero("h1", { stats: { hp: 500, attack: 1, speed: 100 } })], [lethal], {
      enemyX: 700,
      duration: 0.05,
    });
    const disguiseStage: StageDefinition = {
      ...battleSetup.stage,
      modifiers: ["disguise-first-shot-no-aggro"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: disguiseStage });
    runtime.drainEvents();
    playOneTurn(runtime);
    expect(runtime.getSnapshot().party[0]?.hp).toBe(500);
    playOneTurn(runtime);
    expect(runtime.getSnapshot().party[0]?.hp).toBeLessThan(500);
  });

  it("spawns the authored turn-six reinforcement into the authoritative snapshot", () => {
    const foe = enemy("watcher", { stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([hero("h1", { stats: { hp: 9999, attack: 1, speed: 100 } })], [foe], {
      enemyX: 900,
      duration: 0.05,
    });
    const reinforcementStage: StageDefinition = {
      ...battleSetup.stage,
      modifiers: ["reinforcement-at-turn-six"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: reinforcementStage });
    runtime.drainEvents();
    for (let turn = 0; turn < 6; turn += 1) playOneTurn(runtime);
    expect(runtime.getSnapshot().enemies.some((entry) => entry.id === "stage-reinforcement:6")).toBe(true);
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "enemySpawned",
      targetId: "stage-reinforcement:6",
      effectKind: "reinforcementTurn",
    }));
  });

  it("lets a typed runtime config override the authored reinforcement turn", () => {
    const foe = enemy("override-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([
      hero("override-runner", { stats: { hp: 9999, attack: 1, speed: 100 } }),
    ], [foe], { enemyX: 900, duration: 0.05, turnLimit: 10 });
    const reinforcementStage: StageDefinition = {
      ...battleSetup.stage,
      modifiers: ["reinforcement-at-turn-six"],
    };
    const runtime = createBattleRuntime({
      ...battleSetup,
      stage: reinforcementStage,
      config: { ...battleSetup.config, reinforcementTurnOverride: 3 },
    });
    runtime.drainEvents();
    playOneTurn(runtime);
    playOneTurn(runtime);
    expect(runtime.getSnapshot().enemies.some((entry) => entry.id.startsWith("stage-reinforcement:"))).toBe(false);
    playOneTurn(runtime);
    expect(runtime.getSnapshot().enemies.some((entry) => entry.id === "stage-reinforcement:3")).toBe(true);
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "enemySpawned",
      targetId: "stage-reinforcement:3",
      effectKind: "reinforcementTurn",
    }));
  });

  it("resets an incomplete single-shot ring chain at turn end", () => {
    const foe = enemy("watcher", { stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([hero("h1")], [foe], { enemyX: 900, duration: 0.35 });
    const ringStage: StageDefinition = {
      ...battleSetup.stage,
      spawns: [
        { id: "party", kind: "party", x: 100, y: 100, radius: 10 },
        { id: "ring-a", kind: "prop", x: 190, y: 100, radius: 10 },
        { id: "ring-b", kind: "prop", x: 500, y: 100, radius: 10 },
        { id: "enemy-0", kind: "enemy", x: 900, y: 100, radius: 20 },
      ],
      objective: { type: "break-parts", turnLimit: 5, targetIds: ["ring-a", "ring-b"], requiredCount: 2 },
      modifiers: ["single-shot-all-rings", "miss-resets-chain"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: ringStage });
    runtime.drainEvents();
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.objective.current).toBe(0);
    expect(snapshot.props.every((prop) => prop.state === "idle" && prop.active)).toBe(true);
    expect(runtime.drainEvents().some((event) => event.type === "sequenceReset")).toBe(true);
  });

  it("rotates wall state after a shot through the typed wall modifier", () => {
    const foe = enemy("watcher", { stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([hero("h1")], [foe], { wallX: 500, enemyX: 900, duration: 0.05 });
    const rotateStage: StageDefinition = { ...battleSetup.stage, modifiers: ["walls-rotate-after-shot"] };
    const runtime = createBattleRuntime({ ...battleSetup, stage: rotateStage });
    runtime.drainEvents();
    playOneTurn(runtime);
    expect(runtime.getSnapshot().walls[0]?.rotation).not.toBe(0);
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "modifierTriggered",
      effectKind: "wallsRotateAfterShot",
    }));
  });

  it("charges every living hero within the authored seventeen-turn ceiling", () => {
    const party = [9, 12, 15, 17].map((chargeTurns, index) => hero(`charge-${index}`, {
      activeSkill: { name: `active-${index}`, chargeTurns, effects: [] },
    }));
    const foe = enemy("battery", { stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const runtime = createBattleRuntime(setup(party, [foe], { enemyX: 900, duration: 0.05, turnLimit: 20 }));
    runtime.drainEvents();
    for (let turn = 0; turn < 17; turn += 1) playOneTurn(runtime);
    expect(runtime.getSnapshot().party.every((member) => member.activeSkill.ready)).toBe(true);
  });

  it("keeps a contact wind buff until the contacted hero completes its next turn", () => {
    const actor = hero("actor");
    const windAlly = hero("wind-ally", {
      friendshipSkill: {
        name: "tail wind",
        effects: [{ kind: "wind-vector", value: 24, target: "contacted-ally", durationTurns: 1 }],
      },
    });
    const foe = enemy("dummy", { stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const runtime = createBattleRuntime({
      ...setup([actor, windAlly], [foe], { enemyX: 900, duration: 0.35 }),
      partyPositions: [vec2(100, 100), vec2(180, 100)],
    });
    runtime.drainEvents();
    playOneTurn(runtime);
    expect(runtime.getSnapshot().effects).toContainEqual(expect.objectContaining({
      targetId: "actor", kind: "wind-vector", remainingTurns: 1, deferUntilNextTurn: true,
    }));
    playTurn(runtime, vec2(0, 1));
    expect(runtime.getSnapshot().effects.some((effect) => effect.targetId === "actor" && effect.kind === "wind-vector")).toBe(true);
  });

  it("moves weakpoints and boss-part objective coordinates with a moving enemy", () => {
    const charger = enemy("moving-boss", {
      behaviorId: "charger",
      boss: true,
      attackCountdown: 1,
      stats: { hp: 9999, attack: 1, speed: 100 },
      attack: { kind: "charge", power: 1, range: 80 },
    });
    const battleSetup = setup([hero("h1")], [charger], { enemyX: 500, duration: 0.05 });
    const movingStage: StageDefinition = {
      ...battleSetup.stage,
      objective: { type: "break-parts", turnLimit: 10, targetIds: ["eye"], requiredCount: 1 },
    };
    const runtime = createBattleRuntime({
      ...battleSetup,
      stage: movingStage,
      weakpoints: [{
        id: "moving-eye", enemyInstanceId: "enemy-0", partId: "eye",
        position: vec2(500, 100), radius: 8, maxHp: 9999,
      }],
    });
    runtime.drainEvents();
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.enemies[0]!.weakpoints[0]!.position.x).toBe(snapshot.enemies[0]!.position.x);
    expect(snapshot.objective.targets[0]!.position).toEqual(snapshot.enemies[0]!.weakpoints[0]!.position);
  });

  it("damages protected memory through a real targeted enemy attack", () => {
    const foe = enemy("slow-action", {
      behaviorId: "shooter",
      attackCountdown: 2,
      stats: { hp: 99999, attack: 10, speed: 0 },
      attack: { kind: "memory-shot", power: 10, range: 700 },
    });
    const battleSetup = setup([hero("h1")], [foe], { enemyX: 900, duration: 0.05 });
    const memoryStage: StageDefinition = {
      ...battleSetup.stage,
      spawns: [
        { id: "party", kind: "party", x: 100, y: 100, radius: 10 },
        { id: "memory", kind: "prop", x: 360, y: 270, radius: 40 },
        { id: "enemy-0", kind: "enemy", x: 900, y: 100, radius: 20 },
      ],
      objective: { type: "protect", turnLimit: 10, targetIds: ["memory"], requiredCount: 1 },
      modifiers: ["protected-memory-loses-hp-on-enemy-action"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: memoryStage });
    runtime.drainEvents();
    playOneTurn(runtime);
    expect(runtime.getSnapshot().props[0]!.hp).toBe(100);
    playOneTurn(runtime);
    expect(runtime.getSnapshot().props[0]!.hp).toBe(90);
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "objectiveTargetDamaged",
      targetId: "memory",
      amount: 10,
    }));
  });

  it("leaves the final core open when the father-son pair is unavailable", () => {
    const boss = enemy("final-boss", { boss: true, stats: { hp: 9999, attack: 1, speed: 1 } });
    const battleSetup = setup([hero("unrelated")], [boss], { enemyX: 500, duration: 0.05 });
    const finalStage: StageDefinition = {
      ...battleSetup.stage,
      objective: { type: "break-parts", turnLimit: 10, targetIds: ["anti-core"], requiredCount: 1 },
      modifiers: ["father-son-link-opens-core"],
      boss: {
        bossId: boss.id, supportBossIds: [], phaseIds: [], anatomy: {},
        parts: [{ id: "anti-core", kind: "core", count: 1, collider: "circle", weakpoint: true, breakable: true }],
      },
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: finalStage });
    expect(runtime.getSnapshot().objective.targets[0]).toMatchObject({ sourceId: "anti-core", active: true });
  });

  it("applies grow and shrink potion radius multipliers with deferred duration", () => {
    const foe = enemy("dummy", { stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([hero("h1")], [foe], { enemyX: 900, duration: 0.35 });
    const potionStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [{
        id: "grow-potion", type: "moving-bumper", x: 180, y: 100, radius: 18,
        parameters: { onContactRadiusMultiplier: 1.3, durationTurns: 1, distance: 0 },
      }],
      modifiers: ["size-changes-collider"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: potionStage });
    runtime.drainEvents();
    playOneTurn(runtime);
    expect(runtime.getSnapshot().effects).toContainEqual(expect.objectContaining({
      targetId: "h1", kind: "radius-multiplier", value: 1.3, remainingTurns: 1, deferUntilNextTurn: true,
    }));
  });

  it("resets partially completed exact head chains and restores every head", () => {
    const boss = enemy("six-head-boss", { boss: true, stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([hero("h1", { stats: { hp: 200, attack: 200, speed: 100 } })], [boss], {
      enemyX: 700, duration: 0.45,
    });
    const headStage: StageDefinition = {
      ...battleSetup.stage,
      objective: { type: "break-parts", turnLimit: 10, targetIds: ["scylla-heads"], requiredCount: 6 },
      modifiers: ["exact-six-head-chain"],
    };
    const weakpoints = Array.from({ length: 6 }, (_, index) => ({
      id: `head-${index}`, enemyInstanceId: "enemy-0", partId: "scylla-heads",
      position: vec2(180 + index * 60, 100), radius: 8, maxHp: 9999, breakable: true,
    }));
    const runtime = createBattleRuntime({ ...battleSetup, stage: headStage, weakpoints });
    runtime.drainEvents();
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.objective.current).toBe(0);
    expect(snapshot.enemies[0]!.weakpoints.every((weakpoint) => !weakpoint.broken && weakpoint.hp === weakpoint.maxHp)).toBe(true);
    expect(runtime.drainEvents().some((event) => event.type === "sequenceReset" && event.effectKind === "exactHeadChainCount")).toBe(true);
  });

  it("recalculates the same-shot tail after a portal contact", () => {
    const foe = enemy("dummy", { stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([hero("h1")], [foe], { enemyX: 900, duration: 1.2 });
    const portalStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [
        { id: "portal-a", type: "portal", x: 180, y: 100, radius: 16, parameters: { pairId: "portal-b", rotation: 90 } },
        { id: "portal-b", type: "portal", x: 500, y: 500, radius: 16, parameters: { pairId: "portal-a", rotation: 90 } },
      ],
      modifiers: ["portal-element-changes-wall-collision"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: portalStage });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(0.25);
    const projectile = runtime.getSnapshot().projectile;
    expect(projectile).not.toBeNull();
    expect(projectile!.trajectory.segments.some((segment) => segment.from.x > 450 && segment.from.y > 500)).toBe(true);
    expect(runtime.getSnapshot().effects.some((effect) => effect.kind === "portal-affinity-earth")).toBe(true);
  });

  it("creates a fixed temporary friendship wall with an authored lifetime", () => {
    const wallAlly = hero("wall-ally", {
      friendshipSkill: {
        name: "fence", effects: [{ kind: "temporary-wall", value: 1, target: "contact-point", durationTurns: 3 }],
      },
    });
    const foe = enemy("dummy", { stats: { hp: 99999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const runtime = createBattleRuntime({
      ...setup([hero("actor"), wallAlly], [foe], { enemyX: 900, duration: 0.5 }),
      partyPositions: [vec2(100, 100), vec2(180, 100)],
    });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(0.25);
    expect(runtime.getSnapshot().hazards).toContainEqual(expect.objectContaining({
      type: "moving-bumper", spawnedBy: "wall-ally", remainingTurns: 3,
      parameters: expect.objectContaining({ fixed: true, distance: 0 }),
    }));
  });

  it("materializes every authored stage objective, hazard, and breakable wall", () => {
    for (const authoredStage of STAGES) {
      const runtime = createBattleRuntime({
        stage: authoredStage,
        party: HEROES.slice(0, 4),
        enemyCatalog: ENEMY_BY_ID,
        seed: `content-audit:${authoredStage.id}`,
      });
      const snapshot = runtime.getSnapshot();
      expect(snapshot.objective.type, authoredStage.id).toBe(authoredStage.objective.type);
      expect(snapshot.hazards.length, authoredStage.id).toBe(authoredStage.hazards.length);
      expect(snapshot.walls.length, authoredStage.id).toBe(authoredStage.walls.length);
      expect(snapshot.walls.filter((wall) => wall.breakable).length, authoredStage.id).toBe(
        authoredStage.walls.filter((wall) => wall.breakable).length,
      );
      if (authoredStage.objective.type === "break-parts" || authoredStage.objective.type === "protect") {
        expect(snapshot.objective.targets.length, authoredStage.id).toBeGreaterThanOrEqual(
          authoredStage.objective.requiredCount ?? 1,
        );
      }
      if (authoredStage.objective.type === "seal" || authoredStage.objective.type === "escape") {
        expect(snapshot.objective.targets.length, authoredStage.id).toBeGreaterThan(0);
      }
    }
  });

  it("marks a hero killed by an all-team boulder as dead and resolves party defeat", () => {
    const foe = enemy("boulder-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([
      hero("fragile", { stats: { hp: 20, attack: 1, speed: 100 } }),
    ], [foe], { enemyX: 700, duration: 0.3 });
    const boulderStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [{
        id: "rolling-boulder",
        type: "moving-bumper",
        x: 180,
        y: 100,
        radius: 20,
        parameters: { damage: 35, distance: 0, periodTurns: 99 },
      }],
      modifiers: ["boulder-damages-all-teams"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: boulderStage });
    runtime.drainEvents();

    const preview = runtime.setAim({ direction: vec2(1, 0), power: 1 });
    expect(preview?.trajectory.contacts).toContainEqual(expect.objectContaining({
      targetKind: "hazard",
      targetId: "rolling-boulder",
      response: "bounce",
    }));
    playOneTurn(runtime);

    expect(runtime.getSnapshot().party[0]).toMatchObject({ hp: 0, alive: false });
    expect(runtime.getSnapshot().phase).toBe("defeat");
    expect(runtime.getSnapshot().outcome).toMatchObject({ victory: false, reason: "partyDefeated" });
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "heroDefeated",
      actorId: "rolling-boulder",
      targetId: "fragile",
    }));
  });

  it("marks an enemy killed by an all-team boulder as dead and resolves victory", () => {
    const foe = enemy("boulder-victim", {
      stats: { hp: 20, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    // Radius 20 enemy at x=220 exactly contacts radius 20 boulder at x=180.
    const battleSetup = setup([hero("survivor")], [foe], { enemyX: 220, duration: 0.3 });
    const boulderStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [{
        id: "rolling-boulder",
        type: "moving-bumper",
        x: 180,
        y: 100,
        radius: 20,
        parameters: { damage: 35, distance: 0, periodTurns: 99 },
      }],
      modifiers: ["boulder-damages-all-teams"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: boulderStage });
    runtime.drainEvents();

    playOneTurn(runtime);

    expect(runtime.getSnapshot().party[0]).toMatchObject({ hp: 165, alive: true });
    expect(runtime.getSnapshot().enemies[0]).toMatchObject({ hp: 0, alive: false });
    expect(runtime.getSnapshot().phase).toBe("victory");
    expect(runtime.getSnapshot().outcome).toMatchObject({ victory: true, reason: "allEnemiesDefeated" });
    const events = runtime.drainEvents();
    expect(events).toContainEqual(expect.objectContaining({
      type: "enemyHit",
      actorId: "rolling-boulder",
      targetId: "enemy-0",
      effectKind: "boulder",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "enemyDefeated",
      targetId: "enemy-0",
    }));
  });

  it("damages only enemy bodies touching an all-team boulder", () => {
    const near = enemy("near-boulder", {
      stats: { hp: 100, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const far = enemy("far-from-boulder", {
      stats: { hp: 100, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([hero("survivor")], [near, far], { enemyX: 220, duration: 0.3 });
    const boulderStage: StageDefinition = {
      ...battleSetup.stage,
      spawns: battleSetup.stage.spawns.map((spawn) => spawn.id === "enemy-1"
        ? { ...spawn, x: 650 }
        : spawn),
      hazards: [{
        id: "rolling-boulder",
        type: "moving-bumper",
        x: 180,
        y: 100,
        radius: 20,
        parameters: { damage: 35, distance: 0, periodTurns: 99 },
      }],
      modifiers: ["boulder-damages-all-teams"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: boulderStage });
    runtime.drainEvents();

    playOneTurn(runtime);

    const snapshot = runtime.getSnapshot();
    expect(snapshot.enemies[0]).toMatchObject({ hp: 65, alive: true });
    expect(snapshot.enemies[1]).toMatchObject({ hp: 100, alive: true });
    const boulderHits = runtime.drainEvents().filter(
      (event) => event.type === "enemyHit" && event.actorId === "rolling-boulder",
    );
    expect(boulderHits.map((event) => event.targetId)).toEqual(["enemy-0"]);
  });

  it("damages bodies crossed by a moving boulder even without projectile contact", () => {
    const foe = enemy("swept-by-boulder", {
      stats: { hp: 100, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([hero("safe-hero")], [foe], { duration: 0.1 });
    const boulderStage: StageDefinition = {
      ...battleSetup.stage,
      spawns: battleSetup.stage.spawns.map((spawn) => spawn.id === "enemy-0"
        ? { ...spawn, x: 330, y: 400 }
        : spawn),
      hazards: [{
        id: "crossing-boulder",
        type: "moving-bumper",
        x: 180,
        y: 400,
        radius: 20,
        parameters: { damage: 35, axis: "x", distance: 300, periodTurns: 2 },
      }],
      modifiers: ["boulder-damages-all-teams"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: boulderStage });
    runtime.drainEvents();

    runtime.setAim({ direction: vec2(0, -1), power: 0.2 });
    runtime.launch();
    runtime.advance(1);

    expect(runtime.getSnapshot().enemies[0]).toMatchObject({ hp: 65, alive: true });
    expect(runtime.getSnapshot().party[0]).toMatchObject({ hp: 200, alive: true });
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "enemyHit",
      actorId: "crossing-boulder",
      targetId: "enemy-0",
      effectKind: "boulder",
    }));
  });

  it("keeps wine attack-down through its delayed attack and reduces the actual damage", () => {
    const createWineRuntime = (wineEnabled: boolean) => {
      const foe = enemy("wine-attacker", {
        behaviorId: "shooter",
        stats: { hp: 99999, attack: 120, speed: 1 },
        attackCountdown: wineEnabled ? 1 : 2,
        attack: { kind: "arrow", power: 120, range: 999 },
      });
      const battleSetup = setup([
        hero("wine-target", { stats: { hp: 1000, attack: 1, speed: 100 } }),
      ], [foe], { enemyX: 180, duration: 0.5, seed: "wine-damage-regression" });
      const wineStage: StageDefinition = {
        ...battleSetup.stage,
        spawns: [
          { id: "party", kind: "party", x: 100, y: 100, radius: 10 },
          { id: "enemy-0", kind: "enemy", x: 180, y: 140, radius: 20 },
        ],
        hazards: [{
          id: "wine-pool",
          type: "slow-field",
          x: 180,
          y: 100,
          radius: 30,
          parameters: { speedMultiplier: 0.8, enemyAttackDown: 50 },
        }],
        modifiers: wineEnabled ? ["wine-affects-both-teams"] : [],
      };
      return createBattleRuntime({ ...battleSetup, stage: wineStage });
    };

    const baseline = createWineRuntime(false);
    const wine = createWineRuntime(true);
    baseline.drainEvents();
    wine.drainEvents();
    playOneTurn(baseline);
    playOneTurn(wine);
    expect(wine.getSnapshot().effects).toContainEqual(expect.objectContaining({
      targetId: "enemy-0",
      kind: "wine-slow",
      value: 50,
    }));

    baseline.drainEvents();
    wine.drainEvents();
    playTurn(baseline, vec2(0, 1));
    playTurn(wine, vec2(0, 1));
    const baselineAttack = baseline.drainEvents().find((event) => event.type === "enemyAttack");
    const wineAttack = wine.drainEvents().find((event) => event.type === "enemyAttack");

    expect(baselineAttack?.amount).toBeGreaterThan(0);
    expect(wineAttack?.amount).toBeGreaterThan(0);
    expect(wineAttack!.amount!).toBeLessThan(baselineAttack!.amount!);
    expect(wine.getSnapshot().party[0]!.hp).toBeGreaterThan(baseline.getSnapshot().party[0]!.hp);
  });

  it("applies a spirit-only current to spirit heroes and leaves other elements unchanged", () => {
    const foe = enemy("current-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const createCurrentRuntime = (element: HeroDefinition["element"]) => {
      const battleSetup = setup([
        hero(`current-${element}`, { element }),
      ], [foe], { enemyX: 700, duration: 0.5 });
      const currentStage: StageDefinition = {
        ...battleSetup.stage,
        hazards: [{
          id: "spirit-current",
          type: "current",
          x: 100,
          y: 100,
          radius: 80,
          parameters: { forceX: 0, forceY: -80, spiritOnly: true },
        }],
      };
      return createBattleRuntime({ ...battleSetup, stage: currentStage });
    };

    const seaPreview = createCurrentRuntime("sea").setAim({ direction: vec2(1, 0), power: 1 });
    const spiritPreview = createCurrentRuntime("spirit").setAim({ direction: vec2(1, 0), power: 1 });

    expect(seaPreview?.trajectory.initialVelocity).toEqual(vec2(400, 0));
    expect(spiritPreview?.trajectory.initialVelocity.x).toBe(400);
    expect(spiritPreview?.trajectory.initialVelocity.y).toBe(-80);
  });

  it("reduces r08-s04 suction only on an anchor hit, not on an ordinary bowl wall", () => {
    const charybdisStage = STAGES.find((entry) => entry.id === "r08-s04");
    expect(charybdisStage).toBeDefined();

    const hitWall = (position: ReturnType<typeof vec2>, direction: ReturnType<typeof vec2>) => {
      const runtime = createBattleRuntime({
        stage: charybdisStage!,
        party: [hero("anchor-tester")],
        enemyCatalog: ENEMY_BY_ID,
        seed: "anchor-suction-regression",
        config: {
          fixedStep: 1 / 120,
          maxProjectileDuration: 0.18,
          minLaunchSpeed: 400,
          maxLaunchSpeed: 400,
          damageVariance: 0,
          criticalChance: 0,
        },
        partyPositions: [position],
      });
      runtime.drainEvents();
      runtime.setAim({ direction, power: 1 });
      runtime.launch();
      runtime.advance(0.18);
      return {
        force: Number(runtime.getSnapshot().hazards.find((hazard) => hazard.id === "maelstrom")?.parameters.force),
        events: runtime.drainEvents(),
      };
    };

    const bowlHit = hitWall(vec2(260, 800), vec2(-1, 0));
    const anchorHit = hitWall(vec2(285, 690), vec2(-1, 0));

    expect(bowlHit.force).toBe(155);
    expect(bowlHit.events.some((event) =>
      event.type === "modifierTriggered" && event.effectKind === "anchorHitsReduceSuction")).toBe(false);
    expect(anchorHit.force).toBeCloseTo(124, 6);
    expect(anchorHit.events).toContainEqual(expect.objectContaining({
      type: "modifierTriggered",
      effectKind: "anchorHitsReduceSuction",
      targetId: "anchor-left",
    }));
  });

  it("re-traces the remaining shot immediately after entering a wind current", () => {
    const foe = enemy("wind-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([hero("wind-rider")], [foe], { enemyX: 700, duration: 0.7 });
    const windStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [{
        id: "cross-current",
        type: "current",
        x: 180,
        y: 100,
        radius: 18,
        parameters: { forceX: 0, forceY: 120 },
      }],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: windStage });
    const preview = runtime.setAim({ direction: vec2(1, 0), power: 1 });
    expect(preview?.trajectory.finalPosition.y).toBeCloseTo(100, 6);
    runtime.launch();
    runtime.advance(0.25);

    const projectile = runtime.getSnapshot().projectile;
    expect(projectile).not.toBeNull();
    expect(projectile!.trajectory.finalPosition.y).toBeGreaterThan(110);
    expect(projectile!.trajectory.segments.some((segment) =>
      Math.abs(segment.to.y - segment.from.y) > 10)).toBe(true);
    expect(runtime.getSnapshot().effects).toContainEqual(expect.objectContaining({
      targetId: "wind-rider",
      kind: "wind-vector",
    }));
  });

  it("re-traces the same shot through authored walls after an ally grants wall phase", () => {
    const phaseAlly = hero("phase-ally", {
      friendshipSkill: {
        name: "phase gift",
        effects: [{ kind: "wall-phase", value: 1, target: "contacted-ally", durationTurns: 1 }],
      },
    });
    const foe = enemy("phase-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([hero("phase-runner"), phaseAlly], [foe], {
      wallX: 300,
      enemyX: 700,
      duration: 0.8,
    });
    const runtime = createBattleRuntime({
      ...battleSetup,
      partyPositions: [vec2(100, 100), vec2(180, 100)],
    });
    const preview = runtime.setAim({ direction: vec2(1, 0), power: 1 });
    expect(preview?.trajectory.contacts).toContainEqual(expect.objectContaining({
      targetKind: "wall",
      targetId: "right-wall",
    }));
    runtime.launch();
    runtime.advance(0.25);

    const projectile = runtime.getSnapshot().projectile;
    expect(projectile).not.toBeNull();
    expect(projectile!.trajectory.contacts.some((contact) =>
      contact.targetKind === "wall" && contact.targetId === "right-wall")).toBe(false);
    expect(projectile!.trajectory.finalPosition.x).toBeGreaterThan(300);
    expect(runtime.getSnapshot().effects).toContainEqual(expect.objectContaining({
      targetId: "phase-runner",
      kind: "wall-phase",
    }));
  });

  it("uses a friendship temporary wall as a real collider and removes it after its authored lifetime", () => {
    const wallAlly = hero("wall-maker", {
      friendshipSkill: {
        name: "fence",
        effects: [{ kind: "temporary-wall", value: 1, target: "contact-point", durationTurns: 3 }],
      },
    });
    const foe = enemy("wall-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([hero("wall-runner"), wallAlly], [foe], {
      enemyX: 700,
      duration: 0.5,
      turnLimit: 10,
    });
    const runtime = createBattleRuntime({
      ...battleSetup,
      partyPositions: [vec2(100, 100), vec2(180, 100)],
    });
    runtime.drainEvents();
    playOneTurn(runtime);
    const created = runtime.getSnapshot();
    const temporaryWall = created.hazards.find((hazard) => hazard.spawnedBy === "wall-maker");
    expect(temporaryWall).toMatchObject({
      type: "moving-bumper",
      active: true,
      remainingTurns: 3,
      parameters: expect.objectContaining({ fixed: true, distance: 0 }),
    });

    const collisionState = runtime.getSnapshot();
    collisionState.activePartyIndex = 0;
    collisionState.phase = "awaitingAim";
    collisionState.aim = null;
    collisionState.projectile = null;
    collisionState.party[0]!.position = vec2(60, temporaryWall!.position.y);
    const collisionRuntime = restoreBattleRuntime(battleSetup, collisionState);
    const collisionPreview = collisionRuntime.setAim({ direction: vec2(1, 0), power: 1 });
    expect(collisionPreview?.trajectory.contacts).toContainEqual(expect.objectContaining({
      targetKind: "hazard",
      targetId: temporaryWall!.id,
      response: "bounce",
    }));

    const lifetimeState = runtime.getSnapshot();
    lifetimeState.party[0]!.position = vec2(400, 100);
    lifetimeState.party[1]!.position = vec2(500, 100);
    const lifetimeRuntime = restoreBattleRuntime(battleSetup, lifetimeState);
    playTurn(lifetimeRuntime, vec2(0, 1));
    expect(lifetimeRuntime.getSnapshot().hazards.find((hazard) => hazard.id === temporaryWall!.id)?.remainingTurns).toBe(2);
    playTurn(lifetimeRuntime, vec2(0, 1));
    expect(lifetimeRuntime.getSnapshot().hazards.find((hazard) => hazard.id === temporaryWall!.id)?.remainingTurns).toBe(1);
    playTurn(lifetimeRuntime, vec2(0, 1));
    expect(lifetimeRuntime.getSnapshot().hazards.some((hazard) => hazard.id === temporaryWall!.id)).toBe(false);
  });

  it("uses the exit portal element to phase spirit walls or restore solid collision", () => {
    const makeRuntime = (exitElement: "spirit" | "earth") => {
      const foe = enemy(`portal-watcher-${exitElement}`, {
        stats: { hp: 99999, attack: 1, speed: 1 },
        attackCountdown: 99,
      });
      const battleSetup = setup([hero(`portal-runner-${exitElement}`)], [foe], {
        enemyX: 700,
        duration: 1,
      });
      const portalStage: StageDefinition = {
        ...battleSetup.stage,
        walls: [{
          id: "spirit-wall",
          shape: "segment",
          x: 520,
          y: 0,
          x2: 520,
          y2: 300,
          material: "spirit",
          restitution: 1,
        }],
        hazards: [
          {
            id: "entry-gate",
            type: "portal",
            x: 180,
            y: 100,
            radius: 16,
            parameters: { pairId: "exit-gate", element: exitElement === "spirit" ? "earth" : "spirit" },
          },
          {
            id: "exit-gate",
            type: "portal",
            x: 400,
            y: 100,
            radius: 16,
            parameters: { pairId: "entry-gate", element: exitElement },
          },
        ],
        modifiers: ["portal-element-changes-wall-collision"],
      };
      const runtime = createBattleRuntime({ ...battleSetup, stage: portalStage });
      runtime.setAim({ direction: vec2(1, 0), power: 1 });
      runtime.launch();
      runtime.advance(0.2);
      return runtime.getSnapshot();
    };

    const spirit = makeRuntime("spirit");
    const earth = makeRuntime("earth");
    expect(spirit.effects).toContainEqual(expect.objectContaining({ kind: "portal-affinity-spirit" }));
    expect(earth.effects).toContainEqual(expect.objectContaining({ kind: "portal-affinity-earth" }));
    expect(spirit.projectile?.trajectory.contacts.some((contact) => contact.targetId === "spirit-wall")).toBe(false);
    expect(earth.projectile?.trajectory.contacts).toContainEqual(expect.objectContaining({
      targetKind: "wall",
      targetId: "spirit-wall",
    }));
  });

  it("updates slow-field expansion and period-one sound-wave radius and warning cadence in snapshot state", () => {
    const foe = enemy("hazard-state-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([hero("hazard-state-runner")], [foe], {
      enemyX: 700,
      duration: 1,
      turnLimit: 10,
    });
    const hazardStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [
        {
          id: "growing-slow",
          type: "slow-field",
          x: 600,
          y: 500,
          radius: 100,
          parameters: { speedMultiplier: 0.7, expandsPerTurn: 22 },
        },
        {
          id: "pulse-song",
          type: "sound-wave",
          x: 300,
          y: 100,
          radius: 50,
          parameters: { expansion: 40, periodTurns: 1, warningTurns: 1, damage: 1 },
        },
      ],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: hazardStage });
    expect(runtime.getSnapshot().hazards.find((hazard) => hazard.id === "pulse-song")).toMatchObject({
      radius: 50,
      parameters: expect.objectContaining({ armed: false }),
    });

    playTurn(runtime, vec2(0, 1));
    const armed = runtime.getSnapshot();
    expect(armed.hazards.find((hazard) => hazard.id === "growing-slow")?.radius).toBe(122);
    expect(armed.hazards.find((hazard) => hazard.id === "pulse-song")).toMatchObject({
      radius: 90,
      parameters: expect.objectContaining({ armed: true }),
    });
    const armedState = runtime.getSnapshot();
    armedState.phase = "awaitingAim";
    armedState.aim = null;
    armedState.projectile = null;
    armedState.party[0]!.position = vec2(100, 100);
    const armedRuntime = restoreBattleRuntime({ ...battleSetup, stage: hazardStage }, armedState);
    expect(armedRuntime.setAim({ direction: vec2(1, 0), power: 1 })?.trajectory.contacts).toContainEqual(
      expect.objectContaining({ targetKind: "hazard", targetId: "pulse-song" }),
    );

    playTurn(runtime, vec2(0, 1));
    const warning = runtime.getSnapshot();
    expect(warning.hazards.find((hazard) => hazard.id === "growing-slow")?.radius).toBe(144);
    expect(warning.hazards.find((hazard) => hazard.id === "pulse-song")).toMatchObject({
      radius: 50,
      parameters: expect.objectContaining({ armed: false }),
    });
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "hazardWarning",
      targetId: "pulse-song",
      effectKind: "sound-wave",
    }));
  });

  it("evaluates a one-way wall from the velocity and normal at each contact after an earlier bounce", () => {
    const foe = enemy("one-way-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([hero("one-way-runner")], [foe], {
      wallX: 300,
      enemyX: 700,
      duration: 1.1,
    });
    const oneWayStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [{
        id: "direction-gate",
        type: "one-way-wall",
        x: 180,
        y: 100,
        radius: 15,
        parameters: { allowedAngle: 0, blockedArc: 180 },
      }],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: oneWayStage });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(0.8);

    expect(runtime.getSnapshot().projectile?.trajectory.contacts).toContainEqual(expect.objectContaining({
      targetKind: "hazard",
      targetId: "direction-gate",
      response: "bounce",
    }));
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "ricochet",
      targetId: "direction-gate",
    }));
  });

  it("re-traces the same shot with a potion-adjusted radius and slow-field speed", () => {
    const foe = enemy("same-shot-state-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const sizeSetup = setup([hero("size-runner")], [foe], { enemyX: 700, duration: 0.7 });
    const sizeStage: StageDefinition = {
      ...sizeSetup.stage,
      hazards: [{
        id: "grow-potion",
        type: "moving-bumper",
        x: 180,
        y: 100,
        radius: 15,
        parameters: { onContactRadiusMultiplier: 1.8, durationTurns: 1, distance: 0 },
      }],
      modifiers: ["size-changes-collider"],
    };
    const sizeRuntime = createBattleRuntime({ ...sizeSetup, stage: sizeStage });
    sizeRuntime.setAim({ direction: vec2(1, 0), power: 1 });
    sizeRuntime.launch();
    sizeRuntime.advance(0.2);
    const leftWall = sizeRuntime.getSnapshot().projectile?.trajectory.contacts.find(
      (contact) => contact.targetKind === "wall" && contact.targetId === "arena-left",
    );
    expect(leftWall?.position.x).toBeCloseTo(18, 4);

    const slowSetup = setup([hero("slow-runner")], [foe], { enemyX: 700, duration: 0.6 });
    const slowStage: StageDefinition = {
      ...slowSetup.stage,
      hazards: [{
        id: "slow-zone",
        type: "slow-field",
        x: 180,
        y: 100,
        radius: 15,
        parameters: { speedMultiplier: 0.5 },
      }],
    };
    const slowRuntime = createBattleRuntime({ ...slowSetup, stage: slowStage });
    slowRuntime.setAim({ direction: vec2(1, 0), power: 1 });
    slowRuntime.launch();
    slowRuntime.advance(0.2);
    const slowedProjectile = slowRuntime.getSnapshot().projectile;
    expect(slowedProjectile?.trajectory.finalPosition.x).toBeGreaterThan(245);
    expect(slowedProjectile?.trajectory.finalPosition.x).toBeLessThan(260);
    expect(slowedProjectile?.trajectory.segments.some((segment) => Math.abs(segment.velocity.x - 200) < 0.01)).toBe(true);
  });

  it("removes broken-wall ghost contacts and re-traces moved furniture with clamped offsets", () => {
    const foe = enemy("wall-state-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 999,
    });
    const breakSetup = setup([
      hero("wall-breaker", { stats: { hp: 200, attack: 500, speed: 100 } }),
    ], [foe], { enemyX: 700, duration: 1.3 });
    const breakStage: StageDefinition = {
      ...breakSetup.stage,
      walls: [{
        id: "fragile-wall",
        shape: "segment",
        x: 200,
        y: 0,
        x2: 200,
        y2: 300,
        material: "wood",
        restitution: 1,
        breakable: true,
        hp: 1,
      }],
    };
    const breakRuntime = createBattleRuntime({
      ...breakSetup,
      stage: breakStage,
      config: { ...breakSetup.config, damageVariance: 0, criticalChance: 0 },
    });
    breakRuntime.setAim({ direction: vec2(1, 0), power: 1 });
    breakRuntime.launch();
    breakRuntime.advance(0.3);
    const brokenShot = breakRuntime.getSnapshot();
    expect(brokenShot.walls[0]).toMatchObject({ broken: true, hp: 0 });
    expect(brokenShot.projectile?.trajectory.contacts.filter((contact) => contact.targetId === "fragile-wall")).toHaveLength(1);
    expect(brokenShot.projectile?.trajectory.finalPosition.x).toBeGreaterThan(200);

    const furnitureSetup = setup([hero("furniture-runner")], [foe], {
      enemyX: 700,
      duration: 0.8,
      turnLimit: 20,
    });
    const furnitureStage: StageDefinition = {
      ...furnitureSetup.stage,
      walls: [{
        id: "moving-table",
        shape: "segment",
        x: 200,
        y: 0,
        x2: 200,
        y2: 200,
        material: "wood",
        restitution: 1,
      }],
      modifiers: ["furniture-moves-after-collision"],
    };
    const initial = createBattleRuntime({ ...furnitureSetup, stage: furnitureStage }).getSnapshot();
    initial.walls[0]!.offset = vec2(0, 830);
    initial.party[0]!.position = vec2(100, 930);
    const furnitureRuntime = restoreBattleRuntime({ ...furnitureSetup, stage: furnitureStage }, initial);
    furnitureRuntime.setAim({ direction: vec2(1, 0), power: 1 });
    furnitureRuntime.launch();
    furnitureRuntime.advance(0.3);
    const movedShot = furnitureRuntime.getSnapshot();
    expect(movedShot.walls[0]!.offset.y).toBeLessThanOrEqual(840);
    expect(movedShot.projectile?.trajectory.contacts.some((contact) =>
      contact.targetId === "moving-table" && contact.position.x < 180)).toBe(true);
  });

  it("ends a killed hero's projectile immediately before later ally, enemy, or objective contacts", () => {
    const foe = enemy("post-death-target", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([
      hero("fragile-runner", { stats: { hp: 20, attack: 500, speed: 100 } }),
      hero("reserve-runner"),
    ], [foe], { enemyX: 260, duration: 0.8 });
    const lethalStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [{
        id: "lethal-song",
        type: "sound-wave",
        x: 180,
        y: 100,
        radius: 15,
        parameters: { warningTurns: 0, damage: 50 },
      }],
    };
    const runtime = createBattleRuntime({
      ...battleSetup,
      stage: lethalStage,
      partyPositions: [vec2(100, 100), vec2(420, 100)],
      config: { ...battleSetup.config, damageVariance: 0, criticalChance: 0 },
    });
    const enemyHp = runtime.getSnapshot().enemies[0]!.hp;
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(0.8);
    const snapshot = runtime.getSnapshot();
    const events = runtime.drainEvents();
    expect(snapshot.party[0]).toMatchObject({ hp: 0, alive: false });
    expect(snapshot.projectile).toBeNull();
    expect(snapshot.phase).toBe("awaitingAim");
    expect(snapshot.activePartyIndex).toBe(1);
    expect(snapshot.enemies[0]!.hp).toBe(enemyHp);
    const deathIndex = events.findIndex((event) => event.type === "heroDefeated" && event.targetId === "fragile-runner");
    expect(deathIndex).toBeGreaterThanOrEqual(0);
    expect(events.slice(deathIndex + 1).some((event) =>
      event.type === "enemyHit" || event.type === "allyContact" || event.type === "objectiveTargetHit")).toBe(false);
  });

  it("uses authored active temporary-bumper restitution in the collision solver", () => {
    const bumperHero = hero("bumper-caster", {
      activeSkill: {
        name: "anchor",
        chargeTurns: 1,
        effects: [{ kind: "temporary-bumper", value: 2, target: "impact-point", durationTurns: 3 }],
      },
    });
    const foe = enemy("bumper-watcher", {
      stats: { hp: 99999, attack: 1, speed: 1 },
      attackCountdown: 99,
    });
    const battleSetup = setup([bumperHero], [foe], { enemyX: 700, duration: 0.4 });
    const initial = createBattleRuntime(battleSetup).getSnapshot();
    initial.party[0]!.activeSkill.charge = 1;
    initial.party[0]!.activeSkill.ready = true;
    const runtime = restoreBattleRuntime(battleSetup, initial);
    expect(runtime.activateActiveSkill({ position: vec2(180, 100) })).not.toBeNull();
    const preview = runtime.setAim({ direction: vec2(1, 0), power: 1 });
    expect(runtime.getSnapshot().hazards).toContainEqual(expect.objectContaining({
      type: "moving-bumper",
      parameters: expect.objectContaining({ restitution: 2 }),
    }));
    expect(preview?.trajectory.segments.some((segment) => segment.velocity.x < -790)).toBe(true);
  });

  it("uses one authoritative skill placement gate for walls while allowing non-solid fields", () => {
    const caster = hero("placement-caster", {
      activeSkill: {
        name: "place bumper",
        chargeTurns: 1,
        effects: [{ kind: "temporary-bumper", value: 1.2, target: "impact-point", durationTurns: 2 }],
      },
    });
    const battleSetup = setup(
      [caster],
      [enemy("placement-watcher", { attackCountdown: 99 })],
      { wallX: 250, enemyX: 700 },
    );
    const initial = createBattleRuntime(battleSetup).getSnapshot();
    initial.party[0]!.activeSkill = { charge: 1, requiredCharge: 1, ready: true, uses: 0 };
    initial.hazards.push({
      id: "harmless-wind",
      type: "slow-field",
      origin: vec2(400, 500),
      position: vec2(400, 500),
      radius: 130,
      active: true,
      phase: 0,
      parameters: { multiplier: 0.8 },
    });
    const runtime = restoreBattleRuntime(battleSetup, initial);

    expect(runtime.isActiveSkillPlacementOpen(vec2(245, 100), 42)).toBe(false);
    expect(runtime.activateActiveSkill({ position: vec2(245, 100) })).toBeNull();
    expect(runtime.getSnapshot().party[0]!.activeSkill.ready).toBe(true);

    expect(runtime.isActiveSkillPlacementOpen(vec2(400, 500), 42)).toBe(true);
    expect(runtime.activateActiveSkill({ position: vec2(400, 500) })).not.toBeNull();
  });

  it("lets authored terrain block enemy shots before damage is applied", () => {
    const shooter = enemy("covered-shooter", {
      behaviorId: "shooter",
      attackCountdown: 1,
      stats: { hp: 9999, attack: 80, speed: 0 },
      attack: { kind: "cover-shot", power: 80, range: 700 },
    });
    const battleSetup = setup([hero("covered-hero")], [shooter], {
      enemyX: 700,
      wallX: 400,
      duration: 0.05,
    });
    const runtime = createBattleRuntime(battleSetup);
    const hpBefore = runtime.getSnapshot().party[0]!.hp;
    runtime.drainEvents();
    playOneTurn(runtime);
    const events = runtime.drainEvents();
    expect(runtime.getSnapshot().party[0]!.hp).toBe(hpBefore);
    expect(events).toContainEqual(expect.objectContaining({
      type: "enemyProjectileBlocked",
      actorId: "enemy-0",
      targetId: "covered-hero",
      outcomeKind: "blocked",
    }));
    expect(events.some((event) => event.type === "heroDamaged")).toBe(false);
  });

  it("stops enemy charges at walls instead of teleporting through cover", () => {
    const charger = enemy("wall-stopped-charger", {
      behaviorId: "charger",
      attackCountdown: 1,
      stats: { hp: 9999, attack: 80, speed: 220 },
      attack: { kind: "wall-charge", power: 80, range: 70 },
    });
    const runtime = createBattleRuntime(setup([hero("guarded-hero")], [charger], {
      enemyX: 500,
      wallX: 300,
      duration: 0.05,
    }));
    runtime.drainEvents();
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    const events = runtime.drainEvents();
    expect(snapshot.enemies[0]!.position.x).toBeGreaterThanOrEqual(319);
    expect(events.some((event) => event.type === "heroDamaged")).toBe(false);
  });

  it("triggers one friendship pair only once even after repeated same-shot contacts", () => {
    const actor = hero("friend-actor");
    const ally = hero("friend-ally", {
      friendshipSkill: { name: "single volley", effects: [{ kind: "nearest-barrage", value: 15, target: "nearest-enemies" }] },
    });
    const foe = enemy("friend-target", { stats: { hp: 9999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([actor, ally], [foe], { enemyX: 700, wallX: 230, duration: 0.8 });
    const runtime = createBattleRuntime({
      ...battleSetup,
      partyPositions: [vec2(100, 100), vec2(170, 100)],
    });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(1);
    const events = runtime.drainEvents();
    expect(events.filter((event) => event.type === "allyContact").length).toBeGreaterThanOrEqual(2);
    expect(events.filter((event) => event.type === "allySkillTriggered")).toHaveLength(1);
    expect(events.filter((event) => event.type === "enemyHit" && event.effectKind === "nearest-barrage")).toHaveLength(1);
  });

  it("routes hazard damage through friendship guard mitigation", () => {
    const actor = hero("hazard-actor", { stats: { hp: 200, attack: 10, speed: 100 } });
    const ally = hero("hazard-guard", {
      friendshipSkill: { name: "guard", effects: [{ kind: "projectile-guard", value: 1, target: "all-allies", durationTurns: 1 }] },
    });
    const foe = enemy("hazard-watcher", { stats: { hp: 9999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const battleSetup = setup([actor, ally], [foe], { enemyX: 700, duration: 0.5 });
    const hazardStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [{ id: "guarded-bolt", type: "lightning", x: 220, y: 100, radius: 14, parameters: { damage: 100 } }],
    };
    const runtime = createBattleRuntime({
      ...battleSetup,
      stage: hazardStage,
      partyPositions: [vec2(100, 100), vec2(160, 100)],
    });
    runtime.drainEvents();
    runtime.setAim({ direction: vec2(1, 0), power: 1 });
    runtime.launch();
    runtime.advance(0.6);
    const damage = runtime.drainEvents().find((event) => event.type === "heroDamaged" && event.sourceKind === "hazard");
    expect(damage).toMatchObject({ actorId: "guarded-bolt", targetId: "hazard-actor", amount: 65, mitigatedAmount: 35 });
  });

  it("uses anatomy collider types and authored phase ids in boss actions", () => {
    const boss = enemy("phase-boss", {
      boss: true,
      behaviorId: "heavy",
      stats: { hp: 1000, attack: 20, speed: 0 },
      attackCountdown: 1,
      attack: { kind: "phase-smash", power: 20, range: 220 },
    });
    const striker = hero("phase-striker", { stats: { hp: 200, attack: 340, speed: 100 } });
    const battleSetup = setup([striker], [boss], { enemyX: 300, duration: 0.6 });
    const bossStage: StageDefinition = {
      ...battleSetup.stage,
      boss: {
        bossId: boss.id,
        supportBossIds: [],
        phaseIds: ["calm", "fury", "last-stand"],
        anatomy: { forepaws: 1 },
        parts: [{ id: "boss-paw", kind: "forepaw", count: 1, collider: "capsule", weakpoint: true, breakable: true }],
      },
    };
    const runtime = createBattleRuntime({
      ...battleSetup,
      stage: bossStage,
      config: { ...battleSetup.config, damageVariance: 0, criticalChance: 0 },
    });
    runtime.drainEvents();
    playOneTurn(runtime);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.enemies[0]!.weakpoints[0]).toMatchObject({ collider: "capsule", rotation: 0.45 });
    expect(snapshot.stagePhase).toBeGreaterThanOrEqual(2);
    expect(snapshot.enemyIntents[0]!.attackKind).toContain(`:${bossStage.boss!.phaseIds[snapshot.stagePhase - 1]}`);
  });

  it("caps active charge to a usable normal-stage budget", () => {
    const longCharge = hero("long-charge", {
      activeSkill: { name: "signature", chargeTurns: 17, effects: [] },
    });
    const runtime = createBattleRuntime(setup([longCharge], [enemy("charge-dummy", { attackCountdown: 99 })], {
      enemyX: 700,
      duration: 0.05,
      turnLimit: 8,
    }));
    expect(runtime.getSnapshot().party[0]!.activeSkill.requiredCharge).toBe(5);
  });

  it("makes light heroes launch faster while heavy heroes hit with more momentum", () => {
    const foe = enemy("mass-dummy", { stats: { hp: 9999, attack: 1, speed: 1 }, attackCountdown: 99 });
    const light = createBattleRuntime(setup([hero("light", { mass: 0.6 })], [foe], { enemyX: 700, duration: 0.1 }));
    const heavy = createBattleRuntime(setup([hero("heavy", { mass: 1.5 })], [foe], { enemyX: 700, duration: 0.1 }));
    const lightPreview = light.setAim({ direction: vec2(1, 0), power: 1 });
    const heavyPreview = heavy.setAim({ direction: vec2(1, 0), power: 1 });
    expect(Math.hypot(lightPreview!.trajectory.initialVelocity.x, lightPreview!.trajectory.initialVelocity.y))
      .toBeGreaterThan(Math.hypot(heavyPreview!.trajectory.initialVelocity.x, heavyPreview!.trajectory.initialVelocity.y));
  });

  it("emits renderable wall movement state when authored walls rotate", () => {
    const battleSetup = setup([hero("wall-observer")], [enemy("wall-watcher", { attackCountdown: 99 })], {
      enemyX: 700,
      wallX: 500,
      duration: 0.05,
    });
    const rotatingStage: StageDefinition = {
      ...battleSetup.stage,
      modifiers: ["walls-rotate-after-shot"],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: rotatingStage });
    runtime.drainEvents();
    playTurn(runtime, vec2(0, 1));
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "wallMoved",
      targetId: "right-wall",
      offset: { x: 0, y: 0 },
      rotation: expect.any(Number),
    }));
  });

  it("drives route-one boss phases from bond and survival progress instead of boss HP", () => {
    const authoredSetup = (stageId: string): BattleSetup => ({
      stage: STAGES.find((entry) => entry.id === stageId)!,
      party: [hero(`route-hero-${stageId}`)],
      enemyCatalog: ENEMY_BY_ID,
      seed: `phase-${stageId}`,
      config: { maxProjectileDuration: 0.02, minLaunchSpeed: 200, maxLaunchSpeed: 200 },
    });

    const bondSetup = authoredSetup("r01-s03");
    const bondSnapshot = createBattleRuntime(bondSetup).getSnapshot();
    bondSnapshot.objective.targets[0]!.completed = true;
    bondSnapshot.objective.targets[1]!.completed = true;
    const bondRuntime = restoreBattleRuntime(bondSetup, bondSnapshot);
    bondRuntime.drainEvents();
    playTurn(bondRuntime, vec2(1, 0));
    expect(bondRuntime.getSnapshot().stagePhase).toBe(3);
    expect(bondRuntime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "stagePhaseChanged",
      effectKind: "bond-progress",
      current: 3,
    }));

    const survivalSetup = authoredSetup("r01-s04");
    const survivalSnapshot = createBattleRuntime(survivalSetup).getSnapshot();
    survivalSnapshot.completedTurns = 4;
    const survivalRuntime = restoreBattleRuntime(survivalSetup, survivalSnapshot);
    survivalRuntime.drainEvents();
    playTurn(survivalRuntime, vec2(1, 0));
    expect(survivalRuntime.getSnapshot().stagePhase).toBe(3);
    expect(survivalRuntime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "stagePhaseChanged",
      effectKind: "survival-progress",
      current: 3,
    }));
  });
});
