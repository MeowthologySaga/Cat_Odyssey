import { describe, expect, it } from "vitest";

import { CUTSCENE_MANIFEST } from "../../src/data/cutscenes";
import { KOREAN_CUTSCENE_SUBTITLES, cutsceneSubtitleAt } from "../../src/data/cutsceneSubtitles";

describe("localized cutscene subtitles", () => {
  it("covers all twenty episodes with ordered non-overlapping cues", () => {
    expect(Object.keys(KOREAN_CUTSCENE_SUBTITLES)).toHaveLength(20);
    for (const cutscene of CUTSCENE_MANIFEST) {
      const cues = KOREAN_CUTSCENE_SUBTITLES[cutscene.id];
      expect(cues?.length).toBeGreaterThanOrEqual(6);
      for (let index = 0; index < cues!.length; index += 1) {
        const cue = cues![index]!;
        expect(cue.start).toBeGreaterThanOrEqual(0);
        expect(cue.end).toBeGreaterThan(cue.start);
        expect(cue.text.trim().length).toBeGreaterThan(0);
        if (index > 0) expect(cue.start).toBeGreaterThanOrEqual(cues![index - 1]!.end);
      }
    }
  });

  it("uses canonical Korean names in the newly aligned overlays", () => {
    const laterText = Object.entries(KOREAN_CUTSCENE_SUBTITLES)
      .filter(([id]) => Number(id.slice(-2)) >= 12)
      .flatMap(([, cues]) => cues.map((cue) => cue.text))
      .join(" ");
    expect(laterText).toContain("먀디세우스");
    expect(laterText).toContain("텔레-묘-쿠스");
    expect(laterText).toContain("퍼-넬로페");
    expect(laterText).toContain("아-포-나");
    expect(laterText).not.toMatch(/Meowdysseus|Telemeowchus|Purrnelope|Apona|A-paw-na/u);
  });

  it("maps EP13's Korean translation to actual Candidate-D sentence boundaries", () => {
    const cues = KOREAN_CUTSCENE_SUBTITLES["cat-odyssey-ep13"]!;
    expect(cues).toHaveLength(10);
    expect(cues[0]).toMatchObject({ start: 0, end: 5 });
    expect(cues[0]?.text).toContain("사이렌을 벗어난 뒤");
    expect(cues.at(-1)!.start).toBeGreaterThanOrEqual(44);
    expect(cues.at(-1)!.end).toBeGreaterThan(cues.at(-1)!.start);
    expect(cues.at(-1)?.text).toContain("모든 생존이 승리처럼");
  });

  it("shows an accurate overlay for both language selections", () => {
    expect(cutsceneSubtitleAt("cat-odyssey-ep01", 1, "ko")).toContain("아-포-나");
    const english = cutsceneSubtitleAt("cat-odyssey-ep01", 1, "en");
    expect(english).toContain("A-paw-na");
    expect(english).not.toMatch(/[\u3131-\u318e\uac00-\ud7a3]/u);
    expect(cutsceneSubtitleAt("cat-odyssey-ep01", Number.NaN, "ko")).toBe("");
    expect(cutsceneSubtitleAt("missing", 1, "ko")).toBe("");
  });
});
