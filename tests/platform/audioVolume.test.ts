import { describe, expect, it } from "vitest";

import {
  adjustAudioVolume,
  restoreAudioVolume,
  setAudioVolume,
  toggleAudioMute,
  type AudioVolumeSettings,
} from "../../src/state";

function settings(overrides: Partial<AudioVolumeSettings> = {}): AudioVolumeSettings {
  return {
    masterVolume: 0.8,
    musicVolume: 0.7,
    sfxVolume: 0.85,
    lastNonZeroMasterVolume: 0.8,
    lastNonZeroMusicVolume: 0.7,
    lastNonZeroSfxVolume: 0.85,
    ...overrides,
  };
}

describe("remembered audio volume", () => {
  it("mutes and restores the exact user-selected SFX level without mutation", () => {
    const initial = settings({ sfxVolume: 0.63, lastNonZeroSfxVolume: 0.63 });
    const muted = toggleAudioMute(initial, "sfxVolume");
    expect(muted).toMatchObject({ sfxVolume: 0, lastNonZeroSfxVolume: 0.63 });
    expect(initial).toMatchObject({ sfxVolume: 0.63, lastNonZeroSfxVolume: 0.63 });

    const restored = toggleAudioMute(muted, "sfxVolume");
    expect(restored).toMatchObject({ sfxVolume: 0.63, lastNonZeroSfxVolume: 0.63 });
  });

  it("keeps the last audible step when a settings control reaches zero", () => {
    const low = settings({ musicVolume: 0.1, lastNonZeroMusicVolume: 0.1 });
    const muted = adjustAudioVolume(low, "musicVolume", -0.1);
    expect(muted).toMatchObject({ musicVolume: 0, lastNonZeroMusicVolume: 0.1 });
    expect(adjustAudioVolume(muted, "musicVolume", 0.1)).toMatchObject({
      musicVolume: 0.1,
      lastNonZeroMusicVolume: 0.1,
    });
  });

  it("updates memory on every positive change and isolates mixer channels", () => {
    const initial = settings();
    const changed = setAudioVolume(initial, "masterVolume", 0.42);
    expect(changed).toMatchObject({
      masterVolume: 0.42,
      lastNonZeroMasterVolume: 0.42,
      musicVolume: 0.7,
      lastNonZeroMusicVolume: 0.7,
    });
  });

  it("uses the product channel default when corrupt runtime memory reaches the helper", () => {
    const corrupt = settings({ sfxVolume: 0, lastNonZeroSfxVolume: 0 });
    expect(restoreAudioVolume(corrupt, "sfxVolume").sfxVolume).toBe(0.85);
  });
});
