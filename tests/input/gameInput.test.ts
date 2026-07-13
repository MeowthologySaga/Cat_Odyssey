import { describe, expect, it } from "vitest";
import { AimDragSession, GAME_INPUT_CONFIG } from "../../src/input/gameInput";

describe("game input", () => {
  it("listens across the whole game root so letterbox movement reaches Phaser", () => {
    expect(GAME_INPUT_CONFIG.mouse).toMatchObject({ target: "game-root" });
  });

  it("keeps the originating pointer in control until an outside release", () => {
    const session = new AimDragSession();

    expect(session.start(0, 0)).toBe(true);
    expect(session.tracks(0)).toBe(true);
    expect(session.release(0)).toBe(true);
    expect(session.active).toBe(false);
  });

  it("cancels an active drag on right-click and ignores the later left release", () => {
    const session = new AimDragSession();

    expect(session.start(0, 0)).toBe(true);
    expect(session.cancelForSecondaryButton(2)).toBe(true);
    expect(session.release(0)).toBe(false);
    expect(session.active).toBe(false);
  });

  it("uses a second touch as cancel without letting it hijack the drag", () => {
    const session = new AimDragSession();

    expect(session.start(1, 0)).toBe(true);
    expect(session.start(2, 0)).toBe(false);
    expect(session.cancelForAlternatePointer(2)).toBe(true);
    expect(session.release(1)).toBe(false);
    expect(session.active).toBe(false);
  });

  it("supports keyboard-style cancellation and rejects a non-primary start", () => {
    const session = new AimDragSession();

    expect(session.start(0, 1)).toBe(false);
    expect(session.start(3, 0)).toBe(true);
    expect(session.cancel()).toBe(true);
    expect(session.cancel()).toBe(false);
  });
});
