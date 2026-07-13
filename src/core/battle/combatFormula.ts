import type { RicochetClass } from "../../data/types";

export interface RicochetPhysicsProfile {
  readonly launchSpeedMultiplier: number;
  readonly frictionMultiplier: number;
  readonly impactMultiplier: number;
  readonly label: "balanced" | "piercing" | "heavy" | "striker" | "support";
}

export const RICOCHET_PHYSICS_PROFILES: Readonly<Record<RicochetClass, RicochetPhysicsProfile>> = Object.freeze({
  bounce: { launchSpeedMultiplier: 1, frictionMultiplier: 0.9, impactMultiplier: 1, label: "balanced" },
  pierce: { launchSpeedMultiplier: 1.05, frictionMultiplier: 0.65, impactMultiplier: 0.96, label: "piercing" },
  heavy: { launchSpeedMultiplier: 0.94, frictionMultiplier: 0.52, impactMultiplier: 1.16, label: "heavy" },
  burst: { launchSpeedMultiplier: 1.03, frictionMultiplier: 1.42, impactMultiplier: 1.08, label: "striker" },
  support: { launchSpeedMultiplier: 0.95, frictionMultiplier: 1.24, impactMultiplier: 0.9, label: "support" },
});

export interface HeroImpactFormulaInput {
  readonly ricochetClass: RicochetClass;
  readonly mass: number;
  readonly impactSpeed: number;
  readonly referenceSpeed: number;
  /** Absolute incoming velocity dot surface normal, clamped to 0..1. */
  readonly incidence: number;
  readonly ricochetCount: number;
  readonly comboCount: number;
}

export type ImpactGrade = "glancing" | "solid" | "crushing";

export interface HeroImpactFormulaResult {
  readonly multiplier: number;
  readonly speedRatio: number;
  readonly speedMultiplier: number;
  readonly incidence: number;
  readonly angleMultiplier: number;
  readonly ricochetMultiplier: number;
  readonly comboMultiplier: number;
  readonly massMultiplier: number;
  readonly classMultiplier: number;
  readonly grade: ImpactGrade;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Conservative contact multiplier. A nearly stopped projectile still deals
 * readable chip damage, while speed, head-on angle and a long bank chain add
 * bounded bonuses instead of multiplying into one-shot spikes.
 */
export function resolveHeroImpactFormula(input: HeroImpactFormulaInput): HeroImpactFormulaResult {
  const profile = RICOCHET_PHYSICS_PROFILES[input.ricochetClass];
  const safeReference = Math.max(1, input.referenceSpeed);
  const speedRatio = Math.max(0, input.impactSpeed) / safeReference;
  const speedMultiplier = clamp(0.55 + 0.45 * Math.sqrt(speedRatio), 0.55, 1.18);
  const incidence = clamp(input.incidence, 0, 1);
  const angleMultiplier = 0.82 + incidence * 0.18;
  const ricochetMultiplier = 1 + Math.min(8, Math.max(0, Math.floor(input.ricochetCount))) * 0.025;
  const comboMultiplier = 1 + Math.min(12, Math.max(0, Math.floor(input.comboCount))) * 0.0125;
  const massMultiplier = clamp(0.92 + Math.sqrt(Math.max(0.35, input.mass)) * 0.08, 0.94, 1.12);
  const multiplier = profile.impactMultiplier
    * speedMultiplier
    * angleMultiplier
    * ricochetMultiplier
    * comboMultiplier
    * massMultiplier;
  const grade: ImpactGrade = incidence < 0.42 || speedMultiplier < 0.76
    ? "glancing"
    : multiplier >= 1.28 && incidence >= 0.72
      ? "crushing"
      : "solid";
  return {
    multiplier,
    speedRatio,
    speedMultiplier,
    incidence,
    angleMultiplier,
    ricochetMultiplier,
    comboMultiplier,
    massMultiplier,
    classMultiplier: profile.impactMultiplier,
    grade,
  };
}

export type DamageCapTarget = "enemy" | "weakpoint" | "wall" | "objective";

export interface DamageCapInput {
  readonly rawDamage: number;
  readonly targetMaxHp: number;
  readonly target: DamageCapTarget;
  readonly boss?: boolean;
  readonly elite?: boolean;
}

export interface DamageCapResult {
  readonly damage: number;
  readonly capped: boolean;
  readonly cap: number;
}

/** Per-contact cap; a full launch may still defeat a target through real repeat contacts. */
export function capHeroContactDamage(input: DamageCapInput): DamageCapResult {
  const raw = Math.max(1, Math.round(input.rawDamage));
  // Small authored props are explicit one-contact beats (tutorial ropes,
  // switches, brittle cover), not durability enemies.
  const ratio = input.target !== "enemy" && input.targetMaxHp <= 80
    ? 1
    : input.target === "weakpoint"
    ? 0.65
    : input.target === "wall" || input.target === "objective"
      ? 0.58
      : input.boss
        ? 0.22
        : input.elite
          ? 0.48
          : 0.78;
  const cap = Math.max(24, Math.round(Math.max(1, input.targetMaxHp) * ratio));
  return { damage: Math.min(raw, cap), capped: raw > cap, cap };
}

export function classDamageMultiplier(ricochetClass: RicochetClass): number {
  if (ricochetClass === "heavy") return 1.14;
  if (ricochetClass === "burst") return 1.08;
  if (ricochetClass === "support") return 0.92;
  if (ricochetClass === "pierce") return 0.98;
  return 1;
}
