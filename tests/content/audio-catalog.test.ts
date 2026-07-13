// @ts-nocheck -- Vitest runs this Node-only asset integrity test outside the browser bundle.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BGM_ASSETS, SFX_ASSETS } from "../../src/audio/audioAssets";

type CatalogEntry = {
  id: string;
  src: string;
  durationSeconds: number;
  bytes: number;
  sha256: string;
  role: string;
  semanticFamily?: string;
  origin: {
    category: string;
    rightsStatus: string;
  };
  licenseId: string;
};

type AudioCatalog = {
  schemaVersion: number;
  bgm: CatalogEntry[];
  sfx: CatalogEntry[];
  provenanceCategories: Record<string, string>;
};

const root = process.cwd();
const catalogText = readFileSync(path.join(root, "public/assets/audio/catalog.json"), "utf8");
const catalog = JSON.parse(catalogText) as AudioCatalog;

function registryEntries(registry: Record<string, string>): [string, string][] {
  return Object.entries(registry);
}

describe("public audio catalog", () => {
  it("covers the runtime registries exactly", () => {
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.bgm.map(({ id, src }) => [id, src])).toEqual(registryEntries(BGM_ASSETS));
    expect(catalog.sfx.map(({ id, src }) => [id, src])).toEqual(registryEntries(SFX_ASSETS));
    expect(catalog.bgm).toHaveLength(16);
    expect(catalog.sfx).toHaveLength(35);
  });

  it("records the exact public bytes and hash of every shipped MP3", () => {
    for (const entry of [...catalog.bgm, ...catalog.sfx]) {
      const bytes = readFileSync(path.join(root, "public", entry.src));
      expect(bytes.length, entry.id).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), entry.id).toBe(entry.sha256);
      expect(entry.durationSeconds, entry.id).toBeGreaterThan(0);
      expect(entry.licenseId, entry.id).toBe("LicenseRef-Meowthology-Official-Builtin");
    }
  });

  it("uses only privacy-safe public provenance categories", () => {
    const bgmOrigins = catalog.bgm.map((entry) => entry.origin.category);
    expect(bgmOrigins.filter((value) => value === "suno-paid-dedicated")).toHaveLength(9);
    expect(bgmOrigins.filter((value) => value === "suno-paid-user-owned-remaster")).toHaveLength(6);
    expect(bgmOrigins.filter((value) => value === "project-owned-procedural")).toHaveLength(1);

    const sfxOrigins = catalog.sfx.map((entry) => entry.origin.category);
    expect(sfxOrigins.filter((value) => value === "suno-paid-user-owned")).toHaveLength(33);
    expect(sfxOrigins.filter((value) => value === "project-owned-procedural")).toHaveLength(2);
    for (const entry of [...catalog.bgm, ...catalog.sfx]) {
      expect(catalog.provenanceCategories[entry.origin.category], entry.id).toBeTruthy();
    }
  });

  it("does not publish account ids, source archives, production notes, or original filenames", () => {
    for (const forbidden of [
      "sunoSongId",
      "sunoSongUrl",
      "sourceArchive",
      "sourceFile",
      "sourceSha256",
      "rawSourceSlug",
      "reuseReason",
    ]) {
      expect(catalogText).not.toContain(forbidden);
    }
    expect(catalogText).not.toMatch(/https?:\/\//i);
  });

  it("never reuses an identical SFX waveform across different semantic meanings", () => {
    const byHash = new Map<string, CatalogEntry[]>();
    for (const entry of catalog.sfx) byHash.set(entry.sha256, [...(byHash.get(entry.sha256) ?? []), entry]);
    for (const group of byHash.values()) {
      expect(new Set(group.map((entry) => entry.semanticFamily)).size, group.map((entry) => entry.id).join(", ")).toBe(1);
    }
    expect(catalog.sfx.map((entry) => entry.semanticFamily).every(Boolean)).toBe(true);
  });
});
