/**
 * Scene-agnostic deterministic battle runtime.
 *
 * @example
 * ```ts
 * import { createBattleRuntime } from "./core/battle";
 * import { ENEMY_BY_ID, HERO_BY_ID, STAGE_BY_ID } from "./data";
 *
 * const runtime = createBattleRuntime({
 *   stage: STAGE_BY_ID["r01-s01"]!,
 *   party: [HERO_BY_ID["meow-dysseus"]!, HERO_BY_ID["a-paw-na"]!],
 *   enemyCatalog: ENEMY_BY_ID,
 *   seed: "r01-s01:attempt-3",
 * });
 *
 * const preview = runtime.setAim({ direction: { x: 0.6, y: -0.8 }, power: 0.9 });
 * runtime.launch(); // launch uses the same trajectory builder as preview
 * runtime.advance(1 / 60); // internally resolved at the configured fixed step
 * const events = runtime.drainEvents(); // feed Phaser visuals/audio only
 * const saveable = runtime.serialize();
 * ```
 */

export * from "./types";
export * from "./runtime";
export * from "./stageModifiers";
export * from "./dynamicEnemyContract";
export * from "./combatFormula";
export * from "./soundWaveGeometry";
