// @ts-nocheck -- Vitest runs this Node-only asset integrity test outside the browser bundle.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BGM_ASSETS, SFX_ASSETS } from "../../src/audio/audioAssets";

type CatalogEntry = {
  id: string;
  src: string;
  duration: number;
  sha256: string;
  semanticFamily?: string;
  source: {
    type: string;
    project?: string;
    ownership?: string;
    sunoSongId?: string;
    rawSourceSlug?: string;
    episode?: number;
  };
};

type AudioCatalog = {
  version: number;
  bgm: CatalogEntry[];
  sfx: CatalogEntry[];
  provenance: {
    bgmPolicy: string;
    externalRuntimeBgm: string[];
    catTubeRuntimeBgm: string[];
    crossProjectRuntimeBgm: string[];
    crossProjectSfxReuseAllowed: boolean;
  };
};

const root = process.cwd();
const catalog = JSON.parse(
  readFileSync(path.join(root, "public/assets/audio/catalog.json"), "utf8"),
) as AudioCatalog;

const freshSunoIds = {
  "bgm-harbor-homeward": "f9824d81-1a37-4a22-a74d-5d06d04a1b94",
  "bgm-voyage-cyclops-cave": "3b011a1e-1bd9-418e-8d88-d373bf06acd6",
  "bgm-voyage-black-strait": "88c331d1-c73d-47b8-bf2f-af060f242456",
  "bgm-boss-homecoming-duel": "d92e81d1-5d62-45d7-a51f-30f55e23d7f1",
  "bgm-endgame-oracle": "45ba7dfe-f01b-4853-8c1e-91bcb59e11ea",
  "bgm-voyage-circe-palace": "9d16c507-b567-4c0f-87fb-d4f13d399f76",
  "bgm-voyage-thrinacia-sun": "11bf7662-9b27-4b74-9676-52c77fb576e0",
  "bgm-oracle-summon": "87af0939-a595-47b3-bd8c-1b721d39c9a8",
  "bgm-voyage-sirens": "7e58ac8a-3926-400a-9d34-fd073534e45c",
} as const;

function registryEntries(registry: Record<string, string>): [string, string][] {
  return Object.entries(registry);
}

describe("generated audio catalog", () => {
  it("covers the runtime registries exactly", () => {
    expect(catalog.version).toBe(5);
    expect(catalog.bgm.map(({ id, src }) => [id, src])).toEqual(registryEntries(BGM_ASSETS));
    expect(catalog.sfx.map(({ id, src }) => [id, src])).toEqual(registryEntries(SFX_ASSETS));
    expect(catalog.bgm).toHaveLength(16);
    expect(catalog.sfx).toHaveLength(35);
  });

  it("records the exact hash of every shipped MP3", () => {
    for (const entry of [...catalog.bgm, ...catalog.sfx]) {
      const bytes = readFileSync(path.join(root, "public", entry.src));
      expect(createHash("sha256").update(bytes).digest("hex"), entry.id).toBe(entry.sha256);
      expect(entry.duration, entry.id).toBeGreaterThan(0);
    }
  });

  it("preserves the selected fresh Suno song IDs", () => {
    const byId = new Map(catalog.bgm.map((entry) => [entry.id, entry]));
    for (const [id, songId] of Object.entries(freshSunoIds)) {
      expect(byId.get(id)?.source.sunoSongId, id).toBe(songId);
    }
  });

  it("ships only Cat Odyssey music and explicitly approved CatTube remaster episodes", () => {
    expect(catalog.provenance.bgmPolicy).toContain("CatTube remaster episodes 1-11");
    expect(catalog.provenance.externalRuntimeBgm).toEqual([]);
    expect(catalog.provenance.catTubeRuntimeBgm).toHaveLength(6);
    expect(catalog.provenance.crossProjectRuntimeBgm).toEqual([]);
    expect(catalog.provenance.crossProjectSfxReuseAllowed).toBe(true);
    for (const entry of catalog.bgm) {
      expect(
        ["suno-bgm", "deterministic-procedural-master", "cattube-remaster"],
        entry.id,
      ).toContain(entry.source.type);
      if (entry.source.type === "suno-bgm") {
        expect(entry.source.project, entry.id).toBe("Cat Odyssey");
      }
      if (entry.source.type === "cattube-remaster") {
        expect(entry.source.project, entry.id).toBe("CatTube");
        expect(entry.source.episode, entry.id).toBeGreaterThanOrEqual(1);
        expect(entry.source.episode, entry.id).toBeLessThanOrEqual(11);
      }
    }
  });

  it("documents every non-legacy SFX as user-owned cross-project Suno reuse", () => {
    const reused = catalog.sfx.filter(
      (entry) => !["sfx-ricochet-hit", "sfx-summon-reveal"].includes(entry.id),
    );
    expect(reused).toHaveLength(33);
    for (const entry of reused) {
      expect(entry.source.type, entry.id).toBe("user-owned-cross-project-suno-sfx");
      expect(entry.source.ownership, entry.id).toBe("user-owned");
      expect(entry.source.rawSourceSlug, entry.id).toBeTruthy();
    }
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
