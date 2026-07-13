import type Phaser from "phaser";

/**
 * Phaser normally listens for mouse movement on the canvas only. The root also
 * contains the letterboxed black area, so targeting it keeps an active aim drag
 * responsive when the cursor crosses the canvas edge.
 */
export const GAME_INPUT_CONFIG: Phaser.Types.Core.InputConfig = {
  activePointers: 3,
  smoothFactor: 0.2,
  gamepad: true,
  mouse: { target: "game-root" },
};

/** Owns one aim gesture so another touch or mouse button cannot hijack it. */
export class AimDragSession {
  private activePointerId: number | null = null;

  get active(): boolean {
    return this.activePointerId !== null;
  }

  start(pointerId: number, button: number): boolean {
    if (button !== 0 || this.activePointerId !== null) return false;
    this.activePointerId = pointerId;
    return true;
  }

  tracks(pointerId: number): boolean {
    return this.activePointerId === pointerId;
  }

  cancelForSecondaryButton(button: number): boolean {
    return button === 2 && this.cancel();
  }

  /** A second touch is the touch-screen equivalent of right-click cancel. */
  cancelForAlternatePointer(pointerId: number): boolean {
    return this.activePointerId !== null && this.activePointerId !== pointerId && this.cancel();
  }

  /** Keyboard Escape and non-pointer UI can cancel the same owned gesture. */
  cancel(): boolean {
    if (this.activePointerId === null) return false;
    this.activePointerId = null;
    return true;
  }

  release(pointerId: number): boolean {
    if (!this.tracks(pointerId)) return false;
    this.activePointerId = null;
    return true;
  }

  reset(): void {
    this.activePointerId = null;
  }
}
