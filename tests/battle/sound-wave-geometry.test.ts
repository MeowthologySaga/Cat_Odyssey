import { describe, expect, it } from "vitest";
import {
  isSoundWaveContactSafe,
  soundWaveAngularPattern,
} from "../../src/core/battle";

const center = { x: 100, y: 100 };

describe("sound-wave angular collision and telegraph contract", () => {
  it("treats the authored rotating gap as safe and every other angle as dangerous", () => {
    const parameters = { rotatingGapDegrees: 60, gapAngle: 90 };
    expect(isSoundWaveContactSafe(center, parameters, { x: 100, y: 180 })).toBe(true);
    expect(isSoundWaveContactSafe(center, parameters, { x: 180, y: 100 })).toBe(false);
    expect(soundWaveAngularPattern(parameters).safeGap).toEqual({ centerDegrees: 90, widthDegrees: 60 });
  });

  it("uses a one-cone bite telegraph as the exact dangerous sector", () => {
    const parameters = { fanCount: 1, fanDegrees: 70, gapAngle: 90 };
    expect(isSoundWaveContactSafe(center, parameters, { x: 100, y: 180 })).toBe(false);
    expect(isSoundWaveContactSafe(center, parameters, { x: 180, y: 100 })).toBe(true);
    expect(soundWaveAngularPattern(parameters).damageFans).toEqual([
      { centerDegrees: 90, widthDegrees: 70 },
    ]);
  });

  it("compiles six evenly spaced Scylla bite fans", () => {
    const pattern = soundWaveAngularPattern({ fanCount: 6, fanDegrees: 55, gapAngle: 15 });
    expect(pattern.damageFans.map((fan) => fan.centerDegrees)).toEqual([15, 75, 135, 195, 255, 315]);
    expect(pattern.damageFans.every((fan) => fan.widthDegrees === 55)).toBe(true);
  });

  it("keeps a plain wave dangerous around the full ring", () => {
    expect(isSoundWaveContactSafe(center, {}, { x: 180, y: 100 })).toBe(false);
    expect(soundWaveAngularPattern({}).damageFans).toEqual([]);
  });
});
