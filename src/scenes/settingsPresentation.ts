import type { ColorVisionMode, TextScale } from "../state/saveSchema";

export type SettingsPage = "sound" | "accessibility";

export const SETTINGS_LAYOUT = Object.freeze({
  topBarBottom: 92,
  headingY: 124,
  descriptionY: 154,
  tabsY: 202,
  tabHeight: 56,
  panelTop: 246,
  panelBottom: 1086,
  resetY: 1134,
  doneY: 1212,
  viewportBottom: 1280,
});

export const SETTINGS_PAGES: readonly { readonly id: SettingsPage; readonly label: string }[] = Object.freeze([
  { id: "sound", label: "소리 · 언어" },
  { id: "accessibility", label: "화면 · 접근성" },
]);

export function nextColorVisionMode(mode: ColorVisionMode): ColorVisionMode {
  if (mode === "off") return "deuteranopia";
  if (mode === "deuteranopia") return "tritanopia";
  return "off";
}

export function colorVisionLabel(mode: ColorVisionMode): string {
  if (mode === "deuteranopia") return "적록 구분";
  if (mode === "tritanopia") return "청황 구분";
  return "기본 색상";
}

export function textScaleLabel(scale: TextScale): string {
  return scale === 115 ? "크게 115%" : "보통 100%";
}
