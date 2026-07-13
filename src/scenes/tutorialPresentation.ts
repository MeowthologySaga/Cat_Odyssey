export interface TutorialLayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Fixed logical-space contract used by Phaser.Scale.FIT at every viewport. */
export const TUTORIAL_PREP_LAYOUT = Object.freeze({
  logicalWidth: 720,
  logicalHeight: 1280,
  progress: { x: 90, y: 132, width: 540, height: 10 },
  demoPanel: { x: 54, y: 300, width: 612, height: 466 },
  copyPanel: { x: 54, y: 792, width: 612, height: 178 },
  primaryButton: { x: 170, y: 1038, width: 380, height: 76 },
  skipButton: { x: 210, y: 1142, width: 300, height: 58 },
  safeBottom: 1240,
} as const satisfies Readonly<Record<string, number | TutorialLayoutRect>>);

