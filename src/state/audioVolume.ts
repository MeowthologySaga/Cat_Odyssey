export const AUDIO_VOLUME_KEYS = ["masterVolume", "musicVolume", "sfxVolume"] as const;

export type AudioVolumeKey = (typeof AUDIO_VOLUME_KEYS)[number];
export type RememberedAudioVolumeKey =
  | "lastNonZeroMasterVolume"
  | "lastNonZeroMusicVolume"
  | "lastNonZeroSfxVolume";

export interface AudioVolumeSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  lastNonZeroMasterVolume: number;
  lastNonZeroMusicVolume: number;
  lastNonZeroSfxVolume: number;
}

export const DEFAULT_AUDIO_VOLUMES: Readonly<Record<AudioVolumeKey, number>> = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.85,
});

const REMEMBERED_KEY_BY_VOLUME: Readonly<Record<AudioVolumeKey, RememberedAudioVolumeKey>> =
  Object.freeze({
    masterVolume: "lastNonZeroMasterVolume",
    musicVolume: "lastNonZeroMusicVolume",
    sfxVolume: "lastNonZeroSfxVolume",
  });

/**
 * Normalizes the remembered value while migrating saves that predate mute memory.
 * A currently audible channel is authoritative; a muted legacy channel restores
 * its previous remembered value when valid, otherwise the product default.
 */
export function normalizeRememberedAudioVolume(
  currentVolume: number,
  rememberedVolume: unknown,
  fallbackVolume: number,
): number {
  const current = clampVolume(currentVolume);
  if (current > 0) return current;
  const remembered = finiteNumber(rememberedVolume);
  if (remembered !== undefined && remembered > 0) return clampVolume(remembered);
  return positiveFallback(fallbackVolume);
}

/** Returns a new settings object and never mutates the caller's save snapshot. */
export function setAudioVolume<T extends AudioVolumeSettings>(
  settings: T,
  key: AudioVolumeKey,
  requestedVolume: number,
): T {
  const nextVolume = clampVolume(requestedVolume);
  const rememberedKey = REMEMBERED_KEY_BY_VOLUME[key];
  return {
    ...settings,
    [key]: nextVolume,
    ...(nextVolume > 0 ? { [rememberedKey]: nextVolume } : {}),
  };
}

/**
 * Settings-page step control. Raising a muted channel restores its actual last
 * audible value rather than replacing it with an arbitrary hard-coded level.
 */
export function adjustAudioVolume<T extends AudioVolumeSettings>(
  settings: T,
  key: AudioVolumeKey,
  delta: number,
): T {
  const current = clampVolume(settings[key]);
  if (current === 0 && delta > 0) return restoreAudioVolume(settings, key);
  return setAudioVolume(settings, key, current + finiteDelta(delta));
}

/** Shared pause/settings mute toggle for a single mixer channel. */
export function toggleAudioMute<T extends AudioVolumeSettings>(
  settings: T,
  key: AudioVolumeKey,
): T {
  return clampVolume(settings[key]) > 0
    ? setAudioVolume(settings, key, 0)
    : restoreAudioVolume(settings, key);
}

export function restoreAudioVolume<T extends AudioVolumeSettings>(
  settings: T,
  key: AudioVolumeKey,
): T {
  const remembered = settings[REMEMBERED_KEY_BY_VOLUME[key]];
  const restored = remembered > 0
    ? clampVolume(remembered)
    : DEFAULT_AUDIO_VOLUMES[key];
  return setAudioVolume(settings, key, restored);
}

function clampVolume(value: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  return Math.round(Math.min(1, Math.max(0, finite)) * 1_000) / 1_000;
}

function finiteDelta(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function positiveFallback(value: number): number {
  const fallback = clampVolume(value);
  return fallback > 0 ? fallback : 1;
}
