import {
  expandedColliderContainsPoint,
  reflectVelocity,
  sweepCircleAgainstCollider,
  type Collider,
  type CollisionResponse,
  type SweepHit,
} from "./collision";
import {
  add,
  clamp,
  dot,
  isFiniteVec,
  length,
  lengthSquared,
  normalize,
  scale,
  type Vec2,
  vecAlmostEqual,
} from "./vec2";

const DEFAULT_MAX_BOUNCES = 24;
const DEFAULT_MAX_COLLISIONS = 64;
const DEFAULT_SEPARATION_EPSILON = 1e-4;
const DEFAULT_TOI_EPSILON = 1e-7;
const DEFAULT_MIN_SPEED = 1e-5;

export type TraceTermination =
  | "duration"
  | "maxBounces"
  | "maxCollisions"
  | "stopped"
  | "minSpeed"
  | "invalidInput";

export interface RicochetTraceInput {
  readonly position: Vec2;
  /** World units per second. */
  readonly velocity: Vec2;
  /** Seconds to simulate. */
  readonly duration: number;
  readonly moverRadius: number;
  readonly colliders: readonly Collider[];
  readonly maxBounces?: number;
  readonly maxCollisions?: number;
  readonly minSpeed?: number;
  readonly defaultRestitution?: number;
  readonly defaultFriction?: number;
  readonly separationEpsilon?: number;
  readonly toiEpsilon?: number;
  /** Absolute simulation time, useful when hit cooldown state spans traces. */
  readonly startTime?: number;
  /** Last accepted absolute hit time by collider id. */
  readonly lastHitTimes?: Readonly<Record<string, number>>;
}

export interface TraceSegment {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly velocity: Vec2;
  readonly duration: number;
  readonly collisionIds: readonly string[];
}

export interface TraceCollision {
  readonly collider: Collider;
  readonly position: Vec2;
  readonly contactPoint: Vec2;
  readonly normal: Vec2;
  readonly feature: SweepHit["feature"];
  readonly elapsedTime: number;
  readonly absoluteTime: number;
  readonly incomingVelocity: Vec2;
  readonly outgoingVelocity: Vec2;
  readonly response: CollisionResponse;
  readonly hitAccepted: boolean;
  readonly simultaneous: boolean;
  readonly startedOverlapping: boolean;
  readonly bounceIndex: number;
}

export interface RicochetTraceResult {
  readonly points: readonly Vec2[];
  readonly segments: readonly TraceSegment[];
  readonly collisions: readonly TraceCollision[];
  readonly finalPosition: Vec2;
  readonly finalVelocity: Vec2;
  readonly elapsedTime: number;
  readonly remainingTime: number;
  readonly distanceTraveled: number;
  readonly bounceCount: number;
  readonly termination: TraceTermination;
  /** Updated absolute hit timestamps; pass this into a later trace if needed. */
  readonly lastHitTimes: Readonly<Record<string, number>>;
}

interface EarliestHitGroup {
  readonly time: number;
  readonly hits: readonly SweepHit[];
}

function responseFor(collider: Collider): CollisionResponse {
  return collider.response ?? "bounce";
}

function colliderRestitution(collider: Collider, fallback: number): number {
  return Math.max(0, collider.restitution ?? fallback);
}

function colliderFriction(collider: Collider, fallback: number): number {
  return clamp(collider.friction ?? fallback, 0, 1);
}

function findEarliestHits(
  position: Vec2,
  displacement: Vec2,
  moverRadius: number,
  colliders: readonly Collider[],
  suppressedPassThroughIds: ReadonlySet<string>,
  toiEpsilon: number,
): EarliestHitGroup | null {
  let earliest = Number.POSITIVE_INFINITY;
  const hits: SweepHit[] = [];

  for (const collider of colliders) {
    if (collider.enabled === false || suppressedPassThroughIds.has(collider.id)) continue;
    const hit = sweepCircleAgainstCollider(position, displacement, moverRadius, collider);
    if (!hit) continue;
    if (hit.time < earliest - toiEpsilon) {
      earliest = hit.time;
      hits.length = 0;
      hits.push(hit);
    } else if (Math.abs(hit.time - earliest) <= toiEpsilon) {
      earliest = Math.min(earliest, hit.time);
      hits.push(hit);
    }
  }

  if (!Number.isFinite(earliest)) return null;
  hits.sort((left, right) => {
    if (left.collider.id < right.collider.id) return -1;
    if (left.collider.id > right.collider.id) return 1;
    return 0;
  });
  return { time: clamp(earliest, 0, 1), hits };
}

function combinedBlockingNormal(hits: readonly SweepHit[], velocity: Vec2): Vec2 {
  const blocking = hits.filter(
    (hit) => responseFor(hit.collider) === "bounce" && (hit.startedOverlapping || dot(velocity, hit.normal) < 0),
  );
  if (blocking.length === 0) return { x: 0, y: 0 };

  const sum = blocking.reduce(
    (value, hit) => add(value, hit.normal),
    { x: 0, y: 0 } as Vec2,
  );
  if (lengthSquared(sum) > 1e-12) return normalize(sum);
  return { ...blocking[0]!.normal };
}

function pushUniquePoint(points: Vec2[], point: Vec2, epsilon: number): void {
  const last = points[points.length - 1];
  if (!last || !vecAlmostEqual(last, point, epsilon)) points.push({ ...point });
}

function materialForHits(
  hits: readonly SweepHit[],
  defaultRestitution: number,
  defaultFriction: number,
): { restitution: number; friction: number } {
  const bouncing = hits.filter((hit) => responseFor(hit.collider) === "bounce");
  if (bouncing.length === 0) {
    return { restitution: defaultRestitution, friction: defaultFriction };
  }
  const restitution = bouncing.reduce(
    (sum, hit) => sum + colliderRestitution(hit.collider, defaultRestitution),
    0,
  ) / bouncing.length;
  const friction = bouncing.reduce(
    (sum, hit) => sum + colliderFriction(hit.collider, defaultFriction),
    0,
  ) / bouncing.length;
  return { restitution, friction };
}

function prunePassThroughSuppression(
  suppressed: Set<string>,
  colliderById: ReadonlyMap<string, Collider>,
  position: Vec2,
  moverRadius: number,
): void {
  for (const id of suppressed) {
    const collider = colliderById.get(id);
    if (!collider || !expandedColliderContainsPoint(collider, position, moverRadius)) suppressed.delete(id);
  }
}

function invalidResult(input: RicochetTraceInput): RicochetTraceResult {
  return {
    points: [{ ...input.position }],
    segments: [],
    collisions: [],
    finalPosition: { ...input.position },
    finalVelocity: { ...input.velocity },
    elapsedTime: 0,
    remainingTime: Math.max(0, Number.isFinite(input.duration) ? input.duration : 0),
    distanceTraveled: 0,
    bounceCount: 0,
    termination: "invalidInput",
    lastHitTimes: { ...(input.lastHitTimes ?? {}) },
  };
}

/**
 * Deterministic continuous collision trace used for both aim preview and play.
 * It never samples Math.random and resolves ties by collider id.
 */
export function traceRicochet(input: RicochetTraceInput): RicochetTraceResult {
  if (
    !isFiniteVec(input.position)
    || !isFiniteVec(input.velocity)
    || !Number.isFinite(input.duration)
    || input.duration < 0
    || !Number.isFinite(input.moverRadius)
    || input.moverRadius < 0
  ) {
    return invalidResult(input);
  }

  const maxBounces = Math.max(0, Math.floor(input.maxBounces ?? DEFAULT_MAX_BOUNCES));
  const maxCollisions = Math.max(1, Math.floor(input.maxCollisions ?? DEFAULT_MAX_COLLISIONS));
  const minSpeed = Math.max(0, input.minSpeed ?? DEFAULT_MIN_SPEED);
  const separationEpsilon = Math.max(1e-9, input.separationEpsilon ?? DEFAULT_SEPARATION_EPSILON);
  const toiEpsilon = Math.max(1e-10, input.toiEpsilon ?? DEFAULT_TOI_EPSILON);
  const defaultRestitution = Math.max(0, input.defaultRestitution ?? 1);
  const defaultFriction = clamp(input.defaultFriction ?? 0, 0, 1);
  const startTime = Number.isFinite(input.startTime) ? input.startTime! : 0;
  const colliderById = new Map(input.colliders.map((collider) => [collider.id, collider] as const));
  const lastHitTimes: Record<string, number> = { ...(input.lastHitTimes ?? {}) };
  const suppressedPassThroughIds = new Set<string>();
  const points: Vec2[] = [{ ...input.position }];
  const segments: TraceSegment[] = [];
  const collisions: TraceCollision[] = [];

  let position = { ...input.position };
  let velocity = { ...input.velocity };
  let remainingTime = input.duration;
  let elapsedTime = 0;
  let distanceTraveled = 0;
  let bounceCount = 0;
  let collisionCount = 0;
  let termination: TraceTermination = "duration";

  if (length(velocity) < minSpeed || remainingTime <= toiEpsilon) {
    termination = length(velocity) < minSpeed ? "minSpeed" : "duration";
  } else {
    while (remainingTime > toiEpsilon) {
      if (length(velocity) < minSpeed) {
        termination = "minSpeed";
        break;
      }
      if (collisionCount >= maxCollisions) {
        termination = "maxCollisions";
        break;
      }

      prunePassThroughSuppression(suppressedPassThroughIds, colliderById, position, input.moverRadius);
      const displacement = scale(velocity, remainingTime);
      const earliest = findEarliestHits(
        position,
        displacement,
        input.moverRadius,
        input.colliders,
        suppressedPassThroughIds,
        toiEpsilon,
      );

      if (!earliest) {
        const destination = add(position, displacement);
        segments.push({
          from: { ...position },
          to: destination,
          velocity: { ...velocity },
          duration: remainingTime,
          collisionIds: [],
        });
        distanceTraveled += length(displacement);
        elapsedTime += remainingTime;
        remainingTime = 0;
        position = destination;
        pushUniquePoint(points, position, separationEpsilon * 0.25);
        termination = "duration";
        break;
      }

      const segmentDuration = remainingTime * earliest.time;
      const impactPosition = add(position, scale(displacement, earliest.time));
      segments.push({
        from: { ...position },
        to: impactPosition,
        velocity: { ...velocity },
        duration: segmentDuration,
        collisionIds: earliest.hits.map((hit) => hit.collider.id),
      });
      distanceTraveled += length(scale(displacement, earliest.time));
      elapsedTime += segmentDuration;
      remainingTime = Math.max(0, remainingTime - segmentDuration);
      position = impactPosition;
      pushUniquePoint(points, position, separationEpsilon * 0.25);

      const incomingVelocity = { ...velocity };
      const hasStop = earliest.hits.some((hit) => responseFor(hit.collider) === "stop");
      const blockingNormal = combinedBlockingNormal(earliest.hits, velocity);
      const hasBounce = lengthSquared(blockingNormal) > 1e-12;
      const material = materialForHits(earliest.hits, defaultRestitution, defaultFriction);

      let outgoingVelocity = incomingVelocity;
      if (hasStop) outgoingVelocity = { x: 0, y: 0 };
      else if (hasBounce) {
        outgoingVelocity = reflectVelocity(
          incomingVelocity,
          blockingNormal,
          material.restitution,
          material.friction,
        );
      }

      const absoluteTime = startTime + elapsedTime;
      const nextBounceIndex = bounceCount + (hasBounce ? 1 : 0);
      for (const hit of earliest.hits) {
        const cooldown = Math.max(0, hit.collider.hitCooldown ?? 0);
        const previous = lastHitTimes[hit.collider.id];
        const hitAccepted = previous === undefined || absoluteTime - previous >= cooldown - toiEpsilon;
        if (hitAccepted) lastHitTimes[hit.collider.id] = absoluteTime;
        if (responseFor(hit.collider) === "passThrough") suppressedPassThroughIds.add(hit.collider.id);
        collisions.push({
          collider: hit.collider,
          position: { ...position },
          contactPoint: { ...hit.contactPoint },
          normal: { ...hit.normal },
          feature: hit.feature,
          elapsedTime,
          absoluteTime,
          incomingVelocity: { ...incomingVelocity },
          outgoingVelocity: { ...outgoingVelocity },
          response: responseFor(hit.collider),
          hitAccepted,
          simultaneous: earliest.hits.length > 1,
          startedOverlapping: hit.startedOverlapping,
          bounceIndex: nextBounceIndex,
        });
      }
      collisionCount += earliest.hits.length;

      if (hasStop) {
        velocity = outgoingVelocity;
        termination = "stopped";
        break;
      }

      if (hasBounce) {
        bounceCount += 1;
        velocity = outgoingVelocity;
        const maxPenetration = earliest.hits
          .filter((hit) => responseFor(hit.collider) === "bounce")
          .reduce((maximum, hit) => Math.max(maximum, hit.penetration), 0);
        position = add(position, scale(blockingNormal, maxPenetration + separationEpsilon));
        if (bounceCount >= maxBounces) {
          termination = "maxBounces";
          break;
        }
      } else {
        velocity = outgoingVelocity;
        const forward = normalize(velocity);
        position = add(position, scale(forward, separationEpsilon));
      }

      if (collisionCount >= maxCollisions) {
        termination = "maxCollisions";
        break;
      }
    }
  }

  pushUniquePoint(points, position, separationEpsilon * 0.25);
  return {
    points,
    segments,
    collisions,
    finalPosition: { ...position },
    finalVelocity: { ...velocity },
    elapsedTime,
    remainingTime,
    distanceTraveled,
    bounceCount,
    termination,
    lastHitTimes,
  };
}

/** Deliberate alias: preview and authoritative play cannot drift into separate math. */
export const previewRicochet: typeof traceRicochet = traceRicochet;

/** Semantic alias for gameplay code that wants an authoritative-sounding name. */
export const simulateRicochet: typeof traceRicochet = traceRicochet;
