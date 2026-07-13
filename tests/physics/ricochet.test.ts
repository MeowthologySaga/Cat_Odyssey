import { describe, expect, it } from "vitest";
import {
  createSeededRandom,
  previewRicochet,
  reflectVelocity,
  simulateRicochet,
  sweepCircleVsCapsule,
  sweepCircleVsCircle,
  traceRicochet,
  vec2,
  type Collider,
  type RicochetTraceInput,
} from "../../src/simulation";

describe("swept collision geometry", () => {
  it("preserves the reflection angle on an elastic wall", () => {
    const wall = {
      id: "right-wall",
      type: "segment",
      a: vec2(10, -100),
      b: vec2(10, 100),
    } as const;
    const result = traceRicochet({
      position: vec2(0, 0),
      velocity: vec2(10, 4),
      duration: 1,
      moverRadius: 1,
      colliders: [wall],
    });

    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]!.position.x).toBeCloseTo(9, 8);
    expect(result.collisions[0]!.outgoingVelocity.x).toBeCloseTo(-10, 8);
    expect(result.collisions[0]!.outgoingVelocity.y).toBeCloseTo(4, 8);
    expect(Math.abs(result.collisions[0]!.incomingVelocity.x)).toBeCloseTo(
      Math.abs(result.collisions[0]!.outgoingVelocity.x),
      8,
    );
  });

  it("applies restitution to the normal and friction to the tangent", () => {
    const reflected = reflectVelocity(vec2(10, 5), vec2(-1, 0), 0.5, 0.2);
    expect(reflected.x).toBeCloseTo(-5, 8);
    expect(reflected.y).toBeCloseTo(4, 8);
  });

  it("prevents a high-speed mover from tunneling through a thin segment", () => {
    const wall = {
      id: "thin-wall",
      type: "segment",
      a: vec2(100, -20),
      b: vec2(100, 20),
    } as const;
    const hit = sweepCircleVsCapsule(vec2(0, 0), vec2(1_000, 0), 2, wall);
    expect(hit).not.toBeNull();
    expect(hit!.time).toBeCloseTo(0.098, 8);
    expect(hit!.position.x).toBeCloseTo(98, 8);
  });

  it("finds the exact swept time against a circle/weakpoint", () => {
    const weakpoint = {
      id: "cyclops-eye",
      type: "weakpoint",
      center: vec2(10, 0),
      radius: 2,
    } as const;
    const hit = sweepCircleVsCircle(vec2(0, 0), vec2(20, 0), 1, weakpoint);
    expect(hit).not.toBeNull();
    expect(hit!.time).toBeCloseTo(0.35, 8);
    expect(hit!.position.x).toBeCloseTo(7, 8);
    expect(hit!.normal).toEqual(vec2(-1, 0));
  });
});

describe("continuous ricochet trace", () => {
  it("combines simultaneous corner normals into one deterministic bounce", () => {
    const colliders: Collider[] = [
      { id: "corner-horizontal", type: "segment", a: vec2(0, 10), b: vec2(20, 10) },
      { id: "corner-vertical", type: "segment", a: vec2(10, 0), b: vec2(10, 20) },
    ];
    const result = traceRicochet({
      position: vec2(0, 0),
      velocity: vec2(10, 10),
      duration: 1,
      moverRadius: 1,
      colliders,
    });

    expect(result.bounceCount).toBe(1);
    expect(result.collisions).toHaveLength(2);
    expect(result.collisions.every((collision) => collision.simultaneous)).toBe(true);
    expect(result.collisions[0]!.position.x).toBeCloseTo(9, 7);
    expect(result.collisions[0]!.position.y).toBeCloseTo(9, 7);
    expect(result.finalVelocity.x).toBeCloseTo(-10, 7);
    expect(result.finalVelocity.y).toBeCloseTo(-10, 7);
  });

  it("uses exactly the same function for preview and actual resolution", () => {
    const input: RicochetTraceInput = {
      position: vec2(3, 4),
      velocity: vec2(22, -7),
      duration: 2.4,
      moverRadius: 0.75,
      colliders: [
        { id: "ceiling", type: "segment", a: vec2(-20, 0), b: vec2(30, 0), restitution: 0.92 },
        { id: "right", type: "segment", a: vec2(24, -10), b: vec2(24, 20), friction: 0.05 },
        { id: "weakpoint", type: "weakpoint", center: vec2(14, 8), radius: 1.5, response: "passThrough" },
      ],
    };

    expect(previewRicochet).toBe(traceRicochet);
    expect(simulateRicochet).toBe(traceRicochet);
    expect(previewRicochet(input)).toEqual(simulateRicochet(input));
  });

  it("terminates exactly at the configured maximum reflection count", () => {
    const result = traceRicochet({
      position: vec2(5, 0),
      velocity: vec2(10, 0),
      duration: 10,
      moverRadius: 1,
      maxBounces: 3,
      colliders: [
        { id: "left", type: "segment", a: vec2(0, -10), b: vec2(0, 10) },
        { id: "right", type: "segment", a: vec2(10, -10), b: vec2(10, 10) },
      ],
    });

    expect(result.termination).toBe("maxBounces");
    expect(result.bounceCount).toBe(3);
    expect(result.collisions).toHaveLength(3);
    expect(result.remainingTime).toBeGreaterThan(0);
  });

  it("suppresses damage during hit cooldown without disabling physical travel", () => {
    const result = traceRicochet({
      position: vec2(0, 0),
      velocity: vec2(10, 0),
      duration: 2,
      moverRadius: 0.5,
      colliders: [
        {
          id: "enemy",
          type: "circle",
          center: vec2(5, 0),
          radius: 1,
          response: "passThrough",
          hitCooldown: 10,
        },
        { id: "wall", type: "segment", a: vec2(10, -10), b: vec2(10, 10) },
      ],
    });
    const enemyHits = result.collisions.filter((collision) => collision.collider.id === "enemy");
    expect(enemyHits).toHaveLength(2);
    expect(enemyHits.map((hit) => hit.hitAccepted)).toEqual([true, false]);
    expect(result.bounceCount).toBe(1);
  });

  it("is deterministic even when collider input order differs", () => {
    const walls: Collider[] = [
      { id: "b-wall", type: "segment", a: vec2(10, 0), b: vec2(10, 20) },
      { id: "a-wall", type: "segment", a: vec2(0, 10), b: vec2(20, 10) },
    ];
    const makeInput = (colliders: readonly Collider[]): RicochetTraceInput => ({
      position: vec2(0, 0),
      velocity: vec2(10, 10),
      duration: 1,
      moverRadius: 1,
      colliders,
    });
    const forward = traceRicochet(makeInput(walls));
    const reverse = traceRicochet(makeInput([...walls].reverse()));
    expect(forward.finalPosition).toEqual(reverse.finalPosition);
    expect(forward.finalVelocity).toEqual(reverse.finalVelocity);
    expect(forward.collisions.map((hit) => hit.collider.id)).toEqual(["a-wall", "b-wall"]);
    expect(reverse.collisions.map((hit) => hit.collider.id)).toEqual(["a-wall", "b-wall"]);
  });
});

describe("seeded random helper", () => {
  it("replays an identical sequence from the same string seed", () => {
    const left = createSeededRandom("route-08-scylla");
    const right = createSeededRandom("route-08-scylla");
    expect(Array.from({ length: 8 }, () => left.next())).toEqual(
      Array.from({ length: 8 }, () => right.next()),
    );
  });
});
