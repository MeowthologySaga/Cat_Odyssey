import { describe, expect, it } from "vitest";

import { createBattleRuntime, restoreBattleRuntime, type BattleSetup } from "../../src/core/battle";
import type {
  EnemyDefinition,
  HeroDefinition,
  RuntimeRelicEffect,
  StageDefinition,
} from "../../src/data";
import { vec2 } from "../../src/simulation";

function relic(kind: string, value: number, target = "party"): RuntimeRelicEffect {
  return { kind, value, target, sourceId: `test-${kind}`, sourceLevel: 1 };
}

function hero(effects: readonly RuntimeRelicEffect[] = [], overrides: Partial<HeroDefinition> = {}): HeroDefinition {
  return {
    id: "hero",
    canonicalRefId: "hero",
    name: "Hero",
    original: "Hero",
    epithet: "test",
    rarity: 3,
    element: "sea",
    ricochetClass: "bounce",
    radius: 10,
    mass: 1,
    restitution: 1,
    stats: { hp: 100, attack: 40, speed: 100 },
    friendshipSkill: { name: "friend", effects: [] },
    activeSkill: { name: "active", chargeTurns: 10, effects: [] },
    unlock: "starter",
    visualKey: "hero",
    tags: [],
    runtimeRelicEffects: effects,
    ...overrides,
  };
}

function enemy(id: string, x = 300, overrides: Partial<EnemyDefinition> = {}): EnemyDefinition & { testX: number } {
  return {
    id,
    name: id,
    behaviorId: "charger",
    element: "earth",
    radius: 18,
    stats: { hp: 1000, attack: 10, speed: 10 },
    attackCountdown: 2,
    attack: { kind: "melee", power: 10, range: 40 },
    boss: false,
    visualKey: id,
    tags: [],
    testX: x,
    ...overrides,
  };
}

function setup(
  party: readonly HeroDefinition[],
  enemies: readonly ReturnType<typeof enemy>[],
  options: { weakpoint?: boolean; lightningDamage?: number; duration?: number } = {},
): BattleSetup {
  const stage: StageDefinition = {
    id: "relic-test",
    routeId: "test",
    order: 1,
    name: "Relic Test",
    recommendedPower: 1,
    arena: { id: "arena", theme: "test", width: 720, height: 1040, backgroundKey: "none", musicKey: "none" },
    walls: [],
    spawns: [
      { id: "party", kind: "party", x: 100, y: 100, radius: 10 },
      ...enemies.map((foe, index) => ({
        id: `enemy-${index}`,
        kind: "enemy" as const,
        x: foe.testX,
        y: 100,
        radius: foe.radius,
      })),
    ],
    enemies: enemies.map((foe, index) => ({ enemyId: foe.id, spawnId: `enemy-${index}`, level: 1 })),
    hazards: options.lightningDamage
      ? [{
        id: "lightning",
        type: "lightning",
        x: 190,
        y: 100,
        radius: 28,
        parameters: { damage: options.lightningDamage, warningTurns: 0 },
      }]
      : [],
    objective: { type: "defeat-all", turnLimit: 20, targetIds: [] },
    rewards: { gold: 1, heroXp: 1, materials: {}, firstClear: { kind: "material", id: "test", amount: 1 } },
    modifiers: [],
    boss: null,
  };
  return {
    stage,
    party,
    enemyCatalog: Object.fromEntries(enemies.map((foe) => [foe.id, foe])),
    seed: "relic-effects",
    config: {
      fixedStep: 1 / 120,
      maxProjectileDuration: options.duration ?? 1.1,
      minLaunchSpeed: 400,
      maxLaunchSpeed: 400,
      damageVariance: 0,
      criticalChance: 0,
    },
    partyPositions: party.map((_, index) => vec2(100, 100 + index * 80)),
    weakpoints: options.weakpoint ? [{
      id: "eye",
      enemyInstanceId: "enemy-0",
      partId: "eye",
      position: vec2(enemies[0]!.testX, 100),
      radius: 8,
      maxHp: 1000,
      damageMultiplier: 1,
      breakable: true,
    }] : undefined,
  };
}

function play(runtime: ReturnType<typeof createBattleRuntime>): void {
  runtime.drainEvents();
  runtime.setAim({ direction: vec2(1, 0), power: 1 });
  runtime.launch();
  for (let index = 0; index < 1000 && runtime.getSnapshot().phase === "projectile"; index += 1) {
    runtime.advance(1 / 60);
  }
}

describe("battle relic effects", () => {
  it("allows authored 100% wind and whirlpool resistance to fully cancel launch displacement", () => {
    const effects = [relic("wind-force-reduction", 100), relic("whirlpool-resistance", 100)];
    const hazards: StageDefinition["hazards"] = [
      { id: "wind", type: "current" as const, x: 100, y: 100, radius: 90, parameters: { forceX: 280, forceY: 0 } },
      { id: "whirlpool", type: "whirlpool" as const, x: 150, y: 100, radius: 90, parameters: { force: 280 } },
    ];
    for (const hazard of hazards) {
      const battleSetup = setup([hero(effects)], [enemy("distant", 650)], { duration: 0.4 });
      const runtime = createBattleRuntime({
        ...battleSetup,
        stage: { ...battleSetup.stage, hazards: [hazard] },
      });
      const preview = runtime.setAim({ direction: vec2(0, -1), power: 1 });
      expect(preview).not.toBeNull();
      expect(Math.abs(preview!.trajectory.initialVelocity.x), hazard.type).toBeLessThan(0.001);
    }
  });

  it("delays every enemy's first countdown and accelerates active charge", () => {
    const runtime = createBattleRuntime(setup([
      hero([relic("first-countdown-delay", 2), relic("active-charge-speed", 25)]),
    ], [enemy("foe")]));
    const snapshot = runtime.getSnapshot();
    expect(snapshot.enemies[0]!.attackCountdown).toBe(4);
    expect(snapshot.party[0]!.activeSkill.requiredCharge).toBe(8);
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "statusEffectApplied",
      effectKind: "relic-first-countdown-delay",
      amount: 2,
    }));
  });

  it("increases authoritative weakpoint damage", () => {
    const foe = enemy("boss", 300, { boss: true });
    const base = createBattleRuntime(setup([hero()], [foe], { weakpoint: true, duration: 0.65 }));
    const boosted = createBattleRuntime(setup([
      hero([relic("weakpoint-damage", 50), relic("boss-damage", 25)]),
    ], [foe], { weakpoint: true, duration: 0.65 }));
    play(base);
    play(boosted);
    const baseHit = base.drainEvents().find((event) => event.type === "weakpointHit")!;
    const boostedHit = boosted.drainEvents().find((event) => event.type === "weakpointHit")!;
    expect(boostedHit.amount).toBeGreaterThan(baseHit.amount! * 1.8);
  });

  it("fires chain lightning on the third primary contact", () => {
    const runtime = createBattleRuntime(setup([
      hero([relic("chain-lightning", 72)]),
    ], [enemy("a", 210), enemy("b", 300), enemy("c", 390), enemy("d", 520)]));
    play(runtime);
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "enemyHit",
      effectKind: "relic-chain-lightning",
      amount: 29,
    }));
  });

  it("revives the first fallen hero once with the authored HP percentage", () => {
    const runtime = createBattleRuntime(setup([
      hero([relic("route-revive", 25)]),
    ], [enemy("distant", 650)], { lightningDamage: 999, duration: 0.35 }));
    play(runtime);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.party[0]).toMatchObject({ alive: true, hp: 25 });
    expect(runtime.drainEvents()).toContainEqual(expect.objectContaining({
      type: "statusEffectApplied",
      effectKind: "relic-route-revive",
      amount: 25,
    }));
  });

  it("uses seeded phase chance to remove an authored wall from the whole shot", () => {
    const foe = enemy("wall-watcher", 650);
    const battleSetup = setup([hero([relic("phase-chance", 100)])], [foe], { duration: 0.5 });
    const phasedStage: StageDefinition = {
      ...battleSetup.stage,
      walls: [{
        id: "phase-wall", shape: "segment", x: 220, y: 0, x2: 220, y2: 300,
        material: "stone", restitution: 1,
      }],
    };
    const runtime = createBattleRuntime({ ...battleSetup, stage: phasedStage });
    const preview = runtime.setAim({ direction: vec2(1, 0), power: 1 });
    expect(preview?.trajectory.contacts.some((contact) => contact.targetId === "phase-wall")).toBe(false);
    expect(preview?.trajectory.finalPosition.x).toBeGreaterThan(220);
  });

  it("scales temporary wall durability and extends the first enemy stun", () => {
    const caster = hero([
      relic("temporary-wall-hp", 50),
      relic("stun-duration", 2),
    ], {
      activeSkill: {
        name: "control",
        chargeTurns: 1,
        effects: [
          { kind: "temporary-bumper", value: 1.2, target: "impact-point", durationTurns: 2 },
          { kind: "stun", value: 1, target: "enemy", durationTurns: 1 },
        ],
      },
    });
    const battleSetup = setup([caster], [enemy("target", 500)]);
    const initial = createBattleRuntime(battleSetup).getSnapshot();
    initial.party[0]!.activeSkill.charge = initial.party[0]!.activeSkill.requiredCharge;
    initial.party[0]!.activeSkill.ready = true;
    const activeRuntime = restoreBattleRuntime(battleSetup, initial);
    expect(activeRuntime.activateActiveSkill({ position: vec2(250, 100) })).not.toBeNull();
    expect(activeRuntime.getSnapshot().hazards).toContainEqual(expect.objectContaining({
      parameters: expect.objectContaining({ hp: 150, maxHp: 150 }),
    }));
    expect(activeRuntime.getSnapshot().effects).toContainEqual(expect.objectContaining({
      targetId: "enemy-0",
      kind: "stun",
      remainingTurns: 3,
    }));
  });

  it("heals once after leaving a hazard and regenerates the weakest ally at turn start", () => {
    const regeneratingHero = hero([
      relic("heal-on-hazard-exit", 10),
      relic("regeneration", 8),
      relic("debuff-duration", -1),
    ]);
    const ally = hero([], { id: "ally", canonicalRefId: "ally", visualKey: "ally" });
    const battleSetup = setup([regeneratingHero, ally], [enemy("distant", 650)], { duration: 0.45 });
    const currentStage: StageDefinition = {
      ...battleSetup.stage,
      hazards: [{ id: "gentle-current", type: "slow-field", x: 170, y: 100, radius: 24, parameters: { speedMultiplier: 0.8 } }],
    };
    const setupWithCurrent = { ...battleSetup, stage: currentStage };
    const initial = createBattleRuntime(setupWithCurrent).getSnapshot();
    initial.party[0]!.hp = 50;
    initial.party[1]!.hp = 35;
    const activeRuntime = restoreBattleRuntime(setupWithCurrent, initial);
    play(activeRuntime);
    const snapshot = activeRuntime.getSnapshot();
    expect(snapshot.party[0]!.hp).toBeGreaterThanOrEqual(60);
    expect(snapshot.party[1]!.hp).toBe(43);
    expect(snapshot.effects.some((effect) => effect.targetId === "hero" && effect.kind === "slow-field")).toBe(false);
    expect(activeRuntime.drainEvents()).toContainEqual(expect.objectContaining({
      effectKind: "relic-heal-on-hazard-exit",
      amount: 10,
    }));
  });

  it("applies burn damage over enemy phases and stacks precision weakpoint damage", () => {
    const foes = [enemy("a", 210), enemy("b", 350)];
    const makeSetup = (effects: readonly RuntimeRelicEffect[]): BattleSetup => {
      const base = setup([hero(effects)], foes, { duration: 0.8 });
      return {
        ...base,
        config: { ...base.config, damageVariance: 0, criticalChance: 0 },
        weakpoints: [
          { id: "eye-a", enemyInstanceId: "enemy-0", partId: "eye-a", position: vec2(210, 100), radius: 7, maxHp: 1000, damageMultiplier: 1, breakable: true },
          { id: "eye-b", enemyInstanceId: "enemy-1", partId: "eye-b", position: vec2(350, 100), radius: 7, maxHp: 1000, damageMultiplier: 1, breakable: true },
        ],
      };
    };
    const base = createBattleRuntime(makeSetup([]));
    const boosted = createBattleRuntime(makeSetup([
      relic("precision-chain", 100),
      relic("burn-damage", 50),
    ]));
    play(base);
    play(boosted);
    const baseHits = base.drainEvents().filter((event) => event.type === "weakpointHit");
    const boostedEvents = boosted.drainEvents();
    const boostedHits = boostedEvents.filter((event) => event.type === "weakpointHit");
    expect(boostedHits[0]!.amount).toBe(baseHits[0]!.amount);
    expect(boostedHits[1]!.amount).toBeGreaterThan(baseHits[1]!.amount! * 1.8);
    expect(boostedEvents).toContainEqual(expect.objectContaining({
      type: "enemyHit",
      effectKind: "relic-burn",
    }));
  });

  it("boosts the current projectile after piercing an enemy", () => {
    const foe = enemy("pierce-target", 180);
    const base = createBattleRuntime(setup([hero()], [foe], { duration: 0.4 }));
    const boosted = createBattleRuntime(setup([
      hero([relic("pierce-retained-speed", 50)]),
    ], [foe], { duration: 0.4 }));
    play(base);
    play(boosted);
    expect(boosted.getSnapshot().party[0]!.position.x).toBeGreaterThan(base.getSnapshot().party[0]!.position.x + 20);
  });
});
