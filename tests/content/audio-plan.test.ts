import { describe, expect, it } from "vitest";
import {
  BGM_CROSSFADE_MS,
  BOSS_ENTRY_DELAY_MS,
  BOSS_EXIT_GRACE_MS,
  equalPowerCrossfade,
  mixedGain,
  planBgmTransition,
  planSfxPlayback,
} from "../../src/audio/audioPlan";

describe("commercial audio transition plan", () => {
  it("preserves an identical loop without delay or restart", () => {
    expect(planBgmTransition({
      currentKey: "zone-a",
      requestedKey: "zone-a",
      currentRole: "ambient",
      requestedRole: "battle",
      hasCurrentVoice: true,
    })).toEqual({ action: "keep", delayMs: 0, fadeMs: 0 });
  });

  it("crossfades distinct tracks inside the 1.8-2.5 second target", () => {
    const plan = planBgmTransition({
      currentKey: "zone-a",
      requestedKey: "zone-b",
      currentRole: "battle",
      requestedRole: "battle",
      hasCurrentVoice: true,
    });
    expect(plan.action).toBe("switch");
    expect(plan.fadeMs).toBe(BGM_CROSSFADE_MS);
    expect(plan.fadeMs).toBeGreaterThanOrEqual(1_800);
    expect(plan.fadeMs).toBeLessThanOrEqual(2_500);
  });

  it("delays boss entry and grants boss exit grace", () => {
    expect(planBgmTransition({
      currentKey: "zone",
      requestedKey: "boss",
      currentRole: "battle",
      requestedRole: "boss",
      hasCurrentVoice: true,
    }).delayMs).toBe(BOSS_ENTRY_DELAY_MS);
    expect(planBgmTransition({
      currentKey: "boss",
      requestedKey: "reward",
      currentRole: "boss",
      requestedRole: "ambient",
      hasCurrentVoice: true,
    }).delayMs).toBe(BOSS_EXIT_GRACE_MS);
  });

  it("uses the exact master x bus x cue mix and equal-power midpoint", () => {
    expect(mixedGain(0.8, 0.5, 0.6)).toBeCloseTo(0.24, 8);
    expect(mixedGain(Number.NaN, 1, 1)).toBe(0);
    const midpoint = equalPowerCrossfade(0.5, 0.6, 0.4);
    expect(midpoint.outgoing).toBeCloseTo(0.6 * Math.SQRT1_2, 8);
    expect(midpoint.incoming).toBeCloseTo(0.4 * Math.SQRT1_2, 8);
  });
});

describe("SFX pool plan", () => {
  it("throttles frequent ricochets by key", () => {
    expect(planSfxPlayback({
      key: "ricochet",
      now: 120,
      lastPlayedAt: 100,
      minGapMs: 38,
      maxVoicesForKey: 5,
      priority: 0,
      bypassThrottle: false,
      activeVoices: [],
    })).toEqual({ allowed: false, reason: "cooldown" });
  });

  it("lets a critical cue replace the oldest same-key voice", () => {
    expect(planSfxPlayback({
      key: "critical",
      now: 110,
      lastPlayedAt: 100,
      minGapMs: 90,
      maxVoicesForKey: 1,
      priority: 2,
      bypassThrottle: true,
      activeVoices: [
        { key: "critical", priority: 2, startedAt: 50 },
        { key: "ricochet", priority: 0, startedAt: 80 },
      ],
    })).toEqual({ allowed: true, evictIndex: 0 });
  });

  it("does not discard a victory cue when the shared pool is full", () => {
    const activeVoices = Array.from({ length: 16 }, (_, index) => ({
      key: `frequent-${index}`,
      priority: 0,
      startedAt: index,
    }));
    const decision = planSfxPlayback({
      key: "victory",
      now: 1_000,
      minGapMs: 1_000,
      maxVoicesForKey: 1,
      priority: 3,
      bypassThrottle: true,
      activeVoices,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.evictIndex).toBe(0);
  });
});
