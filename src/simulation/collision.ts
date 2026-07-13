import {
  add,
  clamp,
  dot,
  length,
  lengthSquared,
  negate,
  normalize,
  perpendicularLeft,
  scale,
  sub,
  type Vec2,
} from "./vec2";

const GEOMETRY_EPSILON = 1e-9;

export type CollisionResponse = "bounce" | "passThrough" | "stop";

export interface ColliderMaterial {
  /** Normal velocity retained after a bounce. 1 is perfectly elastic. */
  readonly restitution?: number;
  /** Tangential velocity removed on contact, clamped to [0, 1]. */
  readonly friction?: number;
  /** Physical response. Sensors and piercing targets normally use passThrough. */
  readonly response?: CollisionResponse;
  /** Minimum seconds between accepted hit events for this collider. */
  readonly hitCooldown?: number;
}

export interface ColliderBase extends ColliderMaterial {
  readonly id: string;
  readonly enabled?: boolean;
  readonly tag?: string;
  readonly metadata?: unknown;
}

/** A zero-radius segment is a wall; a positive radius makes it a capsule. */
export interface SegmentCollider extends ColliderBase {
  readonly type: "segment";
  readonly a: Vec2;
  readonly b: Vec2;
  readonly radius?: number;
}

/** Weakpoints use identical geometry but remain distinguishable to game logic. */
export interface CircleCollider extends ColliderBase {
  readonly type: "circle" | "weakpoint";
  readonly center: Vec2;
  readonly radius: number;
}

export type Collider = SegmentCollider | CircleCollider;

export type SweepFeature = "segment-side" | "segment-start" | "segment-end" | "circle" | "overlap";

export interface SweepHit {
  readonly collider: Collider;
  /** Fraction of the supplied displacement in [0, 1]. */
  readonly time: number;
  /** Mover-center position at impact. */
  readonly position: Vec2;
  /** Point on the mover boundary facing the collider. */
  readonly contactPoint: Vec2;
  /** Unit normal directed from the collider toward the mover. */
  readonly normal: Vec2;
  readonly feature: SweepFeature;
  readonly startedOverlapping: boolean;
  readonly penetration: number;
}

interface Candidate {
  readonly time: number;
  readonly normal: Vec2;
  readonly feature: SweepFeature;
}

export function closestPointOnSegment(point: Vec2, a: Vec2, b: Vec2): Vec2 {
  const edge = sub(b, a);
  const edgeLengthSquared = lengthSquared(edge);
  if (edgeLengthSquared <= GEOMETRY_EPSILON) return { ...a };
  const t = clamp(dot(sub(point, a), edge) / edgeLengthSquared, 0, 1);
  return add(a, scale(edge, t));
}

export function distanceToSegmentSquared(point: Vec2, a: Vec2, b: Vec2): number {
  return lengthSquared(sub(point, closestPointOnSegment(point, a, b)));
}

function safeCollisionNormal(offset: Vec2, displacement: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
  if (lengthSquared(offset) > GEOMETRY_EPSILON) return normalize(offset);
  if (lengthSquared(displacement) > GEOMETRY_EPSILON) return negate(normalize(displacement));
  return normalize(fallback, { x: 1, y: 0 });
}

function makeSweepHit(
  collider: Collider,
  start: Vec2,
  displacement: Vec2,
  moverRadius: number,
  candidate: Candidate,
  startedOverlapping = false,
  penetration = 0,
): SweepHit {
  const position = add(start, scale(displacement, candidate.time));
  return {
    collider,
    time: clamp(candidate.time, 0, 1),
    position,
    contactPoint: sub(position, scale(candidate.normal, moverRadius)),
    normal: candidate.normal,
    feature: candidate.feature,
    startedOverlapping,
    penetration: Math.max(0, penetration),
  };
}

function pointCircleCandidate(
  start: Vec2,
  displacement: Vec2,
  center: Vec2,
  expandedRadius: number,
  feature: SweepFeature,
): Candidate | null {
  const relative = sub(start, center);
  const displacementLengthSquared = lengthSquared(displacement);
  const radiusSquared = expandedRadius * expandedRadius;
  const separation = lengthSquared(relative) - radiusSquared;

  if (separation <= GEOMETRY_EPSILON) {
    const normal = safeCollisionNormal(relative, displacement);
    const deeplyOverlapping = separation < -GEOMETRY_EPSILON;
    if (deeplyOverlapping || dot(displacement, normal) < -GEOMETRY_EPSILON) {
      return { time: 0, normal, feature: deeplyOverlapping ? "overlap" : feature };
    }
    return null;
  }

  if (displacementLengthSquared <= GEOMETRY_EPSILON) return null;
  const b = 2 * dot(relative, displacement);
  const discriminant = b * b - 4 * displacementLengthSquared * separation;
  if (discriminant < -GEOMETRY_EPSILON) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const time = (-b - root) / (2 * displacementLengthSquared);
  if (time < -GEOMETRY_EPSILON || time > 1 + GEOMETRY_EPSILON) return null;
  const impactPosition = add(start, scale(displacement, clamp(time, 0, 1)));
  const normal = safeCollisionNormal(sub(impactPosition, center), displacement);
  if (dot(displacement, normal) >= -GEOMETRY_EPSILON) return null;
  return { time: clamp(time, 0, 1), normal, feature };
}

export function sweepCircleVsCircle(
  start: Vec2,
  displacement: Vec2,
  moverRadius: number,
  collider: CircleCollider,
): SweepHit | null {
  const safeMoverRadius = Math.max(0, moverRadius);
  const expandedRadius = safeMoverRadius + Math.max(0, collider.radius);
  const relative = sub(start, collider.center);
  const centerDistance = length(relative);
  const penetration = Math.max(0, expandedRadius - centerDistance);
  const candidate = pointCircleCandidate(start, displacement, collider.center, expandedRadius, "circle");
  if (!candidate) return null;
  return makeSweepHit(
    collider,
    start,
    displacement,
    safeMoverRadius,
    candidate,
    penetration > GEOMETRY_EPSILON,
    penetration,
  );
}

function candidateRank(feature: SweepFeature): number {
  if (feature === "overlap") return 0;
  if (feature === "segment-side") return 1;
  if (feature === "segment-start") return 2;
  if (feature === "segment-end") return 3;
  return 4;
}

export function sweepCircleVsCapsule(
  start: Vec2,
  displacement: Vec2,
  moverRadius: number,
  collider: SegmentCollider,
): SweepHit | null {
  const safeMoverRadius = Math.max(0, moverRadius);
  const expandedRadius = safeMoverRadius + Math.max(0, collider.radius ?? 0);
  const edge = sub(collider.b, collider.a);
  const edgeLength = length(edge);

  if (edgeLength <= GEOMETRY_EPSILON) {
    const circleCollider: CircleCollider = {
      ...collider,
      type: "circle",
      center: collider.a,
      radius: Math.max(0, collider.radius ?? 0),
    };
    const hit = sweepCircleVsCircle(start, displacement, safeMoverRadius, circleCollider);
    return hit ? { ...hit, collider } : null;
  }

  const closest = closestPointOnSegment(start, collider.a, collider.b);
  const initialOffset = sub(start, closest);
  const initialDistance = length(initialOffset);
  const penetration = Math.max(0, expandedRadius - initialDistance);
  if (penetration > GEOMETRY_EPSILON) {
    const tangent = scale(edge, 1 / edgeLength);
    const normal = safeCollisionNormal(initialOffset, displacement, perpendicularLeft(tangent));
    return makeSweepHit(
      collider,
      start,
      displacement,
      safeMoverRadius,
      { time: 0, normal, feature: "overlap" },
      true,
      penetration,
    );
  }

  const tangent = scale(edge, 1 / edgeLength);
  const baseNormal = perpendicularLeft(tangent);
  const relative = sub(start, collider.a);
  const alongStart = dot(relative, tangent);
  const normalStart = dot(relative, baseNormal);
  const alongDelta = dot(displacement, tangent);
  const normalDelta = dot(displacement, baseNormal);
  const candidates: Candidate[] = [];

  if (Math.abs(normalDelta) > GEOMETRY_EPSILON) {
    for (const side of [-1, 1] as const) {
      const time = (side * expandedRadius - normalStart) / normalDelta;
      if (time < -GEOMETRY_EPSILON || time > 1 + GEOMETRY_EPSILON) continue;
      const clampedTime = clamp(time, 0, 1);
      const along = alongStart + alongDelta * clampedTime;
      if (along < -GEOMETRY_EPSILON || along > edgeLength + GEOMETRY_EPSILON) continue;
      const normal = scale(baseNormal, side);
      if (dot(displacement, normal) >= -GEOMETRY_EPSILON) continue;
      candidates.push({ time: clampedTime, normal, feature: "segment-side" });
    }
  }

  const startCap = pointCircleCandidate(
    start,
    displacement,
    collider.a,
    expandedRadius,
    "segment-start",
  );
  if (startCap) candidates.push(startCap);
  const endCap = pointCircleCandidate(
    start,
    displacement,
    collider.b,
    expandedRadius,
    "segment-end",
  );
  if (endCap) candidates.push(endCap);

  candidates.sort((left, right) => {
    const timeDelta = left.time - right.time;
    if (Math.abs(timeDelta) > GEOMETRY_EPSILON) return timeDelta;
    return candidateRank(left.feature) - candidateRank(right.feature);
  });
  const candidate = candidates[0];
  if (!candidate) return null;
  return makeSweepHit(collider, start, displacement, safeMoverRadius, candidate);
}

export function sweepCircleAgainstCollider(
  start: Vec2,
  displacement: Vec2,
  moverRadius: number,
  collider: Collider,
): SweepHit | null {
  if (collider.enabled === false) return null;
  return collider.type === "segment"
    ? sweepCircleVsCapsule(start, displacement, moverRadius, collider)
    : sweepCircleVsCircle(start, displacement, moverRadius, collider);
}

/**
 * Reflect a velocity using a contact normal and simple material coefficients.
 * Friction affects only the tangent, restitution only the incoming normal.
 */
export function reflectVelocity(
  velocity: Vec2,
  normal: Vec2,
  restitution = 1,
  friction = 0,
): Vec2 {
  const unitNormal = normalize(normal, { x: 1, y: 0 });
  const normalSpeed = dot(velocity, unitNormal);
  if (normalSpeed >= 0) return { ...velocity };
  const normalVelocity = scale(unitNormal, normalSpeed);
  const tangentVelocity = sub(velocity, normalVelocity);
  const retainedTangent = scale(tangentVelocity, 1 - clamp(friction, 0, 1));
  const reflectedNormal = scale(normalVelocity, -Math.max(0, restitution));
  return add(retainedTangent, reflectedNormal);
}

export function expandedColliderContainsPoint(collider: Collider, point: Vec2, moverRadius: number): boolean {
  const safeMoverRadius = Math.max(0, moverRadius);
  if (collider.type === "segment") {
    const expandedRadius = safeMoverRadius + Math.max(0, collider.radius ?? 0);
    return distanceToSegmentSquared(point, collider.a, collider.b) <= expandedRadius * expandedRadius + GEOMETRY_EPSILON;
  }
  const expandedRadius = safeMoverRadius + Math.max(0, collider.radius);
  return lengthSquared(sub(point, collider.center)) <= expandedRadius * expandedRadius + GEOMETRY_EPSILON;
}

