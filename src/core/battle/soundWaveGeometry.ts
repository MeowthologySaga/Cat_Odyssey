import type { Vec2 } from "../../simulation";

export type SoundWaveParameters = Readonly<Record<string, number | string | boolean>>;

export interface SoundWaveAngularPattern {
  /** A safe opening cut out of an otherwise dangerous ring. */
  readonly safeGap?: {
    readonly centerDegrees: number;
    readonly widthDegrees: number;
  };
  /** Explicit dangerous cones; space outside these cones is safe. */
  readonly damageFans: readonly {
    readonly centerDegrees: number;
    readonly widthDegrees: number;
  }[];
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function angularDifferenceDegrees(left: number, right: number): number {
  return Math.abs(((normalizeDegrees(left) - normalizeDegrees(right) + 540) % 360) - 180);
}

/**
 * Compiles the authored sound-wave parameters into the exact angular pattern
 * used by both deterministic collision and Phaser telegraph rendering.
 */
export function soundWaveAngularPattern(parameters: SoundWaveParameters): SoundWaveAngularPattern {
  const safeGapWidth = finitePositive(parameters.rotatingGapDegrees);
  const rotation = normalizeDegrees(finiteNumber(parameters.gapAngle));
  const fanCount = Math.max(0, Math.round(finiteNumber(parameters.fanCount)));
  const fanWidth = finitePositive(parameters.fanDegrees);
  return {
    safeGap: safeGapWidth > 0
      ? { centerDegrees: rotation, widthDegrees: Math.min(360, safeGapWidth) }
      : undefined,
    damageFans: fanCount > 0 && fanWidth > 0
      ? Array.from({ length: fanCount }, (_, index) => ({
        centerDegrees: normalizeDegrees(rotation + index * 360 / fanCount),
        widthDegrees: Math.min(360, fanWidth),
      }))
      : [],
  };
}

export function isSoundWaveContactSafe(
  center: Vec2,
  parameters: SoundWaveParameters,
  position: Vec2,
): boolean {
  const angle = normalizeDegrees(Math.atan2(position.y - center.y, position.x - center.x) * 180 / Math.PI);
  const pattern = soundWaveAngularPattern(parameters);
  if (
    pattern.safeGap
    && angularDifferenceDegrees(angle, pattern.safeGap.centerDegrees) <= pattern.safeGap.widthDegrees / 2
  ) {
    return true;
  }
  if (pattern.damageFans.length > 0) {
    return !pattern.damageFans.some(
      (fan) => angularDifferenceDegrees(angle, fan.centerDegrees) <= fan.widthDegrees / 2,
    );
  }
  return false;
}

function finiteNumber(value: number | string | boolean | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function finitePositive(value: number | string | boolean | undefined): number {
  return Math.max(0, finiteNumber(value));
}
