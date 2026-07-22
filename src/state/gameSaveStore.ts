import { bindSaveLifecycle, SaveWriteQueue, type SaveLifecycleTargets } from "./saveQueue";
import {
  cloneSave,
  createDefaultSave,
  migrateSave,
  normalizeSave,
  type GameLanguage,
  type GameSaveV1
} from "./saveSchema";

export type SavePersistenceStatus = {
  /** Whether the most recent durable write attempt completed successfully. */
  writeReady: boolean;
  /** Diagnostic only. Callers must retry a write instead of treating this as permanent. */
  lastWriteError?: string;
};

export class GameSaveStore {
  private state: GameSaveV1;
  /**
   * An opt-in, memory-only save used by the explicit developer voyage mode.
   *
   * Keeping this alongside (rather than replacing) `state` is deliberate: host
   * lifecycle writes must always keep using the player's durable snapshot, and
   * a debug reload must therefore discard every simulated unlock/resource edit.
   */
  private volatileState?: GameSaveV1;
  private volatileBaseline?: GameSaveV1;
  private persistenceStatus: SavePersistenceStatus = { writeReady: true };
  readonly queue: SaveWriteQueue<GameSaveV1>;

  constructor(
    private readonly host: LemGameHostApi,
    private readonly defaultLanguage: GameLanguage = "ko",
  ) {
    this.state = createDefaultSave(defaultLanguage);
    this.queue = new SaveWriteQueue(host.save, cloneSave);
  }

  async load(): Promise<GameSaveV1> {
    const raw = await this.host.save.load(createDefaultSave(this.defaultLanguage));
    this.state = migrateSave(raw, this.defaultLanguage);
    // Persist the canonical v1 shape immediately so schema-less prototypes, malformed values,
    // and forbidden legacy wallet fields do not survive another launch.
    // A temporary write outage must not make an otherwise readable save unbootable. Mutating
    // callers still receive write failures, and paid purchases explicitly re-probe durability
    // before the wallet can be charged.
    try {
      await this.persistCurrentState();
    } catch {
      // Exposed through getPersistenceStatus(); the next saveNow/update retries the write.
    }
    return this.getSnapshot();
  }

  getSnapshot(): GameSaveV1 {
    return cloneSave(this.volatileState ?? this.state);
  }

  /** Starts an isolated developer session without mutating or writing the host save. */
  beginVolatileSession(): GameSaveV1 {
    if (!this.volatileState) {
      this.volatileBaseline = cloneSave(this.state);
      this.volatileState = cloneSave(this.state);
    }
    return this.getSnapshot();
  }

  isVolatileSessionActive(): boolean {
    return Boolean(this.volatileState);
  }

  /** Restores the save as it was when this volatile session began. */
  restoreVolatileSessionBaseline(): GameSaveV1 {
    if (!this.volatileBaseline) return this.getSnapshot();
    this.volatileState = cloneSave(this.volatileBaseline);
    return this.getSnapshot();
  }

  getPersistenceStatus(): SavePersistenceStatus {
    return { ...this.persistenceStatus };
  }

  async replace(next: unknown): Promise<GameSaveV1> {
    if (this.volatileState) {
      this.volatileState = normalizeSave(next, this.defaultLanguage);
      return this.getSnapshot();
    }
    this.state = normalizeSave(next, this.defaultLanguage);
    await this.persistCurrentState();
    return this.getSnapshot();
  }

  async update(mutator: (draft: GameSaveV1) => void): Promise<GameSaveV1> {
    const draft = this.getSnapshot();
    mutator(draft);
    return this.replace(draft);
  }

  async saveNow(): Promise<void> {
    if (this.volatileState) return;
    await this.persistCurrentState();
  }

  async flush(): Promise<void> {
    await this.queue.flush();
  }

  flushForUnload(): Promise<void> {
    // Never hand the volatile developer snapshot to the host lifecycle writer.
    return this.queue.flushLatest(this.state);
  }

  bindLifecycle(targets?: SaveLifecycleTargets): () => void {
    return bindSaveLifecycle(this.queue, () => cloneSave(this.state), targets);
  }

  async clear(): Promise<GameSaveV1> {
    if (this.volatileState) {
      this.volatileState = createDefaultSave(this.defaultLanguage);
      return this.getSnapshot();
    }
    await this.host.save.clear();
    this.state = createDefaultSave(this.defaultLanguage);
    await this.persistCurrentState();
    return this.getSnapshot();
  }

  private async persistCurrentState(): Promise<void> {
    try {
      await this.queue.enqueue(this.state);
      this.persistenceStatus = { writeReady: true };
    } catch (error) {
      this.persistenceStatus = {
        writeReady: false,
        lastWriteError: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }
}
