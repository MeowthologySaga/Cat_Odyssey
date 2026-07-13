import Phaser from "phaser";
import { getServices } from "../core/services";
import { BGM_ASSETS } from "./audioAssets";
import type { SfxKey } from "./audioAssets";
import {
  BGM_FIRST_FADE_MS,
  BGM_CROSSFADE_MS,
  equalPowerCrossfade,
  MAX_SFX_VOICES,
  mixedGain,
  planBgmTransition,
  planSfxPlayback,
  type BgmRole,
} from "./audioPlan";
import { sfxPlaybackPolicy } from "./audioPolicy";
import { stageBgmKey as resolveStageBgmKey, type BgmKey } from "./musicRoles";

export { stageBgmKey } from "./musicRoles";
export type { BgmKey } from "./musicRoles";
export type { SfxKey } from "./audioAssets";
export { sfxPlaybackPolicy } from "./audioPolicy";
export type { SfxPlaybackPolicy } from "./audioPolicy";
export type { BgmRole } from "./audioPlan";

export interface BgmPlaybackOptions {
  /** Boss requests receive entry delay and grant an exit grace period. */
  readonly role?: BgmRole;
  /** Optional authored delay; the larger safety delay always wins. */
  readonly delayMs?: number;
}

interface BgmVoice {
  readonly key: BgmKey;
  readonly sound: Phaser.Sound.BaseSound;
  role: BgmRole;
  targetVolume: number;
}

interface PendingBgmRequest {
  readonly id: number;
  readonly scene: Phaser.Scene;
  readonly key: BgmKey;
  readonly options: Required<Pick<BgmPlaybackOptions, "role">> & Pick<BgmPlaybackOptions, "delayMs">;
  timer?: Phaser.Time.TimerEvent;
  cleanup?: () => void;
}

interface BgmTransition {
  readonly scene: Phaser.Scene;
  readonly incoming: BgmVoice;
  readonly outgoing?: BgmVoice;
  readonly progress: { value: number };
  readonly onShutdown: () => void;
  tween?: Phaser.Tweens.Tween;
  finalized: boolean;
}

interface SfxVoice {
  readonly key: SfxKey;
  readonly sound: Phaser.Sound.BaseSound;
  readonly priority: number;
  readonly startedAt: number;
  readonly owner: Phaser.Scene;
  dispose(stopPlayback?: boolean): void;
}

interface SfxRuntimeState {
  readonly lastPlayedAt: Map<SfxKey, number>;
  readonly voices: Set<SfxVoice>;
}

interface SfxSceneState {
  readonly voices: Set<SfxVoice>;
  readonly onShutdown: () => void;
}

let currentVoice: BgmVoice | undefined;
let activeTransition: BgmTransition | undefined;
let pendingBgmRequest: PendingBgmRequest | undefined;
let nextRequestId = 1;
let managedAudioPaused = false;
const pausedByDirector = new Set<Phaser.Sound.BaseSound>();
const loadersInFlight = new WeakMap<Phaser.Loader.LoaderPlugin, Set<BgmKey>>();
const sfxStateByManager = new WeakMap<Phaser.Sound.BaseSoundManager, SfxRuntimeState>();
const sfxStateByScene = new WeakMap<Phaser.Scene, SfxSceneState>();
const managedSfxVoices = new Set<SfxVoice>();

/**
 * Request a stable game-music role. Unknown future role strings resolve through
 * the semantic stage mapper, so a missing optional music pack never breaks play.
 */
export function playBgm(
  scene: Phaser.Scene,
  requestedKey: BgmKey | string,
  options: BgmPlaybackOptions = {},
): void {
  discardInvalidCurrentVoice();
  const role = options.role ?? inferBgmRole(requestedKey);
  const key = resolvePlayableBgmKey(requestedKey, role);
  const plan = planBgmTransition({
    currentKey: currentVoice?.key,
    requestedKey: key,
    currentRole: currentVoice?.role,
    requestedRole: role,
    hasCurrentVoice: Boolean(currentVoice),
    requestedDelayMs: options.delayMs,
  });

  if (plan.action === "keep" && currentVoice) {
    cancelPendingBgmRequest();
    currentVoice.role = role;
    currentVoice.targetVolume = bgmTargetVolume(currentVoice.key);
    restoreStoppedLoop(currentVoice);
    if (activeTransition?.incoming === currentVoice) applyTransitionVolumes(activeTransition);
    else setSoundVolume(currentVoice.sound, currentVoice.targetVolume);
    return;
  }

  if (
    pendingBgmRequest?.scene === scene &&
    pendingBgmRequest.key === key &&
    pendingBgmRequest.options.role === role
  ) return;

  cancelPendingBgmRequest();
  const request: PendingBgmRequest = {
    id: nextRequestId++,
    scene,
    key,
    options: { role, ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }) },
  };
  pendingBgmRequest = request;

  if (!scene.cache.audio.exists(key)) {
    queueBgmLoad(request);
    return;
  }
  if (scene.sound.locked) {
    queueUnlockRetry(request);
    return;
  }

  if (plan.delayMs > 0) scheduleBgmStart(request, plan.delayMs);
  else {
    releasePendingBgmRequest(request);
    startBgmTransition(scene, key, role);
  }
}

/** Reapply exact master x music x authored-cue gain, including during a fade. */
export function refreshAudioSettings(_scene: Phaser.Scene): void {
  if (activeTransition) {
    activeTransition.incoming.targetVolume = bgmTargetVolume(activeTransition.incoming.key);
    if (activeTransition.outgoing) {
      activeTransition.outgoing.targetVolume = bgmTargetVolume(activeTransition.outgoing.key);
    }
    applyTransitionVolumes(activeTransition);
    return;
  }
  if (!currentVoice || currentVoice.sound.pendingRemove) return;
  currentVoice.targetVolume = bgmTargetVolume(currentVoice.key);
  setSoundVolume(currentVoice.sound, currentVoice.targetVolume);
}

/**
 * Pause only sounds owned by this director. Repeated calls are idempotent, which
 * keeps back-to-back cutscenes from incrementing an unmatched pause depth.
 */
export function pauseManagedAudio(): void {
  if (managedAudioPaused) return;
  managedAudioPaused = true;
  activeTransition?.tween?.pause();
  for (const voice of bgmVoices()) {
    if (voice.sound.isPlaying && voice.sound.pause()) pausedByDirector.add(voice.sound);
  }
  // One-shots should not resume halfway through an impact after a long movie.
  for (const voice of [...managedSfxVoices]) voice.dispose(true);
}

/** Resume only loops that pauseManagedAudio actually paused. */
export function resumeManagedAudio(): void {
  if (!managedAudioPaused) return;
  managedAudioPaused = false;
  for (const sound of [...pausedByDirector]) {
    pausedByDirector.delete(sound);
    if (!sound.pendingRemove && sound.isPaused) sound.resume();
  }
  activeTransition?.tween?.resume();
}

/**
 * Play an isolated, automatically disposed one-shot. A bounded pool permits
 * overlaps; frequent hits are rate-limited while critical state cues can evict
 * an older/lower-priority voice instead of disappearing.
 */
export function playSfx(scene: Phaser.Scene, key: SfxKey, volume = 1, rate = 1): void {
  if (managedAudioPaused || !scene.cache.audio.exists(key) || scene.sound.locked) return;

  const settings = getServices().save.getSnapshot().settings;
  const outputVolume = mixedGain(settings.masterVolume, settings.sfxVolume, volume);
  if (outputVolume <= 0) return;

  const managerState = getSfxState(scene.sound);
  pruneSfxVoices(managerState);
  const activeVoices = [...managerState.voices];
  const policy = sfxPlaybackPolicy(key);
  const now = audioClock(scene);
  const decision = planSfxPlayback({
    key,
    now,
    lastPlayedAt: managerState.lastPlayedAt.get(key),
    minGapMs: policy.minGapMs,
    maxVoicesForKey: policy.maxVoices,
    priority: policy.priority,
    bypassThrottle: policy.bypassThrottle,
    activeVoices: activeVoices.map((voice) => ({
      key: voice.key,
      priority: voice.priority,
      startedAt: voice.startedAt,
    })),
    maxTotalVoices: MAX_SFX_VOICES,
  });
  if (!decision.allowed) return;
  if (decision.evictIndex !== undefined) activeVoices[decision.evictIndex]?.dispose(true);

  let sound: Phaser.Sound.BaseSound;
  try {
    sound = scene.sound.add(key, {
      volume: outputVolume,
      rate: Math.max(0.7, Math.min(1.35, Number.isFinite(rate) ? rate : 1)),
    });
  } catch {
    return;
  }

  const sceneState = getSfxSceneState(scene);
  let disposed = false;
  let voice!: SfxVoice;
  const dispose = (stopPlayback = false): void => {
    if (disposed) return;
    disposed = true;
    sound.off(Phaser.Sound.Events.COMPLETE, onComplete);
    sound.off(Phaser.Sound.Events.STOP, onStop);
    managerState.voices.delete(voice);
    sceneState.voices.delete(voice);
    managedSfxVoices.delete(voice);
    if (sound.pendingRemove) return;
    if (stopPlayback && (sound.isPlaying || sound.isPaused)) sound.stop();
    if (!sound.pendingRemove) sound.destroy();
  };
  const onComplete = () => dispose(false);
  const onStop = () => dispose(false);
  voice = { key, sound, priority: policy.priority, startedAt: now, owner: scene, dispose };
  sound.once(Phaser.Sound.Events.COMPLETE, onComplete);
  sound.once(Phaser.Sound.Events.STOP, onStop);
  managerState.voices.add(voice);
  sceneState.voices.add(voice);
  managedSfxVoices.add(voice);

  try {
    if (!sound.play()) {
      dispose(true);
      return;
    }
    managerState.lastPlayedAt.set(key, now);
  } catch {
    dispose(true);
  }
}

function scheduleBgmStart(request: PendingBgmRequest, delayMs: number): void {
  const onShutdown = () => releasePendingBgmRequest(request);
  request.cleanup = () => request.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
  request.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
  request.timer = request.scene.time.delayedCall(delayMs, () => {
    if (pendingBgmRequest !== request) return;
    releasePendingBgmRequest(request);
    if (!request.scene.scene.isActive()) return;
    discardInvalidCurrentVoice();
    const latest = planBgmTransition({
      currentKey: currentVoice?.key,
      requestedKey: request.key,
      currentRole: currentVoice?.role,
      requestedRole: request.options.role,
      hasCurrentVoice: Boolean(currentVoice),
    });
    if (latest.action === "keep" && currentVoice) {
      currentVoice.role = request.options.role;
      currentVoice.targetVolume = bgmTargetVolume(currentVoice.key);
      restoreStoppedLoop(currentVoice);
      setSoundVolume(currentVoice.sound, currentVoice.targetVolume);
      return;
    }
    startBgmTransition(request.scene, request.key, request.options.role);
  });
}

function startBgmTransition(scene: Phaser.Scene, key: BgmKey, role: BgmRole): void {
  if (activeTransition) finalizeTransition(activeTransition);
  discardInvalidCurrentVoice();
  const outgoing = currentVoice;
  if (outgoing) outgoing.targetVolume = bgmTargetVolume(outgoing.key);
  const targetVolume = bgmTargetVolume(key);
  let sound: Phaser.Sound.BaseSound;
  try {
    sound = scene.sound.add(key, { loop: true, volume: 0 });
    if (!sound.play()) {
      safeDestroySound(sound);
      return;
    }
  } catch {
    return;
  }

  const incoming: BgmVoice = { key, sound, role, targetVolume };
  currentVoice = incoming;
  if (managedAudioPaused && sound.pause()) pausedByDirector.add(sound);

  const progress = { value: 0 };
  let transition!: BgmTransition;
  const onShutdown = () => finalizeTransition(transition);
  transition = {
    scene,
    incoming,
    ...(outgoing ? { outgoing } : {}),
    progress,
    onShutdown,
    finalized: false,
  };
  activeTransition = transition;
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
  const duration = outgoing ? BGM_CROSSFADE_MS : BGM_FIRST_FADE_MS;
  transition.tween = scene.tweens.add({
    targets: progress,
    value: 1,
    duration,
    ease: "Linear",
    onUpdate: () => applyTransitionVolumes(transition),
    onComplete: () => finalizeTransition(transition),
  });
  applyTransitionVolumes(transition);
}

function applyTransitionVolumes(transition: BgmTransition): void {
  if (transition.finalized) return;
  const gains = equalPowerCrossfade(
    transition.progress.value,
    transition.outgoing?.targetVolume ?? 0,
    transition.incoming.targetVolume,
  );
  if (transition.outgoing && !transition.outgoing.sound.pendingRemove) {
    setSoundVolume(transition.outgoing.sound, gains.outgoing);
  }
  if (!transition.incoming.sound.pendingRemove) {
    setSoundVolume(transition.incoming.sound, gains.incoming);
  }
}

function finalizeTransition(transition: BgmTransition): void {
  if (transition.finalized) return;
  transition.finalized = true;
  transition.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, transition.onShutdown);
  if (transition.tween?.isPlaying()) transition.tween.stop();
  if (transition.outgoing && transition.outgoing !== transition.incoming) {
    pausedByDirector.delete(transition.outgoing.sound);
    safeDestroySound(transition.outgoing.sound);
  }
  if (!transition.incoming.sound.pendingRemove) {
    setSoundVolume(transition.incoming.sound, transition.incoming.targetVolume);
  }
  if (activeTransition === transition) activeTransition = undefined;
}

function queueBgmLoad(request: PendingBgmRequest): void {
  const loader = request.scene.load;
  const requested = loadersInFlight.get(loader) ?? new Set<BgmKey>();
  loadersInFlight.set(loader, requested);
  const completeEvent = `${Phaser.Loader.Events.FILE_COMPLETE}-audio-${request.key}`;

  const cleanup = () => {
    loader.off(completeEvent, onComplete);
    loader.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    request.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
  };
  const onComplete = () => {
    cleanup();
    if (pendingBgmRequest !== request || !request.scene.scene.isActive()) return;
    releasePendingBgmRequest(request);
    playBgm(request.scene, request.key, request.options);
  };
  const onError = (file: Phaser.Loader.File) => {
    if (file.key !== request.key) return;
    cleanup();
    releasePendingBgmRequest(request);
  };
  const onShutdown = () => {
    cleanup();
    releasePendingBgmRequest(request);
  };
  request.cleanup = cleanup;
  loader.once(completeEvent, onComplete);
  loader.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
  request.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);

  if (!requested.has(request.key)) {
    requested.add(request.key);
    // This lifecycle listener is independent from the scene request. A scene
    // may shut down while its loader continues; the in-flight key must still be
    // released on completion/error so a later restart can retry safely.
    const clearInFlight = () => {
      requested.delete(request.key);
      loader.off(completeEvent, clearOnComplete);
      loader.off(Phaser.Loader.Events.FILE_LOAD_ERROR, clearOnError);
    };
    const clearOnComplete = () => clearInFlight();
    const clearOnError = (file: Phaser.Loader.File) => {
      if (file.key === request.key) clearInFlight();
    };
    loader.once(completeEvent, clearOnComplete);
    loader.on(Phaser.Loader.Events.FILE_LOAD_ERROR, clearOnError);
    loader.audio(request.key, BGM_ASSETS[request.key]);
    if (!loader.isLoading()) loader.start();
  }
}

function queueUnlockRetry(request: PendingBgmRequest): void {
  const resume = () => {
    cleanup();
    if (pendingBgmRequest !== request || !request.scene.scene.isActive()) return;
    releasePendingBgmRequest(request);
    playBgm(request.scene, request.key, request.options);
  };
  const cleanup = () => {
    request.scene.input.off("pointerdown", resume);
    request.scene.input.keyboard?.off("keydown", resume);
    request.scene.input.gamepad?.off("down", resume);
    request.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
  };
  const onShutdown = () => {
    cleanup();
    releasePendingBgmRequest(request);
  };
  request.cleanup = cleanup;
  request.scene.input.once("pointerdown", resume);
  request.scene.input.keyboard?.once("keydown", resume);
  request.scene.input.gamepad?.once("down", resume);
  request.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
}

function cancelPendingBgmRequest(): void {
  const request = pendingBgmRequest;
  if (!request) return;
  releasePendingBgmRequest(request);
}

function releasePendingBgmRequest(request: PendingBgmRequest): void {
  request.timer?.remove(false);
  request.timer = undefined;
  request.cleanup?.();
  request.cleanup = undefined;
  if (pendingBgmRequest === request) pendingBgmRequest = undefined;
}

function getSfxState(manager: Phaser.Sound.BaseSoundManager): SfxRuntimeState {
  const existing = sfxStateByManager.get(manager);
  if (existing) return existing;
  const created: SfxRuntimeState = { lastPlayedAt: new Map(), voices: new Set() };
  sfxStateByManager.set(manager, created);
  return created;
}

function getSfxSceneState(scene: Phaser.Scene): SfxSceneState {
  const existing = sfxStateByScene.get(scene);
  if (existing) return existing;
  let created!: SfxSceneState;
  const onShutdown = () => {
    for (const voice of [...created.voices]) voice.dispose(true);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
    sfxStateByScene.delete(scene);
  };
  created = { voices: new Set(), onShutdown };
  sfxStateByScene.set(scene, created);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
  return created;
}

function pruneSfxVoices(state: SfxRuntimeState): void {
  for (const voice of [...state.voices]) {
    if (voice.sound.pendingRemove || (!voice.sound.isPlaying && !voice.sound.isPaused)) {
      voice.dispose(false);
    }
  }
}

function discardInvalidCurrentVoice(): void {
  if (!currentVoice?.sound.pendingRemove) return;
  pausedByDirector.delete(currentVoice.sound);
  currentVoice = undefined;
}

function restoreStoppedLoop(voice: BgmVoice): void {
  if (voice.sound.pendingRemove || voice.sound.isPlaying || voice.sound.isPaused) return;
  try {
    if (!voice.sound.play()) return;
    if (managedAudioPaused && voice.sound.pause()) pausedByDirector.add(voice.sound);
  } catch {
    // The next scene request will recreate a failed backend voice.
  }
}

function bgmVoices(): BgmVoice[] {
  const voices = new Set<BgmVoice>();
  if (currentVoice) voices.add(currentVoice);
  if (activeTransition?.incoming) voices.add(activeTransition.incoming);
  if (activeTransition?.outgoing) voices.add(activeTransition.outgoing);
  return [...voices];
}

function resolvePlayableBgmKey(requestedKey: string, role: BgmRole): BgmKey {
  if (hasBgmAsset(requestedKey)) return requestedKey;
  const semanticFallback = resolveStageBgmKey(requestedKey, role === "boss");
  return hasBgmAsset(semanticFallback) ? semanticFallback : "bgm-voyage-ricochet";
}

function hasBgmAsset(key: string): key is BgmKey {
  return Object.prototype.hasOwnProperty.call(BGM_ASSETS, key);
}

function inferBgmRole(key: string): BgmRole {
  return key.toLowerCase().includes("boss") ? "boss" : "ambient";
}

function bgmTargetVolume(key: BgmKey): number {
  const settings = getServices().save.getSnapshot().settings;
  return mixedGain(settings.masterVolume, settings.musicVolume, bgmMixLevel(key));
}

function audioClock(scene: Phaser.Scene): number {
  const loopTime = scene.game.loop.time;
  return Number.isFinite(loopTime) ? loopTime : Date.now();
}

function safeDestroySound(sound: Phaser.Sound.BaseSound): void {
  if (sound.pendingRemove) return;
  if (sound.isPlaying || sound.isPaused) sound.stop();
  if (!sound.pendingRemove) sound.destroy();
}

function setSoundVolume(sound: Phaser.Sound.BaseSound, volume: number): void {
  (sound as Phaser.Sound.BaseSound & { setVolume(value: number): unknown }).setVolume(volume);
}

function bgmMixLevel(key: BgmKey): number {
  if (key === "bgm-boss-homecoming-duel") return 0.62;
  if (key === "bgm-voyage-thrinacia-sun") return 0.58;
  if (key === "bgm-endgame-oracle" || key === "bgm-oracle-summon") return 0.56;
  return 0.54;
}
