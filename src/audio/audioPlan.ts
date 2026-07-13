export type BgmRole = "ambient" | "battle" | "boss";

/** Audio timings are deliberately centralized so scene code cannot drift. */
export const BGM_CROSSFADE_MS = 2_100;
export const BGM_FIRST_FADE_MS = 900;
export const BOSS_ENTRY_DELAY_MS = 760;
export const BOSS_EXIT_GRACE_MS = 1_800;
export const MAX_SFX_VOICES = 16;

export interface BgmTransitionRequest {
  readonly currentKey?: string;
  readonly requestedKey: string;
  readonly currentRole?: BgmRole;
  readonly requestedRole: BgmRole;
  readonly hasCurrentVoice: boolean;
  readonly requestedDelayMs?: number;
}

export interface BgmTransitionPlan {
  readonly action: "keep" | "switch";
  readonly delayMs: number;
  readonly fadeMs: number;
}

/**
 * Plan a music request without touching Phaser or wall-clock state.
 *
 * Boss entry waits until the arena HUD has appeared. Leaving a boss holds the
 * final bar briefly, then transitions instead of snapping straight to menu
 * music. Identical keys are always preserved, including while globally paused.
 */
export function planBgmTransition(request: BgmTransitionRequest): BgmTransitionPlan {
  if (request.hasCurrentVoice && request.currentKey === request.requestedKey) {
    return { action: "keep", delayMs: 0, fadeMs: 0 };
  }

  const explicitDelay = finiteNonNegative(request.requestedDelayMs ?? 0);
  const bossEntryDelay = request.requestedRole === "boss" ? BOSS_ENTRY_DELAY_MS : 0;
  const bossExitGrace = request.currentRole === "boss" && request.requestedRole !== "boss"
    ? BOSS_EXIT_GRACE_MS
    : 0;

  return {
    action: "switch",
    delayMs: Math.max(explicitDelay, bossEntryDelay, bossExitGrace),
    fadeMs: request.hasCurrentVoice ? BGM_CROSSFADE_MS : BGM_FIRST_FADE_MS,
  };
}

/** Exact master x bus x cue gain, constrained only at the final output. */
export function mixedGain(master: number, bus: number, cue = 1): number {
  return clamp01(finiteOrZero(master) * finiteOrZero(bus) * finiteOrZero(cue));
}

/** Equal-power gains avoid the audible volume hole produced by linear fades. */
export function equalPowerCrossfade(
  progress: number,
  outgoingTarget: number,
  incomingTarget: number,
): { readonly outgoing: number; readonly incoming: number } {
  const p = clamp01(progress);
  const theta = p * Math.PI / 2;
  return {
    outgoing: clamp01(outgoingTarget) * Math.cos(theta),
    incoming: clamp01(incomingTarget) * Math.sin(theta),
  };
}

export interface SfxVoicePlanEntry {
  readonly key: string;
  readonly priority: number;
  readonly startedAt: number;
}

export interface SfxPlaybackRequest {
  readonly key: string;
  readonly now: number;
  readonly lastPlayedAt?: number;
  readonly minGapMs: number;
  readonly maxVoicesForKey: number;
  readonly priority: number;
  readonly bypassThrottle: boolean;
  readonly activeVoices: readonly SfxVoicePlanEntry[];
  readonly maxTotalVoices?: number;
}

export type SfxPlaybackDecision =
  | { readonly allowed: false; readonly reason: "cooldown" | "key-cap" | "pool-full" }
  | { readonly allowed: true; readonly evictIndex?: number };

/**
 * Frequent collision sounds are throttled. Critical, phase, and victory cues
 * may replace an older/lower-priority voice and are never silently discarded.
 */
export function planSfxPlayback(request: SfxPlaybackRequest): SfxPlaybackDecision {
  const elapsed = request.lastPlayedAt === undefined
    ? Number.POSITIVE_INFINITY
    : request.now - request.lastPlayedAt;
  if (!request.bypassThrottle && elapsed >= 0 && elapsed < request.minGapMs) {
    return { allowed: false, reason: "cooldown" };
  }

  const sameKeyIndices = request.activeVoices
    .map((voice, index) => ({ voice, index }))
    .filter(({ voice }) => voice.key === request.key);
  if (sameKeyIndices.length >= request.maxVoicesForKey) {
    if (!request.bypassThrottle) return { allowed: false, reason: "key-cap" };
    return { allowed: true, evictIndex: oldestVoiceIndex(sameKeyIndices) };
  }

  const maxTotal = Math.max(1, Math.floor(request.maxTotalVoices ?? MAX_SFX_VOICES));
  if (request.activeVoices.length < maxTotal) return { allowed: true };
  if (!request.bypassThrottle) return { allowed: false, reason: "pool-full" };

  const replaceable = request.activeVoices
    .map((voice, index) => ({ voice, index }))
    .filter(({ voice }) => voice.priority <= request.priority);
  return replaceable.length > 0
    ? { allowed: true, evictIndex: lowestPriorityOldestIndex(replaceable) }
    : { allowed: true };
}

function oldestVoiceIndex(
  entries: readonly { readonly voice: SfxVoicePlanEntry; readonly index: number }[],
): number {
  return entries.reduce((oldest, candidate) =>
    candidate.voice.startedAt < oldest.voice.startedAt ? candidate : oldest).index;
}

function lowestPriorityOldestIndex(
  entries: readonly { readonly voice: SfxVoicePlanEntry; readonly index: number }[],
): number {
  return entries.reduce((selected, candidate) => {
    if (candidate.voice.priority < selected.voice.priority) return candidate;
    if (candidate.voice.priority > selected.voice.priority) return selected;
    return candidate.voice.startedAt < selected.voice.startedAt ? candidate : selected;
  }).index;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteNonNegative(value: number): number {
  return Math.max(0, finiteOrZero(value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
