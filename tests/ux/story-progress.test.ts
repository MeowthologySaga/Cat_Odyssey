import { createDefaultSave, type GameSaveV1 } from "../../src/state";
import { persistStoryProgress } from "../../src/core/storyProgress";
import { markRouteStorySeen, routeStoryMarker } from "../../src/core/uxFlow";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

function createStore(write: (snapshot: GameSaveV1) => Promise<GameSaveV1>) {
  let snapshot = createDefaultSave();
  return {
    getSnapshot: () => structuredClone(snapshot),
    update: (mutate: (draft: GameSaveV1) => void) => {
      const draft = structuredClone(snapshot);
      mutate(draft);
      snapshot = draft;
      return write(structuredClone(snapshot));
    },
  };
}

describe("story progress persistence", () => {
  it("returns the persisted host snapshot on success", async () => {
    const store = createStore(async (snapshot) => snapshot);
    const result = await persistStoryProgress(
      store,
      (draft) => markRouteStorySeen(draft, "route-01-ogygia"),
      50,
    );
    expect(result.persisted).toBe(true);
    expect(result.save.inventory.skinIds).toContain(routeStoryMarker("route-01-ogygia"));
  });

  it("returns the in-memory snapshot after rejection so navigation can continue", async () => {
    const store = createStore(async () => { throw new Error("host offline"); });
    const result = await persistStoryProgress(
      store,
      (draft) => markRouteStorySeen(draft, "route-02-lotus"),
      50,
    );
    expect(result.persisted).toBe(false);
    expect(result.save.inventory.skinIds).toContain(routeStoryMarker("route-02-lotus"));
    expect(result.error).toEqual(new Error("host offline"));
  });

  it("times out a stalled host without losing the current-session marker", async () => {
    vi.useFakeTimers();
    const store = createStore(() => new Promise<GameSaveV1>(() => undefined));
    const pending = persistStoryProgress(
      store,
      (draft) => markRouteStorySeen(draft, "route-03-cyclops"),
      25,
    );
    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;
    expect(result.persisted).toBe(false);
    expect(result.save.inventory.skinIds).toContain(routeStoryMarker("route-03-cyclops"));
    expect(result.error).toMatchObject({ name: "OperationTimeoutError", timeoutMs: 25 });
  });
});
