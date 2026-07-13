import { describe, expect, it } from "vitest";
import { BGM_ASSETS, BOOT_BGM_KEYS, SFX_ASSETS, type SfxKey } from "../../src/audio/audioAssets";
import { sfxPlaybackPolicy } from "../../src/audio/audioPolicy";

describe("audio asset registry", () => {
  it("uses stable key-derived filenames for every SFX", () => {
    for (const [key, source] of Object.entries(SFX_ASSETS)) {
      expect(source).toBe(`assets/audio/sfx/${key.replace(/^sfx-/, "")}.mp3`);
    }
  });

  it("boot-loads only the hub cue and streams the rest on demand", () => {
    expect(BOOT_BGM_KEYS).toEqual(["bgm-harbor-homeward"]);
    expect(Object.keys(BGM_ASSETS).length).toBeGreaterThan(BOOT_BGM_KEYS.length);
  });

  it("gives all one-shots a positive cooldown and finite voice cap", () => {
    for (const key of Object.keys(SFX_ASSETS) as SfxKey[]) {
      const policy = sfxPlaybackPolicy(key);
      expect(policy.minGapMs).toBeGreaterThan(0);
      expect(policy.maxVoices).toBeGreaterThanOrEqual(1);
      expect(policy.maxVoices).toBeLessThanOrEqual(5);
    }
  });

  it("limits major cues more aggressively than frequent ricochets", () => {
    expect(sfxPlaybackPolicy("sfx-boss-phase").maxVoices).toBe(1);
    expect(sfxPlaybackPolicy("sfx-boss-phase").minGapMs)
      .toBeGreaterThan(sfxPlaybackPolicy("sfx-ricochet-stone").minGapMs);
    expect(sfxPlaybackPolicy("sfx-boss-phase").priority).toBe(3);
    expect(sfxPlaybackPolicy("sfx-victory").bypassThrottle).toBe(true);
    expect(sfxPlaybackPolicy("sfx-hit-critical").priority)
      .toBeGreaterThan(sfxPlaybackPolicy("sfx-hit-light").priority);
  });
});
