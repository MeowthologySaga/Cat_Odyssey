import { describe, expect, it } from "vitest";
import {
  formatRewardMilestoneBanner,
  rewardMilestoneRevealPlan,
  rewardStarRevealPlan,
} from "../../src/scenes/rewardPresentation";

describe("reward presentation accessibility", () => {
  it("shows stars immediately without tweening in reduced-motion mode", () => {
    expect(rewardStarRevealPlan(true, 2)).toEqual({
      animate: false,
      initialScale: 1,
      targetAngle: 0,
      duration: 0,
      delay: 0,
    });
  });

  it("keeps the staggered reveal when full motion is enabled", () => {
    expect(rewardStarRevealPlan(false, 0)).toMatchObject({ animate: true, initialScale: 0, delay: 180 });
    expect(rewardStarRevealPlan(false, 2)).toMatchObject({ animate: true, targetAngle: -8, duration: 360, delay: 540 });
  });

  it("reveals campaign milestones immediately when reduced motion is enabled", () => {
    expect(rewardMilestoneRevealPlan(true)).toEqual({
      animate: false,
      initialAlpha: 1,
      duration: 0,
      delay: 0,
    });
    expect(rewardMilestoneRevealPlan(false)).toMatchObject({
      animate: true,
      initialAlpha: 0,
      duration: 320,
    });
  });

  it("formats a compact cumulative milestone banner", () => {
    expect(formatRewardMilestoneBanner([
      {
        milestoneId: "campaign-stars-030",
        requiredStars: 30,
        totalStars: 61,
        titleId: "title:star-voyager",
        rewards: { gold: 1_500, relicDust: 50 },
      },
      {
        milestoneId: "campaign-stars-060",
        requiredStars: 60,
        totalStars: 61,
        titleId: "title:wave-reader",
        rewards: { gold: 3_000, awakeningMaterials: 1, fateDust: 10 },
      },
    ])).toEqual({
      headline: "별 항해 60★ 달성 · 마일스톤 2개 연속 해금",
      detail: "칭호 ‘파도를 읽는 선장’ · 골드 +4,500 · 각성석 +1 · 외 2종",
    });
    expect(formatRewardMilestoneBanner(undefined)).toBeUndefined();
  });
});
