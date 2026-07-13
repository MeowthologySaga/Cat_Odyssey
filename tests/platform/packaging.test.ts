// @ts-nocheck -- Release scripts are native Node ESM with runtime-tested exports.
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import manifest from "../../cartridge/manifest.json";
import {
  isGeneratedDevelopmentArtifact,
  sha256,
  validatePackEntries,
  withManifestIntegrity
} from "../../scripts/validate-pack.mjs";
import {
  buildDeterministicArchive,
  createReleaseFileName
} from "../../scripts/package-lem.mjs";

const REAL_THUMBNAIL = readFileSync(new URL("../../cartridge/assets/thumbnail.webp", import.meta.url));

function createValidEntries(): Map<string, Buffer> {
  const entries = new Map([
      ["manifest.json", Buffer.from(JSON.stringify(manifest), "utf8")],
      ["README.md", Buffer.from("# Test pack\n", "utf8")],
      ["security-report.md", Buffer.from("# Security Report\n", "utf8")],
      ["LICENSE", Buffer.from("MIT License\n", "utf8")],
      ["THIRD_PARTY_NOTICES.md", Buffer.from("# Third-Party Notices\n", "utf8")],
      ["ASSET_LICENSES.md", Buffer.from("# Asset Licenses\n", "utf8")],
      ["ASSET_INVENTORY.json", Buffer.from('{"assets":[]}\n', "utf8")],
      ["MEDIA_MANIFEST.json", Buffer.from('{"files":[]}\n', "utf8")],
      [
        "CUTSCENE_CREDITS.md",
        Buffer.from(
          Array.from({ length: 20 }, (_, index) =>
            `public/assets/video/cutscenes/ep${index + 1}.mp4 EP${String(index + 1).padStart(2, "0")} elevenlabs.io`
          ).join("\n"),
          "utf8"
        )
      ],
      [
        "game/index.html",
        Buffer.from(
          '<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><script type="module" src="./app.js"></script></body></html>',
          "utf8"
        )
      ],
      ["game/app.js", Buffer.from('console.log("offline");', "utf8")],
      ["game/styles.css", Buffer.from("body{margin:0}", "utf8")],
      ["game/assets/hero.webp", Buffer.from("offline-webp-fixture")],
      ["assets/thumbnail.webp", REAL_THUMBNAIL]
    ]);
  for (let episode = 1; episode <= 20; episode += 1) {
    entries.set(
      `game/assets/video/cutscenes/ep${episode}.mp4`,
      Buffer.from(`offline-mp4-fixture elevenlabs.io episode ${episode}`)
    );
  }
  return withManifestIntegrity(entries);
}

describe("LEM pack validation", () => {
  it("accepts a current-schema offline pack with exact economy parity", async () => {
    const report = await validatePackEntries(createValidEntries());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.manifest.lineageId).toBe("adb6ec88-2557-4fb2-857a-76e5c057f998");
    expect(report.manifest.sourceUrl).toBe("https://github.com/MeowthologySaga/Cat_Odyssey");
    expect(report.manifest.license).toContain("LicenseRef-Cat-Odyssey-ElevenLabs-NC-1.0");
    expect(report.assetCount).toBe(22);
  });

  it("accepts offline MP4 story cutscenes as runtime media", async () => {
    const report = await validatePackEntries(createValidEntries());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("rejects traversal, forbidden source files, and runtime network sinks", async () => {
    const entries = createValidEntries();
    entries.set("../secret.txt", Buffer.from("secret"));
    entries.set("game/src/debug.ts", Buffer.from("export {}"));
    entries.set(
      "game/index.html",
      Buffer.from('<script src="https://cdn.example.com/game.js"></script>')
    );
    const report = await validatePackEntries(withManifestIntegrity(entries));
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toMatch(/Unsafe|Forbidden/);
    expect(report.errors.join("\n")).toMatch(/external network resource/);
  });

  it("detects an asset changed after the SHA-256 list was generated", async () => {
    const entries = createValidEntries();
    entries.set("game/assets/hero.webp", Buffer.from("changed after hashing"));
    const report = await validatePackEntries(entries);
    expect(report.errors).toContain(
      "game/assets/hero.webp: manifest.integrity.files hash does not match packaged bytes."
    );
  });

  it("identifies image-generation metadata and raw sheets as development-only", () => {
    expect(isGeneratedDevelopmentArtifact("game/assets/hero/prompt-used.txt")).toBe(true);
    expect(isGeneratedDevelopmentArtifact("game/assets/hero/pipeline-meta.json")).toBe(true);
    expect(isGeneratedDevelopmentArtifact("game/assets/hero/raw-sheet-clean.webp")).toBe(true);
    expect(isGeneratedDevelopmentArtifact("game/assets/hero/final/single-1.webp")).toBe(false);
  });

  it("rejects a truncated launcher thumbnail", async () => {
    const truncated = createValidEntries();
    truncated.set("assets/thumbnail.webp", Buffer.from("RIFF"));
    const truncatedReport = await validatePackEntries(withManifestIntegrity(truncated));
    expect(truncatedReport.errors.join("\n")).toMatch(/complete, readable WebP/);
  });
});

describe("deterministic LEM archive", () => {
  it("produces identical bytes and fixed file ordering for identical inputs", async () => {
    const entries = createValidEntries();
    const first = await buildDeterministicArchive(entries);
    const second = await buildDeterministicArchive(new Map([...entries].reverse()));

    expect(first.equals(second)).toBe(true);
    expect(sha256(first)).toBe(sha256(second));

    const archive = await JSZip.loadAsync(first, { checkCRC32: true });
    const fileNames = Object.values(archive.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name);
    expect(fileNames).toEqual([...fileNames].sort());
    expect(archive.file("manifest.json")).not.toBeNull();
    expect(archive.file("LICENSE")).not.toBeNull();
    expect(archive.file("ASSET_LICENSES.md")).not.toBeNull();
    expect(archive.file("THIRD_PARTY_NOTICES.md")).not.toBeNull();
    const packedManifest = JSON.parse(await archive.file("manifest.json")!.async("string"));
    expect(packedManifest.integrity.files["game/index.html"]).toMatch(/^[0-9a-f]{64}$/);
    expect(archive.file("assets/integrity.sha256.json")).toBeNull();
  });

  it("uses a stable id and SemVer release filename", () => {
    expect(createReleaseFileName(manifest)).toBe(
      "cat-odyssey-0.1.1.lemgame"
    );
  });
});
