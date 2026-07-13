/** A small immutable-by-convention vector used by the deterministic solver. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const VEC2_ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(value: Vec2, scalar: number): Vec2 {
  return { x: value.x * scalar, y: value.y * scalar };
}

export function multiply(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x * b.x, y: a.y * b.y };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSquared(value: Vec2): number {
  return dot(value, value);
}

export function length(value: Vec2): number {
  return Math.sqrt(lengthSquared(value));
}

export function distanceSquared(a: Vec2, b: Vec2): number {
  return lengthSquared(sub(a, b));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(distanceSquared(a, b));
}

export function normalize(value: Vec2, fallback: Vec2 = VEC2_ZERO): Vec2 {
  const magnitude = length(value);
  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
    return { x: fallback.x, y: fallback.y };
  }
  return scale(value, 1 / magnitude);
}

export function perpendicularLeft(value: Vec2): Vec2 {
  return { x: -value.y, y: value.x };
}

export function perpendicularRight(value: Vec2): Vec2 {
  return { x: value.y, y: -value.x };
}

export function negate(value: Vec2): Vec2 {
  return { x: -value.x, y: -value.y };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampMagnitude(value: Vec2, maxLength: number): Vec2 {
  const safeMax = Math.max(0, maxLength);
  const magnitudeSquared = lengthSquared(value);
  if (magnitudeSquared <= safeMax * safeMax) return { ...value };
  return scale(normalize(value), safeMax);
}

export function almostEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function vecAlmostEqual(a: Vec2, b: Vec2, epsilon = 1e-9): boolean {
  return almostEqual(a.x, b.x, epsilon) && almostEqual(a.y, b.y, epsilon);
}

export function isFiniteVec(value: Vec2): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

