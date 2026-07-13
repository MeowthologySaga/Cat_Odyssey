import { createMockGameHost } from "../../src/platform";
import { GameSaveStore } from "../../src/state";
import { describe, expect, it } from "vitest";

describe("GameSaveStore persistence recovery", () => {
  it("boots from a readable save when canonical write-back is temporarily unavailable", async () => {
    const host = createMockGameHost();
    const durableWrite = host.save.write.bind(host.save);
    let rejectNextWrite = true;
    host.save.write = async <T>(value: T): Promise<void> => {
      if (rejectNextWrite) {
        rejectNextWrite = false;
        throw new Error("storage temporarily unavailable");
      }
      await durableWrite(value);
    };
    const store = new GameSaveStore(host);

    await expect(store.load()).resolves.toMatchObject({ schemaVersion: 1 });
    expect(store.getPersistenceStatus()).toEqual({
      writeReady: false,
      lastWriteError: "storage temporarily unavailable",
    });
    expect(host.__mock.getSavedValue()).toBeUndefined();

    await expect(store.saveNow()).resolves.toBeUndefined();
    expect(store.getPersistenceStatus()).toEqual({ writeReady: true });
    expect(host.__mock.getSavedValue()).toMatchObject({ schemaVersion: 1 });
  });

  it("keeps a volatile developer session isolated from the durable host save", async () => {
    const host = createMockGameHost();
    const store = new GameSaveStore(host);
    await store.load();
    const durableBefore = host.__mock.getSavedValue();

    store.beginVolatileSession();
    await store.update((draft) => {
      draft.resources.gold = 999_999;
      draft.progress.campaignComplete = true;
    });
    await store.saveNow();
    await store.flushForUnload();

    expect(store.isVolatileSessionActive()).toBe(true);
    expect(store.getSnapshot().resources.gold).toBe(999_999);
    expect(host.__mock.getSavedValue()).toEqual(durableBefore);

    const restored = store.restoreVolatileSessionBaseline();
    expect(restored.resources.gold).toBe(0);
    expect(restored.progress.campaignComplete).toBe(false);
  });
});
