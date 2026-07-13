import { describe, expect, it } from "vitest";
import {
  accessibilityPaletteFor,
  nextFocusableIndex,
  resolveFocusableKey,
  scaleTextSize,
} from "../../src/ui/accessibility";
import {
  colorVisionLabel,
  nextColorVisionMode,
  SETTINGS_LAYOUT,
  textScaleLabel,
} from "../../src/scenes/settingsPresentation";

describe("accessibility presentation", () => {
  it("scales supported text sizes without fractional drift", () => {
    expect(scaleTextSize(20, 100)).toBe(20);
    expect(scaleTextSize(20, 115)).toBe(23);
    expect(scaleTextSize(13, 115)).toBe(15);
    expect(textScaleLabel(100)).toBe("보통 100%");
    expect(textScaleLabel(115)).toBe("크게 115%");
  });

  it("keeps semantic colors distinct in every supported mode", () => {
    for (const colorVision of ["off", "deuteranopia", "tritanopia"] as const) {
      const palette = accessibilityPaletteFor({ highContrast: false, colorVision });
      expect(new Set([palette.ally, palette.enemy, palette.objective, palette.danger]).size).toBe(4);
      expect(palette.trajectory).not.toBe(palette.enemy);
    }
    const highContrast = accessibilityPaletteFor({ highContrast: true, colorVision: "off" });
    expect(highContrast.outline).toBe(0xffffff);
    expect(highContrast.focus).toBe(0xffffff);
  });

  it("cycles color-vision modes predictably", () => {
    expect(nextColorVisionMode("off")).toBe("deuteranopia");
    expect(nextColorVisionMode("deuteranopia")).toBe("tritanopia");
    expect(nextColorVisionMode("tritanopia")).toBe("off");
    expect(colorVisionLabel("off")).toBe("기본 색상");
  });

  it("wraps focus in both directions and skips an empty list", () => {
    expect(nextFocusableIndex(-1, 1, 4)).toBe(0);
    expect(nextFocusableIndex(3, 1, 4)).toBe(0);
    expect(nextFocusableIndex(0, -1, 4)).toBe(3);
    expect(nextFocusableIndex(0, 1, 0)).toBe(-1);
  });

  it("preserves stable focus through redraws and skips disabled or removed entries", () => {
    const redrawKeys = ["route-previous", "route-stage-r01-s02", "route-next"];
    expect(resolveFocusableKey("route-stage-r01-s02", redrawKeys, ["route-stage-r01-s01"]))
      .toBe("route-stage-r01-s02");
    expect(resolveFocusableKey("route-stage-r01-s01", redrawKeys, ["route-stage-r01-s02", "route-next"]))
      .toBe("route-stage-r01-s02");
    expect(resolveFocusableKey("locked-stage", ["route-next"], ["locked-stage"]))
      .toBe("route-next");
    expect(resolveFocusableKey("anything", [], ["route-next"]))
      .toBeUndefined();
  });

  it("keeps both settings pages and persistent actions inside 720x1280", () => {
    expect(SETTINGS_LAYOUT.topBarBottom).toBeLessThan(SETTINGS_LAYOUT.headingY);
    expect(SETTINGS_LAYOUT.tabsY + SETTINGS_LAYOUT.tabHeight / 2).toBeLessThan(SETTINGS_LAYOUT.panelTop);
    expect(SETTINGS_LAYOUT.panelBottom).toBeLessThan(SETTINGS_LAYOUT.resetY - 23);
    expect(SETTINGS_LAYOUT.resetY + 40).toBeLessThan(SETTINGS_LAYOUT.doneY - 30);
    expect(SETTINGS_LAYOUT.doneY + 30).toBeLessThan(SETTINGS_LAYOUT.viewportBottom);
  });

});
