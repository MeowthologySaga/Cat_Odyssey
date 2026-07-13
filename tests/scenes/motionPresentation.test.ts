import { describe, expect, it } from "vitest";

import {
  hoverScaleTarget,
  summonAutoRefreshDelay,
  summonCardMotionPlan,
  summonFlashMotionPlan,
} from "../../src/scenes/motionPresentation";

describe("non-battle reduced-motion presentation", () => {
  it("skips summon flashes and shows every result card at final size", () => {
    expect(summonFlashMotionPlan(true)).toEqual({
      animate: false,
      initialAlpha: 0,
      initialScale: 8,
      targetAlpha: 0,
      targetScale: 8,
      duration: 0,
      yoyo: false,
    });
    expect(summonCardMotionPlan(true, 9)).toEqual({
      animate: false,
      initialScale: 1,
      duration: 0,
      delay: 0,
    });
  });

  it("keeps the authored reveal cadence when motion is enabled", () => {
    expect(summonFlashMotionPlan(false)).toMatchObject({
      animate: true,
      targetAlpha: 0.8,
      targetScale: 11,
      duration: 360,
      yoyo: true,
    });
    expect(summonCardMotionPlan(false, 2)).toEqual({
      animate: true,
      initialScale: 0,
      duration: 370,
      delay: 330,
    });
  });

  it("removes hover movement without changing normal hover emphasis", () => {
    expect(hoverScaleTarget(true, true)).toBe(1);
    expect(hoverScaleTarget(true, false)).toBe(1);
    expect(hoverScaleTarget(false, true, 1.035)).toBe(1.035);
    expect(hoverScaleTarget(false, false, 1.035)).toBe(1);
  });

  it("refreshes saved summon state immediately without a reduced-mode wait", () => {
    expect(summonAutoRefreshDelay(true, 1_700)).toBe(0);
    expect(summonAutoRefreshDelay(false, 1_700)).toBe(1_700);
    expect(summonAutoRefreshDelay(false, -1)).toBe(0);
  });
});
