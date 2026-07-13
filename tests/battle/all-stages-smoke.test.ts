import { describe, expect, it } from "vitest";
import { compileStageDefinitionModifiers, createBattleRuntime } from "../../src/core/battle";
import { ENEMY_BEHAVIOR_BY_ID, ENEMY_BY_ID, HEROES, STAGES } from "../../src/data";
import { vec2 } from "../../src/simulation";

describe("all authored campaign stages", () => {
  it.each(STAGES.flatMap((stage) => [1, 2, 3].map((partySize) => [stage.id, partySize, stage] as const)))(
    "%s with %i hero(es) initializes and completes a deterministic projectile turn",
    (stageId, partySize, stage) => {
      const runtime = createBattleRuntime({
        stage,
        party: HEROES.slice(0, partySize),
        enemyCatalog: ENEMY_BY_ID,
        enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
        seed: `smoke:${stageId}:party-${partySize}`,
        config: {
          fixedStep: 1 / 120,
          maxProjectileDuration: 0.12,
          minLaunchSpeed: 420,
          maxLaunchSpeed: 420,
          damageVariance: 0,
          criticalChance: 0,
        },
      });

      const initial = runtime.getSnapshot();
      const compiled = compileStageDefinitionModifiers(stage);
      expect(compiled.unsupported, stageId).toEqual([]);
      expect(initial.modifiers, stageId).toHaveLength(compiled.effects.length);
      expect(initial.hazards, stageId).toHaveLength(stage.hazards.length);
      expect(initial.objective.required, stageId).toBeGreaterThan(0);

      if (initial.phase === "awaitingAim") {
        const direction = vec2(stage.order % 2 === 0 ? -0.3 : 0.3, -1);
        const preview = runtime.setAim({ direction, power: 0.72 });
        expect(preview, stageId).not.toBeNull();
        expect(runtime.launch(), stageId).not.toBeNull();

        for (let step = 0; step < 2_000 && runtime.getSnapshot().phase === "projectile"; step += 1) {
          runtime.advance(1 / 60);
        }
        expect(runtime.getSnapshot().phase, stageId).not.toBe("projectile");
      }

      expect(() => JSON.stringify(runtime.serialize()), stageId).not.toThrow();
    },
  );
});
