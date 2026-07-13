import { SaveWriteQueue, bindSaveLifecycle } from "../../src/state";
import { describe, expect, it } from "vitest";

describe("immediate save queue", () => {
  it("serializes writes and skips stale queued snapshots after an unload flush", async () => {
    const writes: number[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queue = new SaveWriteQueue<{ value: number }>({
      async write(snapshot) {
        writes.push(snapshot.value);
        if (snapshot.value === 1) {
          await firstBlocked;
        }
      }
    });

    const first = queue.enqueue({ value: 1 });
    const stale = queue.enqueue({ value: 2 });
    await Promise.resolve();
    await Promise.resolve();
    const unload = queue.flushLatest({ value: 3 });
    releaseFirst();

    await Promise.all([first, stale, unload, queue.flush()]);
    expect(writes).toEqual([1, 3]);
    expect(queue.getLatestSnapshot()).toEqual({ value: 3 });
  });

  it("flushes on pagehide and hidden visibility changes", async () => {
    const writes: number[] = [];
    const queue = new SaveWriteQueue<{ value: number }>({
      async write(snapshot) {
        writes.push(snapshot.value);
      }
    });
    const windowTarget = new EventTarget();
    const documentTarget = Object.assign(new EventTarget(), {
      visibilityState: "visible"
    });
    let value = 7;
    const unbind = bindSaveLifecycle(queue, () => ({ value }), {
      windowTarget: windowTarget as unknown as Window,
      documentTarget: documentTarget as unknown as Document
    });

    windowTarget.dispatchEvent(new Event("pagehide"));
    value = 8;
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await queue.flush();
    unbind();

    expect(writes).toEqual([7, 8]);
  });
});
