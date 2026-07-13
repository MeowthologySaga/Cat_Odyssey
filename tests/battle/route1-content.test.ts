import { describe, expect, it } from "vitest";

import { createBattleRuntime, type BattleRuntime } from "../../src/core/battle";
import { ENEMY_BY_ID, HERO_BY_ID, STAGE_BY_ID } from "../../src/data";
import { vec2 } from "../../src/simulation";

function fireAtObjective(runtime: BattleRuntime, targetId: string): void {
  const before = runtime.getSnapshot();
  const actor = before.party.find((member) => member.alive)!;
  const target = before.objective.targets.find((entry) => entry.id === targetId)!;
  expect(runtime.setAim({
    direction: vec2(target.position.x - actor.position.x, target.position.y - actor.position.y),
    power: 1,
  })).not.toBeNull();
  expect(runtime.launch()).not.toBeNull();
  for (let step = 0; step < 2_000 && runtime.getSnapshot().phase === "projectile"; step += 1) {
    runtime.advance(1 / 120);
  }
  expect(runtime.getSnapshot().phase).not.toBe("projectile");
}

describe("Route 1 authored interaction balance", () => {
  it("shows damaged and fallen tree states before the third contact leaves a stump", () => {
    const runtime = createBattleRuntime({
      stage: STAGE_BY_ID["r01-s01"]!,
      party: [HERO_BY_ID["meow-dysseus"]!],
      enemyCatalog: ENEMY_BY_ID,
      seed: "route1:tree-state-sequence",
      config: {
        fixedStep: 1 / 120,
        maxProjectileDuration: 0.8,
        minLaunchSpeed: 620,
        maxLaunchSpeed: 620,
        defaultFriction: 0,
        damageVariance: 0,
        criticalChance: 0,
      },
    });

    const visualState = () => runtime.getSnapshot().props.find((prop) => prop.id === "timber-tree-c")?.visualState;
    expect(visualState()).toBe("intact");
    fireAtObjective(runtime, "timber-tree-c");
    expect(visualState()).toBe("damaged");
    fireAtObjective(runtime, "timber-tree-c");
    expect(visualState()).toBe("fallen");
    fireAtObjective(runtime, "timber-tree-c");
    expect(visualState()).toBe("stump");
  });

  it("initializes raft pieces as two-contact assembly targets with authored destinations", () => {
    const runtime = createBattleRuntime({
      stage: STAGE_BY_ID["r01-s02"]!,
      party: [HERO_BY_ID["meow-dysseus"]!],
      enemyCatalog: ENEMY_BY_ID,
      seed: "route1:raft-contract",
    });
    const snapshot = runtime.getSnapshot();
    expect(snapshot.victoryRule).toMatchObject({ type: "completeTargets", objectiveType: "assemble", required: 3 });
    expect(snapshot.props).toHaveLength(3);
    for (const prop of snapshot.props) {
      expect(prop).toMatchObject({
        interactionMode: "assembly",
        visualState: "unlashed",
        progress: 0,
        requiredProgress: 2,
      });
      expect(prop.destination).toBeDefined();
    }
  });
});
