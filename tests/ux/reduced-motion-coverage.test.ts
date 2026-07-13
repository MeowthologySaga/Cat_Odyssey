// @ts-nocheck -- Source-integrity audit uses Node filesystem APIs outside the browser bundle.
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { describe, expect, it } from "vitest";

const sceneDirectory = new URL("../../src/scenes/", import.meta.url);
const sceneFiles = readdirSync(sceneDirectory)
  .filter((name) => extname(name) === ".ts" && name !== "BattleScene.ts")
  .map((name) => ({
    name,
    source: readFileSync(new URL(name, sceneDirectory), "utf8"),
  }));

function sceneSource(name: string): string {
  return sceneFiles.find((file) => basename(file.name) === name)?.source ?? "";
}

describe("reduced-motion coverage outside battle", () => {
  it("routes every scene camera transition through the reduced-motion helper", () => {
    for (const file of sceneFiles) {
      expect(file.source, file.name).not.toMatch(
        /cameras\.main\.(?:fadeIn|fadeOut|flash|shake|pan|zoomTo|setZoom)\s*\(/,
      );
    }
    for (const name of ["BootScene.ts", "EndgameScene.ts", "PartyScene.ts", "RewardScene.ts", "SummonScene.ts"]) {
      expect(sceneSource(name), name).toContain("fadeInScene(this");
    }
  });

  it("keeps direct tweens confined to explicitly motion-gated presentation scenes", () => {
    const directTweenFiles = sceneFiles
      .filter((file) => file.source.includes("this.tweens.add"))
      .map((file) => file.name)
      .sort();
    expect(directTweenFiles).toEqual([
      "RewardScene.ts",
      "StoryScene.ts",
      "SummonScene.ts",
      "TitleScene.ts",
    ]);

    expect(sceneSource("RewardScene.ts")).toContain("if (motion.animate)");
    expect(sceneSource("RewardScene.ts")).toContain("if (!getServices().save.getSnapshot().settings.reducedMotion)");
    expect(sceneSource("SummonScene.ts")).toContain("if (flashMotion.animate)");
    expect(sceneSource("SummonScene.ts")).toContain("if (motion.animate)");
    expect(sceneSource("SummonScene.ts")).toMatch(/if \(![^\n]*reducedMotion\)/);
    expect(sceneSource("StoryScene.ts")).toContain("if (!getServices().save.getSnapshot().settings.reducedMotion)");
    expect(sceneSource("TitleScene.ts")).toContain("if (!save.settings.reducedMotion)");
  });

  it("uses stable reduced-mode hover targets and immediate summon refreshes", () => {
    expect(sceneSource("EndgameScene.ts")).toContain("hoverScaleTarget(isReducedMotion(), hovered)");
    expect(sceneSource("HarborScene.ts")).toContain("hoverScaleTarget(isReducedMotion(), hovered, 1.035)");
    expect(sceneSource("SummonScene.ts")).toContain("summonAutoRefreshDelay(");

    const uiSource = readFileSync(new URL("../../src/ui/gameUi.ts", import.meta.url), "utf8");
    expect(uiSource).toMatch(/pointerover[\s\S]*?if \(isReducedMotion\(\)\) container\.setScale\(1\)/);
    expect(uiSource).toMatch(/pointerout[\s\S]*?if \(isReducedMotion\(\)\) container\.setScale\(1\)/);
  });
});
