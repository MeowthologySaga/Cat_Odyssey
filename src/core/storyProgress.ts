import type { GameSaveStore, GameSaveV1 } from "../state";
import { withDeadline } from "./asyncDeadline";

export const STORY_PROGRESS_SAVE_TIMEOUT_MS = 4_000;

export interface StoryProgressResult {
  readonly save: GameSaveV1;
  readonly persisted: boolean;
  readonly error?: unknown;
}

type StoryProgressStore = Pick<GameSaveStore, "getSnapshot" | "update">;

/**
 * Story cards are navigation gates, so a failed host acknowledgement must not
 * strand the player. GameSaveStore applies the new snapshot in memory before
 * awaiting its host write; on failure/timeout we continue from that snapshot and
 * let the scene retry the latest state through the direct lifecycle writer.
 */
export async function persistStoryProgress(
  store: StoryProgressStore,
  mutate: (draft: GameSaveV1) => void,
  timeoutMs = STORY_PROGRESS_SAVE_TIMEOUT_MS,
): Promise<StoryProgressResult> {
  try {
    const save = await withDeadline(store.update(mutate), timeoutMs, "Story progress save");
    return { save, persisted: true };
  } catch (error: unknown) {
    return { save: store.getSnapshot(), persisted: false, error };
  }
}
