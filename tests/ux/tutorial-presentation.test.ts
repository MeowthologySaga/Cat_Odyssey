import { describe, expect, it } from "vitest";

import { TUTORIAL_PREP_LAYOUT, type TutorialLayoutRect } from "../../src/scenes/tutorialPresentation";

function bottom(rect: TutorialLayoutRect): number {
  return rect.y + rect.height;
}

describe("tutorial preparation layout", () => {
  it("keeps every persistent region inside the 720x1280 logical canvas", () => {
    expect(TUTORIAL_PREP_LAYOUT.logicalWidth).toBe(720);
    expect(TUTORIAL_PREP_LAYOUT.logicalHeight).toBe(1280);
    for (const rect of [
      TUTORIAL_PREP_LAYOUT.progress,
      TUTORIAL_PREP_LAYOUT.demoPanel,
      TUTORIAL_PREP_LAYOUT.copyPanel,
      TUTORIAL_PREP_LAYOUT.primaryButton,
      TUTORIAL_PREP_LAYOUT.skipButton,
    ]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(TUTORIAL_PREP_LAYOUT.logicalWidth);
      expect(bottom(rect)).toBeLessThanOrEqual(TUTORIAL_PREP_LAYOUT.logicalHeight);
    }
  });

  it("keeps copy and actions vertically separated within the safe footer", () => {
    expect(TUTORIAL_PREP_LAYOUT.primaryButton.y).toBeGreaterThan(bottom(TUTORIAL_PREP_LAYOUT.copyPanel));
    expect(TUTORIAL_PREP_LAYOUT.skipButton.y).toBeGreaterThan(bottom(TUTORIAL_PREP_LAYOUT.primaryButton));
    expect(bottom(TUTORIAL_PREP_LAYOUT.skipButton)).toBeLessThanOrEqual(TUTORIAL_PREP_LAYOUT.safeBottom);
  });
});
