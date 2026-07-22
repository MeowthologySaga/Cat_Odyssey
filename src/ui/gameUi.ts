import Phaser from "phaser";
import { getServices } from "../core/services";
import { playSfx } from "../audio/AudioDirector";
import { translateText } from "../localization";
import {
  accessibilityPaletteFor,
  nextFocusableIndex,
  resolveFocusableKey,
  scaleTextSize,
  type AccessibilityPalette,
} from "./accessibility";

export {
  accessibilityPaletteFor,
  nextFocusableIndex,
  resolveFocusableKey,
  scaleTextSize,
} from "./accessibility";
export type { AccessibilityPalette, AccessibilityPaletteInput } from "./accessibility";

export const W = 720;
export const H = 1280;
export const COLORS = {
  ink: 0x06141c,
  deep: 0x0b2530,
  teal: 0x1b6b72,
  cyan: 0x73d7cf,
  cream: 0xf7e7bb,
  gold: 0xd8a94a,
  bronze: 0x8b542d,
  red: 0xbb4b42,
  green: 0x73b66b,
  violet: 0x75559a,
} as const;

export interface GameButtonOptions {
  width?: number;
  height?: number;
  icon?: string;
  subtitle?: string;
  enabled?: boolean;
  accent?: number;
  fontSize?: number;
  primary?: boolean;
  /** Stable key preserves keyboard/gamepad focus across a scene redraw. */
  focusKey?: string;
  onClick: () => void;
}

export interface TopBarOptions {
  /** Scenes with their own Escape/B-button state machine can opt out. */
  readonly bindKeyboardBack?: boolean;
}

export interface FocusableHitAreaOptions {
  /** Stable across scene redraws, filtering, and paging. */
  readonly focusKey: string;
  /** Locked entries can remain pointer-active while staying out of focus order. */
  readonly focusable?: boolean;
  readonly useHandCursor?: boolean;
  readonly primary?: boolean;
  readonly onActivate: () => void;
}

const FOCUSABLES_KEY = "__ui:focusables";
const FOCUS_BOUND_KEY = "__ui:focus-bound";
const FOCUSED_KEY = "__ui:focused-key";
const FOCUS_USER_SET_KEY = "__ui:focus-user-set";
const FOCUS_SCOPE_KEY = "__ui:focus-scope";
const NAVIGATING_KEY = "__ui:navigating";
const ESCAPE_HANDLER_KEY = "__ui:escape-handler";

export function uiTextSize(baseSize: number): number {
  return scaleTextSize(baseSize, getServices().save.getSnapshot().settings.textScale);
}

export function accessibilityPalette(): AccessibilityPalette {
  const settings = getServices().save.getSnapshot().settings;
  return accessibilityPaletteFor(settings);
}

export function setUiEscapeHandler(scene: Phaser.Scene, handler?: () => void): void {
  scene.data.set(ESCAPE_HANDLER_KEY, handler);
}

export function setUiFocusScope(
  scene: Phaser.Scene,
  scope: string,
  preferredFocusKey?: string,
): void {
  scene.data.set(FOCUS_SCOPE_KEY, scope);
  if (preferredFocusKey) scene.data.set(FOCUSED_KEY, preferredFocusKey);
  refreshFocusRings(scene);
}

export function ensureUiFocus(scene: Phaser.Scene, preferredKeys: readonly string[] = []): void {
  const buttons = usableFocusableButtons(scene);
  if (!buttons.length) return;
  const focused = String(scene.data.get(FOCUSED_KEY) ?? "");
  const keys = buttons.map((entry) => String(entry.getData("uiFocusKey") ?? ""));
  const targetKey = resolveFocusableKey(focused, keys, preferredKeys);
  const target = buttons.find((entry) => String(entry.getData("uiFocusKey") ?? "") === targetKey);
  if (target) focusButton(scene, target, false);
}

export function isReducedMotion(): boolean {
  return getServices().save.getSnapshot().settings.reducedMotion;
}

export function motionDuration(duration: number): number {
  return isReducedMotion() ? 0 : duration;
}

export function addUiTween(
  scene: Phaser.Scene,
  config: Phaser.Types.Tweens.TweenBuilderConfig,
): Phaser.Tweens.Tween {
  if (!isReducedMotion()) return scene.tweens.add(config);
  return scene.tweens.add({ ...config, duration: 0, delay: 0, hold: 0, repeat: 0, yoyo: false });
}

export function bindBackNavigation(scene: Phaser.Scene, back: () => void): void {
  if (scene.data.get("__ui:back-bound")) return;
  scene.data.set("__ui:back-bound", true);
  const navigateBack = () => {
    playSfx(scene, "sfx-ui-cancel", 0.32);
    back();
  };
  const keyboard = scene.input.keyboard;
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" && event.key !== "Backspace") return;
    const escapeHandler = scene.data.get(ESCAPE_HANDLER_KEY) as (() => void) | undefined;
    if (escapeHandler) {
      event.preventDefault();
      escapeHandler();
    } else navigateBack();
  };
  keyboard?.on("keydown", onKey);
  const onPad = (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
    if (button.index !== 1) return;
    const escapeHandler = scene.data.get(ESCAPE_HANDLER_KEY) as (() => void) | undefined;
    if (escapeHandler) escapeHandler();
    else navigateBack();
  };
  scene.input.gamepad?.on("down", onPad);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    keyboard?.off("keydown", onKey);
    scene.input.gamepad?.off("down", onPad);
    scene.data.set("__ui:back-bound", false);
  });
}

export function registerFocusableContainer(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  primary = false,
): void {
  if (!container.getData("uiFocusRing")) {
    const settings = getServices().save.getSnapshot().settings;
    const palette = accessibilityPaletteFor(settings);
    const width = Math.max(44, container.width);
    const height = Math.max(44, container.height);
    const ring = scene.add.graphics().setVisible(false);
    ring.lineStyle(settings.highContrast ? 8 : 6, 0x000000, 0.96)
      .strokeRoundedRect(-width / 2 - 7, -height / 2 - 7, width + 14, height + 14, 28);
    ring.lineStyle(settings.highContrast ? 5 : 4, palette.focus, 1)
      .strokeRoundedRect(-width / 2 - 5, -height / 2 - 5, width + 10, height + 10, 26);
    container.addAt(ring, 0);
    container.setData("uiFocusRing", ring);
  }
  if (!container.getData("uiFocusKey")) {
    container.setData("uiFocusKey", container.name || `container:${Math.round(container.x)}:${Math.round(container.y)}`);
  }
  container.setData("uiPrimary", primary);
  container.setData("uiFocusScope", String(scene.data.get(FOCUS_SCOPE_KEY) ?? "base"));
  container.on("pointerover", () => focusButton(scene, container, true));
  registerFocusableButton(scene, container, primary);
}

/**
 * Adds an invisible pointer target that participates in the shared
 * keyboard/gamepad registry. Setting `focusable` false preserves locked-item
 * pointer feedback without exposing it to Tab/D-pad navigation.
 */
export function addFocusableHitArea(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  options: FocusableHitAreaOptions,
): Phaser.GameObjects.Container {
  const container = scene.add.container(x, y).setSize(width, height);
  container.setData("uiFocusKey", options.focusKey);
  container.setInteractive({ useHandCursor: options.useHandCursor ?? true });
  container.on("pointerup", () => {
    if (options.focusable ?? true) playSfx(scene, "sfx-ui-confirm", 0.36);
    options.onActivate();
  });
  if (options.focusable ?? true) registerFocusableContainer(scene, container, Boolean(options.primary));
  return container;
}

export function addButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  options: GameButtonOptions,
): Phaser.GameObjects.Container {
  const displayLabel = translateText(label);
  const displaySubtitle = options.subtitle ? translateText(options.subtitle) : undefined;
  const width = options.width ?? 280;
  const height = options.height ?? 74;
  const enabled = options.enabled ?? true;
  const accent = options.accent ?? COLORS.gold;
  const settings = getServices().save.getSnapshot().settings;
  const palette = accessibilityPaletteFor(settings);
  const focusRing = scene.add.graphics().setVisible(false);
  focusRing.lineStyle(settings.highContrast ? 8 : 6, 0x000000, 0.96)
    .strokeRoundedRect(-width / 2 - 7, -height / 2 - 7, width + 14, height + 14, 23);
  focusRing.lineStyle(settings.highContrast ? 5 : 4, palette.focus, 1)
    .strokeRoundedRect(-width / 2 - 5, -height / 2 - 5, width + 10, height + 10, 21);
  const bg = scene.add.graphics();
  bg.fillStyle(enabled ? settings.highContrast ? 0x001116 : 0x102f39 : 0x172329, 0.98);
  bg.lineStyle(settings.highContrast ? 3 : 2, enabled ? accent : 0x48545a, settings.highContrast ? 1 : 0.9);
  bg.fillRoundedRect(-width / 2, -height / 2, width, height, 18);
  bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 18);
  bg.lineStyle(1, 0xffffff, enabled ? 0.12 : 0.04);
  bg.strokeRoundedRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, 14);

  const children: Phaser.GameObjects.GameObject[] = [focusRing, bg];
  const iconOffset = options.icon ? 24 : 0;
  if (options.icon) {
    children.push(scene.add.text(-width / 2 + 36, 0, options.icon, {
      fontFamily: "Malgun Gothic, sans-serif",
      fontSize: `${Math.min(uiTextSize(36), height * 0.5)}px`,
      color: enabled ? settings.highContrast ? "#ffffff" : "#f7e7bb" : "#727b7d",
    }).setOrigin(0.5));
  }
  const titleY = options.subtitle ? -Math.min(12, height * 0.15) : 0;
  const title = scene.add.text(iconOffset, titleY, displayLabel, {
    fontFamily: "Malgun Gothic, sans-serif",
    fontStyle: "bold",
    fontSize: `${Math.min(uiTextSize(Math.max(14, options.fontSize ?? 24)), options.subtitle ? height * 0.36 : height * 0.54)}px`,
    color: enabled ? settings.highContrast ? "#ffffff" : "#f7e7bb" : "#727b7d",
    align: "center",
    wordWrap: { width: Math.max(44, width - Math.abs(iconOffset) - 42), useAdvancedWrap: true },
  }).setOrigin(0.5).setMaxLines(options.subtitle ? 1 : 2);
  children.push(title);
  if (displaySubtitle) {
    children.push(scene.add.text(iconOffset, 18, displaySubtitle, {
      fontFamily: "Malgun Gothic, sans-serif",
      fontSize: `${Math.min(uiTextSize(14), height * 0.24)}px`,
      color: enabled ? settings.highContrast ? "#d9ffff" : "#9ec8c2" : "#5c6669",
      align: "center",
      wordWrap: { width: Math.max(44, width - Math.abs(iconOffset) - 38), useAdvancedWrap: true },
    }).setOrigin(0.5).setMaxLines(1));
  }
  const container = scene.add.container(x, y, children).setSize(width, height).setDepth(50);
  container.setName(displayLabel);
  container.setData("uiAriaLabel", [displayLabel, displaySubtitle].filter(Boolean).join(". "));
  container.setData("uiFocusRing", focusRing);
  container.setData("uiFocusKey", options.focusKey ?? `${label}:${Math.round(x)}:${Math.round(y)}`);
  container.setData("uiPrimary", Boolean(options.primary));
  container.setData("uiFocusScope", String(scene.data.get(FOCUS_SCOPE_KEY) ?? "base"));
  container.setAlpha(enabled ? 1 : 0.7);
  if (enabled) {
    container.setInteractive({ useHandCursor: true });
    container.on("pointerover", () => {
      focusButton(scene, container, true);
      if (isReducedMotion()) container.setScale(1);
      else addUiTween(scene, { targets: container, scaleX: 1.025, scaleY: 1.025, duration: 90 });
    });
    container.on("pointerout", () => {
      if (isReducedMotion()) container.setScale(1);
      else addUiTween(scene, { targets: container, scaleX: 1, scaleY: 1, duration: 90 });
    });
    container.on("pointerdown", () => {
      if (!isReducedMotion()) addUiTween(scene, { targets: container, scaleX: 0.97, scaleY: 0.97, duration: 55, yoyo: true });
    });
    container.on("pointerup", () => {
      focusButton(scene, container, true);
      playSfx(scene, "sfx-ui-confirm", 0.36);
      options.onClick();
    });
    registerFocusableButton(scene, container, Boolean(options.primary));
  }
  return container;
}

export function addPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: number = COLORS.gold,
  alpha: number = 0.94,
): Phaser.GameObjects.Graphics {
  const highContrast = getServices().save.getSnapshot().settings.highContrast;
  const panel = scene.add.graphics();
  panel.fillStyle(highContrast ? 0x000b0f : 0x07191f, highContrast ? Math.max(alpha, 0.985) : alpha);
  panel.lineStyle(highContrast ? 3 : 2, accent, highContrast ? 1 : 0.8);
  panel.fillRoundedRect(x, y, width, height, 22);
  panel.strokeRoundedRect(x, y, width, height, 22);
  panel.lineStyle(1, 0xf5e6b8, 0.1);
  panel.strokeRoundedRect(x + 6, y + 6, width - 12, height - 12, 17);
  return panel;
}

export function addTitle(
  scene: Phaser.Scene,
  text: string,
  y: number,
  size = 34,
): Phaser.GameObjects.Text {
  return scene.add.text(W / 2, y, translateText(text), {
    fontFamily: "Malgun Gothic, sans-serif",
    fontStyle: "bold",
    fontSize: `${uiTextSize(size)}px`,
    color: getServices().save.getSnapshot().settings.highContrast ? "#ffffff" : "#f7e7bb",
    stroke: "#071217",
    strokeThickness: 7,
    align: "center",
  }).setOrigin(0.5).setDepth(40);
}

export function addTopBar(
  scene: Phaser.Scene,
  title: string,
  back?: () => void,
  options: TopBarOptions = {},
): Phaser.GameObjects.Container {
  const services = getServices();
  const snapshot = services.save.getSnapshot();
  const gold = snapshot.resources.gold;
  const highContrast = snapshot.settings.highContrast;
  const graphics = scene.add.graphics();
  graphics.fillStyle(0x041016, 0.94).fillRect(0, 0, W, 92);
  graphics.lineStyle(2, COLORS.gold, 0.7).lineBetween(0, 91, W, 91);
  const items: Phaser.GameObjects.GameObject[] = [graphics];
  if (back) {
    const navigateBack = () => {
      playSfx(scene, "sfx-ui-cancel", 0.32);
      back();
    };
    const backText = scene.add.text(34, 45, "‹", {
      fontFamily: "Georgia, serif", fontSize: `${uiTextSize(58)}px`, color: highContrast ? "#ffffff" : "#f7e7bb",
    }).setOrigin(0.5);
    const hit = scene.add.zone(36, 44, 70, 80).setInteractive({ useHandCursor: true });
    hit.setName(translateText("뒤로")).setData("uiAriaLabel", translateText("뒤로"));
    hit.on("pointerup", navigateBack);
    items.push(backText, hit);
    if (options.bindKeyboardBack !== false) bindBackNavigation(scene, back);
  }
  items.push(scene.add.text(back ? 78 : 28, 43, translateText(title), {
    fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(24)}px`, color: highContrast ? "#ffffff" : "#f7e7bb",
    wordWrap: { width: back ? 330 : 380, useAdvancedWrap: true },
  }).setOrigin(0, 0.5).setMaxLines(1));
  items.push(scene.add.text(500, 43, `◆ ${services.walletBalance.toLocaleString()}`, {
    fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: highContrast ? "#a9ffff" : "#8be7f0",
  }).setOrigin(0.5));
  items.push(scene.add.text(635, 43, `● ${gold.toLocaleString()}`, {
    fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: highContrast ? "#ffe278" : "#f0c66b",
  }).setOrigin(0.5));
  return scene.add.container(0, 0, items).setDepth(500);
}

export function addAtmosphere(scene: Phaser.Scene, color: number = 0x8de1dc, count = 26): void {
  const reduced = isReducedMotion();
  for (let i = 0; i < (reduced ? Math.ceil(count * 0.55) : count); i += 1) {
    const star = scene.add.image(
      Phaser.Math.Between(12, W - 12),
      Phaser.Math.Between(100, H - 10),
      "particle",
    ).setTint(color).setAlpha(Phaser.Math.FloatBetween(0.08, 0.32)).setScale(Phaser.Math.FloatBetween(0.35, 1.25));
    if (reduced) continue;
    addUiTween(scene, {
      targets: star,
      y: star.y - Phaser.Math.Between(40, 160),
      x: star.x + Phaser.Math.Between(-40, 40),
      alpha: 0,
      duration: Phaser.Math.Between(2600, 6500),
      delay: Phaser.Math.Between(0, 2500),
      repeat: -1,
      onRepeat: () => { star.setPosition(Phaser.Math.Between(12, W - 12), H + 8).setAlpha(Phaser.Math.FloatBetween(0.08, 0.3)); },
    });
  }
}

export function addToast(scene: Phaser.Scene, message: string, color: number = COLORS.cyan): void {
  const settings = getServices().save.getSnapshot().settings;
  const height = settings.textScale === 115 ? 84 : 68;
  const panel = scene.add.graphics().fillStyle(0x030c10, 0.96).lineStyle(2, color, 0.9);
  panel.fillRoundedRect(-280, -height / 2, 560, height, 18).strokeRoundedRect(-280, -height / 2, 560, height, 18);
  const text = scene.add.text(0, 0, translateText(message), {
    fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(20)}px`, color: settings.highContrast ? "#ffffff" : "#f7e7bb", align: "center",
    wordWrap: { width: 510, useAdvancedWrap: true },
  }).setOrigin(0.5).setMaxLines(2);
  const toast = scene.add.container(W / 2, 1160, [panel, text]).setDepth(2000).setAlpha(0);
  if (settings.reducedMotion) {
    toast.setAlpha(1).setY(1110);
    scene.time.delayedCall(1_800, () => {
      if (toast.active) toast.destroy(true);
    });
  } else {
    addUiTween(scene, { targets: toast, alpha: 1, y: 1110, duration: 180, hold: 1500, yoyo: true, onComplete: () => toast.destroy(true) });
  }
}

export function fadeTo(scene: Phaser.Scene, key: string, data?: object): void {
  if (scene.data.get(NAVIGATING_KEY)) return;
  scene.data.set(NAVIGATING_KEY, true);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.data.set(NAVIGATING_KEY, false));
  const duration = motionDuration(220);
  if (duration <= 0) {
    scene.scene.start(key, data);
    return;
  }

  // Change scenes from the camera completion event instead of depending solely
  // on the outgoing Scene clock. This keeps navigation reliable when the game
  // is background-throttled or a loader has just yielded control back to Phaser.
  let transitioned = false;
  const startNextScene = () => {
    if (transitioned || !scene.scene.isActive()) return;
    transitioned = true;
    scene.scene.start(key, data);
  };
  scene.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, startNextScene);
  scene.cameras.main.fadeOut(duration, 2, 9, 13);
  scene.time.delayedCall(duration + 80, startNextScene);
}

export function fadeInScene(scene: Phaser.Scene, duration = 220): void {
  const adjusted = motionDuration(duration);
  if (adjusted > 0) scene.cameras.main.fadeIn(adjusted, 2, 8, 12);
}

export function drawDiamond(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color = 0x73d7e7): void {
  graphics.fillStyle(color, 1).lineStyle(2, 0xe7ffff, 0.8);
  graphics.beginPath().moveTo(x, y - size).lineTo(x + size * 0.78, y).lineTo(x, y + size).lineTo(x - size * 0.78, y).closePath().fillPath().strokePath();
}

function registerFocusableButton(scene: Phaser.Scene, button: Phaser.GameObjects.Container, primary: boolean): void {
  const current = allFocusableButtons(scene);
  if (primary) current.unshift(button);
  else current.push(button);
  scene.data.set(FOCUSABLES_KEY, current);
  const buttonKey = String(button.getData("uiFocusKey") ?? "");
  const userSet = Boolean(scene.data.get(FOCUS_USER_SET_KEY));
  const focusedKey = String(scene.data.get(FOCUSED_KEY) ?? "");
  if (!focusedKey || (primary && !userSet)) scene.data.set(FOCUSED_KEY, buttonKey);
  refreshFocusRings(scene);
  button.once("destroy", () => {
    scene.data.set(FOCUSABLES_KEY, allFocusableButtons(scene).filter((entry) => entry !== button));
  });
  if (scene.data.get(FOCUS_BOUND_KEY)) return;
  scene.data.set(FOCUS_BOUND_KEY, true);
  const focus = (delta: number) => {
    const buttons = usableFocusableButtons(scene);
    if (!buttons.length) return;
    const focused = String(scene.data.get(FOCUSED_KEY) ?? "");
    const currentIndex = buttons.findIndex((entry) => entry.getData("uiFocusKey") === focused);
    const next = nextFocusableIndex(currentIndex, delta, buttons.length);
    const target = buttons[next];
    if (target) focusButton(scene, target, true);
  };
  const activate = () => {
    const buttons = usableFocusableButtons(scene);
    if (!buttons.length) return;
    const focused = String(scene.data.get(FOCUSED_KEY) ?? "");
    const target = buttons.find((entry) => entry.getData("uiFocusKey") === focused) ?? buttons[0];
    target?.emit("pointerup");
  };
  const keyboard = scene.input.keyboard;
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat && (event.key === "Enter" || event.key === " ")) return;
    if (event.key === "Tab") {
      event.preventDefault();
      focus(event.shiftKey ? -1 : 1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focus(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focus(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };
  keyboard?.on("keydown", onKey);
  const onPad = (_pad: Phaser.Input.Gamepad.Gamepad, padButton: Phaser.Input.Gamepad.Button) => {
    if (padButton.index === 0) activate();
    else if (padButton.index === 12 || padButton.index === 14) focus(-1);
    else if (padButton.index === 13 || padButton.index === 15) focus(1);
  };
  scene.input.gamepad?.on("down", onPad);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    keyboard?.off("keydown", onKey);
    scene.input.gamepad?.off("down", onPad);
    scene.data.set(FOCUSABLES_KEY, []);
    scene.data.set(FOCUS_BOUND_KEY, false);
    scene.data.set(FOCUSED_KEY, "");
    scene.data.set(FOCUS_USER_SET_KEY, false);
    scene.data.set(FOCUS_SCOPE_KEY, "base");
    scene.data.set(ESCAPE_HANDLER_KEY, undefined);
  });
}

function usableFocusableButtons(scene: Phaser.Scene): Phaser.GameObjects.Container[] {
  const scope = String(scene.data.get(FOCUS_SCOPE_KEY) ?? "base");
  return allFocusableButtons(scene)
    .filter((entry) => String(entry.getData("uiFocusScope") ?? "base") === scope);
}

function allFocusableButtons(scene: Phaser.Scene): Phaser.GameObjects.Container[] {
  return ((scene.data.get(FOCUSABLES_KEY) as Phaser.GameObjects.Container[] | undefined) ?? [])
    .filter((entry) => entry.active
      && entry.visible
      && Boolean(entry.input?.enabled));
}

function focusButton(
  scene: Phaser.Scene,
  button: Phaser.GameObjects.Container,
  userInitiated: boolean,
): void {
  if (!button.active || !button.visible || !button.input?.enabled) return;
  scene.data.set(FOCUSED_KEY, String(button.getData("uiFocusKey") ?? ""));
  if (userInitiated) scene.data.set(FOCUS_USER_SET_KEY, true);
  announceAccessibleFocus(button);
  refreshFocusRings(scene);
}

function announceAccessibleFocus(button: Phaser.GameObjects.Container): void {
  if (typeof document === "undefined") return;
  const label = String(button.getData("uiAriaLabel") ?? button.name ?? "").trim();
  if (!label) return;
  const liveRegion = document.querySelector<HTMLElement>("#game-modal-root");
  if (!liveRegion) return;
  liveRegion.setAttribute("role", "status");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.textContent = label;
}

function refreshFocusRings(scene: Phaser.Scene): void {
  const focused = String(scene.data.get(FOCUSED_KEY) ?? "");
  const scope = String(scene.data.get(FOCUS_SCOPE_KEY) ?? "base");
  for (const entry of allFocusableButtons(scene)) {
    const ring = entry.getData("uiFocusRing") as Phaser.GameObjects.Graphics | undefined;
    ring?.setVisible(
      String(entry.getData("uiFocusScope") ?? "base") === scope
      && String(entry.getData("uiFocusKey") ?? "") === focused,
    );
  }
}
