import { describe, expect, it } from "vitest";

import {
  formatFirstClearPreview,
  formatMaterialRewards,
  getStageRewardPreview,
} from "../../src/core/meta";
import { HERO_BY_ID } from "../../src/data";
import { createDefaultSave } from "../../src/state";

describe("stage reward preview", () => {
  it("separates repeatable and unclaimed first-clear rewards", () => {
    const preview = getStageRewardPreview(createDefaultSave(), "r01-s01");
    expect(preview).toMatchObject({
      repeatable: { gold: 80, heroXp: 28, materials: { "ogygian-timber": 3 } },
      firstClear: { claimed: false, kind: "material", id: "voyage-knot", name: "항해 매듭" },
    });
    expect(formatFirstClearPreview(preview!)).toContain("첫 돌파");
    expect(formatMaterialRewards(preview!.repeatable.materials)).toBe("오기기아 목재 ×3");
    expect(formatFirstClearPreview(preview!)).toContain("항해 매듭");
    expect(formatFirstClearPreview(preview!)).not.toContain("voyage-knot");
  });

  it("marks a claimed first-clear reward without hiding repeatable loot", () => {
    const save = createDefaultSave();
    save.progress.completedStageIds.push("r01-s01");
    save.progress.claimedFirstClearStageIds.push("r01-s01");
    const preview = getStageRewardPreview(save, "r01-s01")!;
    expect(preview.firstClear.claimed).toBe(true);
    expect(formatFirstClearPreview(preview)).toBe("첫 돌파 보상 수령 완료");
    expect(preview.repeatable.gold).toBe(80);
  });

  it("does not confuse hero fragments with the separate story recruitment", () => {
    const fragmentPreview = getStageRewardPreview(createDefaultSave(), "r02-s02")!;
    const fragmentText = formatFirstClearPreview(fragmentPreview);
    const sailorName = HERO_BY_ID["orange-sailor"]!.name;
    expect(fragmentPreview.firstClear.kind).toBe("fragment");
    expect(fragmentPreview.storyHeroIds).toContain("orange-sailor");
    expect(fragmentText.split(sailorName)).toHaveLength(3);

    const heroPreview = getStageRewardPreview(createDefaultSave(), "r06-s03")!;
    const heroName = HERO_BY_ID["anticleia-ghost"]!.name;
    expect(heroPreview.firstClear.kind).toBe("hero");
    expect(formatFirstClearPreview(heroPreview).split(heroName)).toHaveLength(2);
  });
});
