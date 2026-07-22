// @ts-nocheck -- Release scripts are native Node ESM with runtime-tested exports.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import manifest from "../../cartridge/manifest.json";
import {
  isGeneratedDevelopmentArtifact,
  sha256,
  validatePackEntries,
  withIntegrityManifest
} from "../../scripts/validate-pack.mjs";
import {
  buildDeterministicArchive,
  createReleaseFileName
} from "../../scripts/package-lem.mjs";

function makePngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function crc32(content: Buffer): number {
  let value = 0xffffffff;
  for (const byte of content) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
}

function makeSolidPng(width: number, height: number, color: readonly [number, number, number]): Buffer {
  const stride = width * 3;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    scanlines[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      scanlines[pixel] = color[0];
      scanlines[pixel + 1] = color[1];
      scanlines[pixel + 2] = color[2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const REAL_THUMBNAIL = readFileSync(new URL("../../cartridge/assets/thumbnail.png", import.meta.url));
const REAL_ICON = readFileSync(new URL("../../cartridge/assets/icon.png", import.meta.url));

function createValidEntries(): Map<string, Buffer> {
  return withIntegrityManifest(
    new Map([
      ["manifest.json", Buffer.from(JSON.stringify(manifest), "utf8")],
      ["README.md", Buffer.from("# Test pack\n", "utf8")],
      ["security-report.md", Buffer.from("# Security Report\n", "utf8")],
      [
        "game/index.html",
        Buffer.from(
          '<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><script type="module" src="./app.js"></script></body></html>',
          "utf8"
        )
      ],
      ["game/app.js", Buffer.from('console.log("offline");', "utf8")],
      ["game/styles.css", Buffer.from("body{margin:0}", "utf8")],
      ["game/assets/hero.png", makePngHeader(512, 512)],
      ["assets/thumbnail.png", REAL_THUMBNAIL],
      ["assets/icon.png", REAL_ICON]
    ])
  );
}

describe("LEM pack validation", () => {
  it("accepts a current-schema offline pack with exact economy parity", async () => {
    const report = await validatePackEntries(createValidEntries());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.manifest.lineageId).toBe("adb6ec88-2557-4fb2-857a-76e5c057f998");
    expect(report.assetCount).toBe(4);
  });

  it("accepts offline MP4 story cutscenes as runtime media", async () => {
    const entries = createValidEntries();
    entries.set("game/assets/video/cutscenes/ep1.mp4", Buffer.from("offline-mp4-fixture"));
    const report = await validatePackEntries(withIntegrityManifest(entries));
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
    const report = await validatePackEntries(withIntegrityManifest(entries));
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toMatch(/Unsafe|Forbidden/);
    expect(report.errors.join("\n")).toMatch(/external network resource/);
  });

  it("detects an asset changed after the SHA-256 list was generated", async () => {
    const entries = createValidEntries();
    entries.set("game/assets/hero.png", Buffer.from("changed after hashing"));
    const report = await validatePackEntries(entries);
    expect(report.errors).toContain(
      "assets/integrity.sha256.json: hashes do not match packaged asset bytes."
    );
  });

  it("identifies image-generation metadata and raw sheets as development-only", () => {
    expect(isGeneratedDevelopmentArtifact("game/assets/hero/prompt-used.txt")).toBe(true);
    expect(isGeneratedDevelopmentArtifact("game/assets/hero/pipeline-meta.json")).toBe(true);
    expect(isGeneratedDevelopmentArtifact("game/assets/hero/raw-sheet-clean.png")).toBe(true);
    expect(isGeneratedDevelopmentArtifact("game/assets/hero/final/single-1.png")).toBe(false);
  });

  it("rejects truncated or visually blank launcher thumbnails", async () => {
    const truncated = createValidEntries();
    truncated.set("assets/thumbnail.png", makePngHeader(1280, 720));
    const truncatedReport = await validatePackEntries(withIntegrityManifest(truncated));
    expect(truncatedReport.errors.join("\n")).toMatch(/complete, readable/);

    const blank = createValidEntries();
    blank.set("assets/thumbnail.png", makeSolidPng(1280, 720, [0, 0, 0]));
    const blankReport = await validatePackEntries(withIntegrityManifest(blank));
    expect(blankReport.errors.join("\n")).toMatch(/blank|near-black|uniform/);
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
    expect(archive.file("assets/integrity.sha256.json")).not.toBeNull();
  });

  it("uses a stable id and SemVer release filename", () => {
    expect(createReleaseFileName(manifest)).toBe(
      `meowthology.cat-odyssey-${manifest.version}.lemgame`
    );
  });
});
