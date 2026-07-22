import { describe, expect, it } from "vitest";

import { ENEMIES, RELICS, ROUTES, STAGES } from "../../src/data";

describe("stage data schema", () => {
  const enemyIds = new Set(ENEMIES.map((enemy) => enemy.id));
  const bossIds = new Set(ENEMIES.filter((enemy) => enemy.boss).map((enemy) => enemy.id));
  const relicIds = new Set(RELICS.map((relic) => relic.id));

  it("declares a complete data payload for every stage", () => {
    for (const stage of STAGES) {
      expect(stage.arena).toMatchObject({ width: 720, height: 1040 });
      expect(stage.walls.length, `${stage.id} walls`).toBeGreaterThan(0);
      expect(stage.spawns.some((spawn) => spawn.kind === "party"), `${stage.id} party spawn`).toBe(true);
      expect(Array.isArray(stage.enemies), `${stage.id} enemies`).toBe(true);
      expect(Array.isArray(stage.hazards), `${stage.id} hazards`).toBe(true);
      expect(stage.objective.turnLimit, `${stage.id} turn limit`).toBeGreaterThan(0);
      expect(stage.rewards.gold, `${stage.id} gold`).toBeGreaterThanOrEqual(0);
      expect(stage.rewards.heroXp, `${stage.id} xp`).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(stage.modifiers), `${stage.id} modifiers`).toBe(true);
      expect(Object.hasOwn(stage, "boss"), `${stage.id} boss field`).toBe(true);
    }
  });

  it("resolves every enemy placement to a declared spawn and enemy", () => {
    for (const stage of STAGES) {
      const spawns = new Map(stage.spawns.map((spawn) => [spawn.id, spawn]));
      for (const placement of stage.enemies) {
        expect(enemyIds.has(placement.enemyId), `${stage.id}: ${placement.enemyId}`).toBe(true);
        expect(spawns.has(placement.spawnId), `${stage.id}: ${placement.spawnId}`).toBe(true);
        expect(["enemy", "boss"]).toContain(spawns.get(placement.spawnId)?.kind);
      }
    }
  });

  it("resolves all bosses and relic first-clear rewards", () => {
    for (const stage of STAGES) {
      if (stage.boss) {
        expect(bossIds.has(stage.boss.bossId), `${stage.id}: ${stage.boss.bossId}`).toBe(true);
        for (const supportBossId of stage.boss.supportBossIds) {
          expect(bossIds.has(supportBossId), `${stage.id}: ${supportBossId}`).toBe(true);
        }
      }
      if (stage.rewards.firstClear.kind === "relic") {
        expect(relicIds.has(stage.rewards.firstClear.id), `${stage.id}: ${stage.rewards.firstClear.id}`).toBe(true);
      }
    }
  });

  it("matches each route's explicit stage list and order", () => {
    for (const route of ROUTES) {
      const stages = STAGES.filter((stage) => stage.routeId === route.id).sort((a, b) => a.order - b.order);
      expect(stages.map((stage) => stage.id)).toEqual(route.stageIds);
      expect(stages.map((stage) => stage.order)).toEqual(route.stageIds.map((_, index) => index + 1));
    }
  });

  it("authors Route 1 as a solo-friendly Ogygia escape in Odyssey order", () => {
    const routeOne = STAGES.filter((stage) => stage.routeId === "route-01-ogygia")
      .sort((left, right) => left.order - right.order);
    expect(routeOne.map((stage) => stage.name)).toEqual([
      "뗏목을 위한 숲",
      "파도 앞의 뗏목",
      "캣-립소의 작별 시험",
      "포-사이돈의 분노",
    ]);
    expect(routeOne.map((stage) => stage.recommendedPower)).toEqual([80, 105, 135, 175]);
    expect(new Set(routeOne.map((stage) => stage.arena.backgroundKey)).size).toBe(4);
    expect(routeOne.every((stage) => stage.arena.backgroundAssetUrl?.startsWith("assets/art/maps/stages/r01-")))
      .toBe(true);

    const [forest, raft, farewell, storm] = routeOne;
    expect(forest?.objective).toMatchObject({ type: "break-parts", requiredCount: 3 });
    expect(forest?.objective.targetIds.every((id) => id.startsWith("timber-tree-"))).toBe(true);
    expect(forest?.enemies).toEqual([]);
    expect(forest?.spawns.filter((spawn) => spawn.id.startsWith("timber-tree-")).every(
      (spawn) => spawn.interaction?.mode === "destructible" && spawn.interaction.maxHp === 380,
    )).toBe(true);

    expect(raft?.objective).toMatchObject({ type: "assemble", requiredCount: 3 });
    expect(raft?.objective.targetIds.every((id) => id.startsWith("raft-lash-"))).toBe(true);
    expect(raft?.hazards.map((hazard) => hazard.type)).toContain("moving-bumper");
    expect(raft?.enemies.map((enemy) => enemy.enemyId)).toEqual(["foam-crab"]);
    expect(raft?.spawns.filter((spawn) => spawn.id.startsWith("raft-lash-")).every(
      (spawn) => spawn.interaction?.mode === "assembly"
        && spawn.interaction.hitsRequired === 2
        && Boolean(spawn.interaction.destination),
    )).toBe(true);
    const raftObstacles = [
      ...raft!.spawns.filter((spawn) => spawn.kind === "party" || raft!.objective.targetIds.includes(spawn.id)),
    ];
    for (const obstacle of raftObstacles) {
      for (const hazard of raft!.hazards) {
        expect(
          Math.hypot(obstacle.x - hazard.x, obstacle.y - hazard.y),
          `${obstacle.id} must not initially overlap ${hazard.id}`,
        ).toBeGreaterThan(obstacle.radius + hazard.radius + 8);
      }
    }

    expect(farewell?.boss?.bossId).toBe("cat-lypso-trial");
    expect(farewell?.modifiers).toContain("boss-cannot-be-killed");
    expect(farewell?.objective.targetIds.every((id) => id.startsWith("island-bond-"))).toBe(true);
    expect(farewell?.spawns.filter((spawn) => spawn.id.startsWith("island-bond-")).every(
      (spawn) => spawn.interaction?.mode === "bond" && spawn.interaction.maxHp === 180,
    )).toBe(true);
    expect(ENEMIES.find((enemy) => enemy.id === "cat-lypso-trial")?.tags).toContain("nonlethal");

    expect(storm?.objective).toMatchObject({ type: "survive", turnLimit: 7 });
    expect(storm?.enemies.map((enemy) => enemy.enemyId)).toEqual([
      "storm-avatar",
      "foam-crab",
      "storm-jelly",
    ]);
    expect(new Set(storm?.hazards.map((hazard) => hazard.type))).toEqual(
      new Set(["current", "wave-front", "lightning"]),
    );
    expect(storm?.hazards.find((hazard) => hazard.type === "wave-front")?.parameters).toMatchObject({
      axis: "y",
      direction: -1,
      forceY: -115,
      length: 720,
    });
    expect(storm?.modifiers).toContain("survival-boss");
  });

  it("replaces Route 3 and Route 5 defeat-all streaks with supported story actions", () => {
    const objectiveSequence = (routeId: string) => STAGES
      .filter((stage) => stage.routeId === routeId)
      .sort((left, right) => left.order - right.order)
      .map((stage) => stage.objective.type);

    expect(objectiveSequence("route-03-cyclops")).toEqual([
      "defeat-all", "survive", "escape", "defeat-all", "break-parts",
    ]);
    expect(objectiveSequence("route-05-circe")).toEqual([
      "defeat-all", "survive", "escape", "seal",
    ]);

    const caveExit = STAGES.find((stage) => stage.id === "r03-s03")!;
    expect(caveExit.name).toBe("거석으로 여는 퇴로");
    expect(caveExit.objective).toMatchObject({ targetIds: ["north-exit"], requiredCount: 1 });
    expect(caveExit.modifiers).toContain("exit-opens-after-one-brute-stagger");
    expect(caveExit.enemies.some((placement) => placement.enemyId === "rock-tortoise")).toBe(true);

    const mirrorExit = STAGES.find((stage) => stage.id === "r05-s03")!;
    expect(mirrorExit.name).toBe("거울 회랑 탈출");
    expect(mirrorExit.objective).toMatchObject({ type: "escape", targetIds: ["north-exit"] });
  });

  it("keeps every campaign seal objective compatible with one-, two-, and three-hero parties", () => {
    const underworldGate = STAGES.find((stage) => stage.id === "r06-s04")!;
    expect(underworldGate.modifiers).not.toContain("three-color-seal");
    expect(underworldGate.modifiers).toContain("seal-requires-three-angles");
  });

  it("connects every Route 2 stage to its authored foundation-only plate", () => {
    const routeTwo = STAGES.filter((stage) => stage.routeId === "route-02-lotus")
      .sort((left, right) => left.order - right.order);
    expect(routeTwo.map((stage) => stage.arena.backgroundAssetUrl)).toEqual([
      "assets/art/maps/stages/r02-s01-first-scent.webp",
      "assets/art/maps/stages/r02-s02-sleeping-camp.webp",
      "assets/art/maps/stages/r02-s03-dream-fork.webp",
      "assets/art/maps/stages/r02-s04-lotus-heart.webp",
    ]);

    const expectedWallSizes = [
      [[542, 252], [542, 252]],
      [[208, 208], [208, 208]],
      [[334, 252], [334, 252]],
      [[422, 252], [422, 252]],
    ];
    for (const [stageIndex, stage] of routeTwo.entries()) {
      expect(stage.walls.map((wall) => [wall.presentation?.width, wall.presentation?.height]))
        .toEqual(expectedWallSizes[stageIndex]);
      expect(stage.walls.every((wall) => wall.presentation?.visualId === "wall-lotus-dream-petal"))
        .toBe(true);
    }
  });

  it("fits Route 3 Cyclops wall art to every authored collider", () => {
    const routeThree = STAGES.filter((stage) => stage.routeId === "route-03-cyclops")
      .sort((left, right) => left.order - right.order);
    const expected = [
      [["wall-cyclops-slab", 706, 300], ["wall-cyclops-slab", 706, 300]],
      [["wall-cyclops-slab", 533, 300], ["wall-cyclops-slab", 436, 300]],
      [["wall-cyclops-slab", 489, 317], ["wall-cyclops-slab", 556, 300]],
      [["wall-cyclops-wine-rack", 173, 112], ["wall-cyclops-wine-rack", 173, 112]],
      [["wall-cyclops-slab", 460, 354], ["wall-cyclops-slab", 460, 354], ["wall-cyclops-slab", 200, 242]],
    ];

    expect(routeThree).toHaveLength(5);
    for (const [stageIndex, stage] of routeThree.entries()) {
      expect(stage.walls.map((wall) => [
        wall.presentation?.visualId,
        wall.presentation?.width,
        wall.presentation?.height,
      ])).toEqual(expected[stageIndex]);
    }
    expect(routeThree.flatMap((stage) => stage.walls).filter((wall) => wall.breakable).every(
      (wall) => wall.presentation?.stateVisualIds?.broken === undefined,
    )).toBe(true);
  });

  it("keeps the Cat-clopses log guards exclusive to Poly-meow-mus's boss room", () => {
    const bossRoom = STAGES.find((stage) => stage.id === "r03-s05")!;
    expect(bossRoom.enemies.map((placement) => placement.enemyId)).toEqual([
      "poly-meow-mus",
      "cyclops-logguard",
      "cyclops-logguard",
    ]);

    const earlierRouteThreeStages = STAGES.filter(
      (stage) => stage.routeId === "route-03-cyclops" && stage.id !== bossRoom.id,
    );
    expect(earlierRouteThreeStages.flatMap((stage) => stage.enemies).some(
      (placement) => placement.enemyId === "cyclops-logguard",
    )).toBe(false);
    expect(earlierRouteThreeStages.flatMap((stage) => stage.enemies).some(
      (placement) => placement.enemyId === "cyclops-stoneguard",
    )).toBe(true);

    const logGuard = ENEMIES.find((enemy) => enemy.id === "cyclops-logguard");
    expect(logGuard).toMatchObject({
      behaviorId: "shield",
      visualKey: "enemy-cyclops-logguard",
      attack: { kind: "log-guard-bash" },
    });
    expect(logGuard?.tags).toEqual(expect.arrayContaining(["cyclops", "guard", "one-eye", "club"]));
  });

  it("connects every Route 4 stage to a distinct 720x1040 foundation plate", () => {
    const routeFour = STAGES.filter((stage) => stage.routeId === "route-04-aeolus")
      .sort((left, right) => left.order - right.order);
    expect(routeFour.map((stage) => stage.arena.backgroundAssetUrl)).toEqual([
      "assets/art/maps/stages/r04-s01-wind-gate.webp",
      "assets/art/maps/stages/r04-s02-cloud-gates.webp",
      "assets/art/maps/stages/r04-s03-giant-harbor.webp",
      "assets/art/maps/stages/r04-s04-wind-vault.webp",
    ]);
    expect(routeFour.every((stage) => stage.arena.width === 720 && stage.arena.height === 1040)).toBe(true);
    expect(new Set(routeFour.map((stage) => stage.arena.backgroundAssetUrl)).size).toBe(4);

    const expectedWalls = [
      [["wall-aeolus-cloud-crest", 623, 300], ["wall-aeolus-cloud-crest", 623, 300]],
      [["wall-aeolus-bronze-gate", 222, 239], ["wall-aeolus-bronze-gate", 222, 239]],
      [["wall-giant-harbor-breakwater", 504, 361], ["wall-giant-harbor-breakwater", 504, 361]],
      [["wall-aeolus-bronze-gate", 617, 320], ["wall-aeolus-bronze-gate", 617, 320]],
    ];
    expect(routeFour.flatMap((stage) => stage.walls)).toHaveLength(8);
    for (const [stageIndex, stage] of routeFour.entries()) {
      expect(stage.walls.map((wall) => [
        wall.presentation?.visualId,
        wall.presentation?.width,
        wall.presentation?.height,
      ])).toEqual(expectedWalls[stageIndex]);
    }
  });
});
