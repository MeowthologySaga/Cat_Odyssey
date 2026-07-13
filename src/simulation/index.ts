/**
 * Deterministic ricochet simulation.
 *
 * @example
 * ```ts
 * import { previewRicochet, simulateRicochet, vec2 } from "./simulation";
 *
 * const input = {
 *   position: vec2(120, 420),
 *   velocity: vec2(900, -240),
 *   duration: 1.5,
 *   moverRadius: 24,
 *   colliders: [
 *     { id: "cliff", type: "segment", a: vec2(0, 0), b: vec2(1280, 0), restitution: 0.94 },
 *     { id: "eye", type: "weakpoint", center: vec2(840, 260), radius: 32, response: "passThrough", hitCooldown: 0.12 },
 *   ],
 * } as const;
 *
 * const preview = previewRicochet(input);
 * const actual = simulateRicochet(input); // exact same solver and result
 * ```
 */

export * from "./vec2";
export * from "./collision";
export * from "./ricochet";
export * from "./rng";

