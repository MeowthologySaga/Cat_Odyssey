import type { ColorVisionMode, TextScale } from "../state/saveSchema";

export interface AccessibilityPalette {
  readonly ally: number;
  readonly enemy: number;
  readonly objective: number;
  readonly danger: number;
  readonly trajectory: number;
  readonly focus: number;
  readonly outline: number;
}

export interface AccessibilityPaletteInput {
  readonly highContrast: boolean;
  readonly colorVision: ColorVisionMode;
}

export function scaleTextSize(baseSize: number, scale: TextScale): number {
  const safeBase = Number.isFinite(baseSize) ? Math.max(1, baseSize) : 1;
  return Math.round(safeBase * scale / 100 * 10) / 10;
}

export function accessibilityPaletteFor(input: AccessibilityPaletteInput): AccessibilityPalette {
  const outline = input.highContrast ? 0xffffff : 0x071014;
  if (input.colorVision === "deuteranopia") {
    return {
      ally: 0x49a7ff,
      enemy: 0xff9f1c,
      objective: 0xd9b8ff,
      danger: 0xff7a1a,
      trajectory: 0x7ed6ff,
      focus: 0xffee70,
      outline,
    };
  }
  if (input.colorVision === "tritanopia") {
    return {
      ally: 0x00d4c8,
      enemy: 0xff5aa7,
      objective: 0xffdf52,
      danger: 0xff4f9a,
      trajectory: 0x6fffe9,
      focus: 0xffffff,
      outline,
    };
  }
  return {
    ally: input.highContrast ? 0x78f7e8 : 0x73d7cf,
    enemy: input.highContrast ? 0xff765f : 0xbb4b42,
    objective: input.highContrast ? 0xffdc69 : 0xd8a94a,
    danger: input.highContrast ? 0xff665c : 0xff715d,
    trajectory: input.highContrast ? 0xc9fff6 : 0x8de1d8,
    focus: input.highContrast ? 0xffffff : 0xffdf72,
    outline,
  };
}

export function nextFocusableIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  const safeCurrent = current >= 0 && current < count ? current : delta < 0 ? 0 : -1;
  return ((safeCurrent + delta) % count + count) % count;
}

/**
 * Keeps a stable focus key through redraws, then falls back to the first
 * preferred key that is still enabled and rendered.
 */
export function resolveFocusableKey(
  currentKey: string,
  availableKeys: readonly string[],
  preferredKeys: readonly string[] = [],
): string | undefined {
  if (!availableKeys.length) return undefined;
  if (currentKey && availableKeys.includes(currentKey)) return currentKey;
  return preferredKeys.find((key) => availableKeys.includes(key)) ?? availableKeys[0];
}
