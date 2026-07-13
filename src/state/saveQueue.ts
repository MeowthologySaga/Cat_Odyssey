export type SaveLifecycleTargets = {
  windowTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget?: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  >;
};

export type SaveWriter<T> = {
  write(value: T): Promise<void>;
};

/**
 * Serializes ordinary writes, but can push the newest snapshot directly during an unload
 * signal. Queued older revisions are skipped after a direct flush so they cannot overwrite it.
 */
export class SaveWriteQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private directFlush: Promise<void> = Promise.resolve();
  private revision = 0;
  private directlyFlushedRevision = 0;
  private latestSnapshot: T | undefined;

  constructor(
    private readonly saveApi: SaveWriter<T>,
    private readonly clone: (value: T) => T = cloneValue
  ) {}

  enqueue(value: T): Promise<void> {
    const snapshot = this.clone(value);
    this.latestSnapshot = snapshot;
    const revision = ++this.revision;
    const task = this.tail.catch(() => undefined).then(async () => {
      if (revision <= this.directlyFlushedRevision) {
        return;
      }
      await this.saveApi.write(snapshot);
    });
    this.tail = task;
    return task;
  }

  /**
   * Calls Host save immediately. The real PlayZone bridge records its latest payload before
   * waiting for postMessage, which makes this suitable for pagehide/beforeunload.
   */
  flushLatest(value: T = this.requireLatestSnapshot()): Promise<void> {
    const snapshot = this.clone(value);
    this.latestSnapshot = snapshot;
    const revision = ++this.revision;
    this.directlyFlushedRevision = revision;
    const task = Promise.resolve(this.saveApi.write(snapshot));
    this.directFlush = task;
    return task;
  }

  async flush(): Promise<void> {
    await Promise.all([this.tail, this.directFlush]);
  }

  getLatestSnapshot(): T | undefined {
    return this.latestSnapshot === undefined ? undefined : this.clone(this.latestSnapshot);
  }

  private requireLatestSnapshot(): T {
    if (this.latestSnapshot === undefined) {
      throw new Error("No save snapshot has been queued.");
    }
    return this.latestSnapshot;
  }
}

export function bindSaveLifecycle<T>(
  queue: SaveWriteQueue<T>,
  getSnapshot: () => T,
  targets: SaveLifecycleTargets = {}
): () => void {
  const windowTarget =
    targets.windowTarget ?? (typeof window !== "undefined" ? window : undefined);
  const documentTarget =
    targets.documentTarget ?? (typeof document !== "undefined" ? document : undefined);

  const flush = () => {
    void queue.flushLatest(getSnapshot()).catch(() => {
      // Unload paths cannot present recovery UI. The in-memory pending purchase remains in the
      // next successfully persisted snapshot and will be retried by PurchaseService.
    });
  };
  const flushWhenHidden = () => {
    if (documentTarget?.visibilityState === "hidden") {
      flush();
    }
  };

  windowTarget?.addEventListener("pagehide", flush);
  windowTarget?.addEventListener("beforeunload", flush);
  documentTarget?.addEventListener("visibilitychange", flushWhenHidden);

  return () => {
    windowTarget?.removeEventListener("pagehide", flush);
    windowTarget?.removeEventListener("beforeunload", flush);
    documentTarget?.removeEventListener("visibilitychange", flushWhenHidden);
  };
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
