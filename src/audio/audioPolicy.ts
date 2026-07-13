import type { SfxKey } from "./audioAssets";

export interface SfxPlaybackPolicy {
  readonly minGapMs: number;
  readonly maxVoices: number;
  /** 0 frequent, 1 feedback, 2 critical, 3 state-changing. */
  readonly priority: 0 | 1 | 2 | 3;
  /** Priority cues replace a lower-priority voice instead of being dropped. */
  readonly bypassThrottle: boolean;
}

const DEFAULT_SFX_POLICY: SfxPlaybackPolicy = {
  minGapMs: 65,
  maxVoices: 3,
  priority: 0,
  bypassThrottle: false,
};
const SFX_POLICIES: Partial<Record<SfxKey, SfxPlaybackPolicy>> = {
  "sfx-ricochet-hit": frequent(38, 5),
  "sfx-ricochet-stone": frequent(38, 5),
  "sfx-ricochet-wood": frequent(42, 4),
  "sfx-ricochet-magic": frequent(55, 4),
  "sfx-hit-light": frequent(48, 4),
  "sfx-hit-critical": priority(90, 2, 2),
  "sfx-ui-confirm": feedback(85, 2),
  "sfx-ui-cancel": feedback(85, 2),
  "sfx-ui-error": feedback(160, 1),
  "sfx-launch-light": frequent(110, 2),
  "sfx-launch-heavy": feedback(150, 2),
  "sfx-enemy-projectile": frequent(75, 3),
  "sfx-enemy-telegraph": feedback(220, 2),
  "sfx-enemy-heavy": feedback(180, 2),
  "sfx-hero-damage": frequent(120, 2),
  "sfx-shield-block": frequent(90, 3),
  "sfx-shield-break": priority(240, 2, 2),
  "sfx-friendship-link": feedback(180, 2),
  "sfx-active-ready": feedback(600, 1),
  "sfx-active-cast": feedback(250, 2),
  "sfx-turn-player": feedback(500, 1),
  "sfx-turn-enemy": feedback(500, 1),
  "sfx-hazard-warning": feedback(420, 1),
  "sfx-boss-phase": priority(1_000, 1, 3),
  "sfx-victory": priority(1_000, 1, 3),
  "sfx-defeat": priority(1_000, 1, 3),
  "sfx-objective-success": priority(600, 1, 2),
  "sfx-objective-fail": priority(600, 1, 2),
  "sfx-reward-chest": feedback(500, 1),
  "sfx-summon-reveal": feedback(500, 1),
  "sfx-summon-rare": priority(800, 1, 2),
};

/** Resolve the anti-spam policy used by the one-shot mixer. */
export function sfxPlaybackPolicy(key: SfxKey): SfxPlaybackPolicy {
  return SFX_POLICIES[key] ?? DEFAULT_SFX_POLICY;
}

function frequent(minGapMs: number, maxVoices: number): SfxPlaybackPolicy {
  return { minGapMs, maxVoices, priority: 0, bypassThrottle: false };
}

function feedback(minGapMs: number, maxVoices: number): SfxPlaybackPolicy {
  return { minGapMs, maxVoices, priority: 1, bypassThrottle: false };
}

function priority(
  minGapMs: number,
  maxVoices: number,
  level: 2 | 3,
): SfxPlaybackPolicy {
  return { minGapMs, maxVoices, priority: level, bypassThrottle: true };
}
