// @ts-nocheck -- This source-integrity test uses Node filesystem APIs outside the browser bundle.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FIXED_PIXEL_FONT_ALLOWLIST = new Set([
  // Intentionally empty. Add only an exact `Scene.ts:fontSize...` source line
  // when a fixed pixel size is an audited, player-facing accessibility exception.
]);

describe("Phaser scene text-scale coverage", () => {
  it("does not let scenes bypass the text-scale setting with fixed px fonts", () => {
    const scenesDirectory = new URL("../../src/scenes/", import.meta.url);
    const offenders = [];
    for (const fileName of readdirSync(scenesDirectory).filter((name) => name.endsWith("Scene.ts"))) {
      const source = readFileSync(new URL(fileName, scenesDirectory), "utf8");
      source.split(/\r?\n/u).forEach((line, index) => {
        if (!/fontSize\s*:[^\r\n]*(?:["'`]\d+px["'`])/u.test(line)) return;
        const key = `${fileName}:${line.trim()}`;
        if (!FIXED_PIXEL_FONT_ALLOWLIST.has(key)) offenders.push(`${fileName}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
