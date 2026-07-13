export interface SummonFlashMotionPlan {
  readonly animate: boolean;
  readonly initialAlpha: number;
  readonly initialScale: number;
  readonly targetAlpha: number;
  readonly targetScale: number;
  readonly duration: number;
  readonly yoyo: boolean;
}

export interface SummonCardMotionPlan {
  readonly animate: boolean;
  readonly initialScale: number;
  readonly duration: number;
  readonly delay: number;
}

/** A flash ends transparent, so reduced motion skips the flash altogether. */
export function summonFlashMotionPlan(reducedMotion: boolean): SummonFlashMotionPlan {
  return reducedMotion
    ? {
        animate: false,
        initialAlpha: 0,
        initialScale: 8,
        targetAlpha: 0,
        targetScale: 8,
        duration: 0,
        yoyo: false,
      }
    : {
        animate: true,
        initialAlpha: 0,
        initialScale: 8,
        targetAlpha: 0.8,
        targetScale: 11,
        duration: 360,
        yoyo: true,
      };
}

/** Cards appear at their final size immediately when motion is reduced. */
export function summonCardMotionPlan(reducedMotion: boolean, index: number): SummonCardMotionPlan {
  return reducedMotion
    ? { animate: false, initialScale: 1, duration: 0, delay: 0 }
    : {
        animate: true,
        initialScale: 0,
        duration: 370,
        delay: 160 + Math.max(0, Math.floor(index)) * 85,
      };
}

/** Hover emphasis remains visually stable instead of jumping in reduced mode. */
export function hoverScaleTarget(
  reducedMotion: boolean,
  hovered: boolean,
  emphasizedScale = 1.1,
): number {
  return reducedMotion ? 1 : hovered ? emphasizedScale : 1;
}

/** Saved summon state can refresh immediately without a cinematic wait. */
export function summonAutoRefreshDelay(reducedMotion: boolean, standardDelay: number): number {
  return reducedMotion ? 0 : Math.max(0, Math.floor(standardDelay));
}
