import {
  DEFAULT_SAVE,
  UnsupportedSaveSchemaError,
  migrateSave,
  normalizeSave
} from "../../src/state";
import { describe, expect, it } from "vitest";

describe("save schema v1", () => {
  it("migrates schema-less prototype data and drops every wallet field", () => {
    const migrated = migrateSave({
      gold: 45.9,
      diamonds: 999_999,
      walletBalance: 777,
      completedStages: ["1-1", "1-1", "1-2"],
      heroes: {
        owned: ["meow-dysseus", "a-paw-na"],
        party: ["a-paw-na"],
        xp: { "meow-dysseus": 41.8, bad: -3 },
        walletBalance: 123
      },
      materials: { "sea-ore": 2.9, broken: -4 },
      pity: 91,
      settings: { masterVolume: 4, reducedMotion: true }
    });

    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.resources.gold).toBe(45);
    expect(migrated.progress.completedStageIds).toEqual(["1-1", "1-2"]);
    expect(migrated.progress.claimedFirstClearStageIds).toEqual([]);
    expect(migrated.roster.ownedHeroIds).toEqual(["meow-dysseus", "a-paw-na"]);
    expect(migrated.roster.heroXp).toEqual({ "meow-dysseus": 41, bad: 0 });
    expect(migrated.resources.materials).toEqual({ "sea-ore": 2, broken: 0 });
    expect(migrated.summons.pityCount).toBe(80);
    expect(migrated.settings.masterVolume).toBe(1);
    expect(migrated.settings.reducedMotion).toBe(true);
    expect(migrated.settings.language).toBe("ko");
    expect(migrated.settings.textScale).toBe(100);
    expect(migrated.settings.highContrast).toBe(false);
    expect(migrated.settings.colorVision).toBe("off");
    expect(JSON.stringify(migrated)).not.toMatch(/diamonds|walletBalance/i);
  });

  it("normalizes a recoverable pending purchase and rejects malformed ones", () => {
    const normalized = normalizeSave({
      schemaVersion: 1,
      pendingPurchases: [
        {
          purchaseId: "run-4-rescue",
          actionId: "battle-rescue",
          idempotencyKey: "pack:battle-rescue:run-4-rescue",
          phase: "spent",
          transactionId: "tx-4",
          createdAt: 10,
          updatedAt: 11,
          reward: { runId: "run-4", hpRatio: 0.5 }
        },
        { purchaseId: "bad", actionId: "not-declared", phase: "spent" }
      ]
    });

    expect(normalized.pendingPurchases).toHaveLength(1);
    expect(normalized.pendingPurchases[0]).toMatchObject({
      purchaseId: "run-4-rescue",
      actionId: "battle-rescue",
      phase: "spent",
      transactionId: "tx-4"
    });
  });

  it("keeps only versioned battle rescues with frozen mode, party, and content revision", () => {
    const valid = normalizeSave({
      schemaVersion: 1,
      recovery: {
        pendingBattleRescue: {
          version: 1,
          purchaseId: "rescue-1",
          mode: "storm",
          stageId: "r04-s01",
          deployedHeroIds: ["meow-dysseus", "meow-dysseus", "a-paw-na"],
          partyDefinitions: "[]",
          contentRevision: "fnv1a32:test",
          battleSnapshot: "{}",
          hpRatio: 0.5,
          createdAt: 7,
        },
      },
    });
    expect(valid.recovery.pendingBattleRescue).toMatchObject({
      version: 1,
      mode: "storm",
      deployedHeroIds: ["meow-dysseus", "a-paw-na"],
      contentRevision: "fnv1a32:test",
    });

    const legacy = normalizeSave({
      schemaVersion: 1,
      recovery: {
        pendingBattleRescue: {
          purchaseId: "unsafe-legacy",
          stageId: "r01-s01",
          battleSnapshot: "{}",
        },
      },
    });
    expect(legacy.recovery.pendingBattleRescue).toBeNull();
  });

  it("does not silently downgrade a future schema", () => {
    expect(() => migrateSave({ schemaVersion: 2 })).toThrow(UnsupportedSaveSchemaError);
  });

  it("keeps the exported default immutable", () => {
    expect(Object.isFrozen(DEFAULT_SAVE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SAVE.resources)).toBe(true);
  });

  it("persists supported game languages and falls back safely", () => {
    expect(normalizeSave({ schemaVersion: 1, settings: { language: "en" } }).settings.language).toBe("en");
    expect(normalizeSave({ schemaVersion: 1, settings: { language: "fr" } }).settings.language).toBe("ko");
  });

  it("persists only supported enemy presentation speeds", () => {
    expect(normalizeSave({ schemaVersion: 1, settings: { enemyActionTempo: 1 } }).settings.enemyActionTempo).toBe(1);
    expect(normalizeSave({ schemaVersion: 1, settings: { enemyActionTempo: 2 } }).settings.enemyActionTempo).toBe(2);
    expect(normalizeSave({ schemaVersion: 1, settings: { enemyActionTempo: 1.25 } }).settings.enemyActionTempo).toBe(1.5);
  });

  it("migrates legacy audio settings with safe per-channel mute memory", () => {
    expect(normalizeSave({
      schemaVersion: 1,
      settings: { masterVolume: 0.35, musicVolume: 0, sfxVolume: 0 },
    }).settings).toMatchObject({
      masterVolume: 0.35,
      lastNonZeroMasterVolume: 0.35,
      musicVolume: 0,
      lastNonZeroMusicVolume: 0.7,
      sfxVolume: 0,
      lastNonZeroSfxVolume: 0.85,
    });

    expect(normalizeSave({
      schemaVersion: 1,
      settings: {
        masterVolume: 0,
        lastNonZeroMasterVolume: 0.46,
        musicVolume: 0.25,
        lastNonZeroMusicVolume: 0.9,
        sfxVolume: 0,
        lastNonZeroSfxVolume: 99,
      },
    }).settings).toMatchObject({
      lastNonZeroMasterVolume: 0.46,
      lastNonZeroMusicVolume: 0.25,
      lastNonZeroSfxVolume: 1,
    });
  });

  it("migrates accessibility settings and rejects unsupported values", () => {
    expect(normalizeSave({
      schemaVersion: 1,
      settings: { textScale: "large", highContrast: true, colorVision: "deutan" },
    }).settings).toMatchObject({
      textScale: 115,
      highContrast: true,
      colorVision: "deuteranopia",
    });
    expect(normalizeSave({
      schemaVersion: 1,
      settings: { textScale: 400, highContrast: "yes", colorVision: "unknown" },
    }).settings).toMatchObject({
      textScale: 100,
      highContrast: false,
      colorVision: "off",
    });
    expect(normalizeSave({
      schemaVersion: 1,
      settings: { textScale: 115, colorVision: "tritanopia" },
    }).settings).toMatchObject({ textScale: 115, colorVision: "tritanopia" });
  });

  it("starts new vaults at 20 slots while preserving larger legacy vaults", () => {
    expect(DEFAULT_SAVE.resources.vaultSlots).toBe(20);
    expect(normalizeSave({ schemaVersion: 1 }).resources.vaultSlots).toBe(20);
    expect(normalizeSave({ schemaVersion: 1, resources: { vaultSlots: 40 } }).resources.vaultSlots).toBe(40);
  });

  it("adds three backward-compatible party preset slots and bounds their size", () => {
    expect(DEFAULT_SAVE.roster.partyPresets).toEqual([[], [], []]);
    expect(normalizeSave({ schemaVersion: 1, roster: { partyHeroIds: ["meow-dysseus"] } }).roster.partyPresets)
      .toEqual([[], [], []]);
    expect(normalizeSave({
      schemaVersion: 1,
      roster: {
        partyPresets: [
          ["meow-dysseus", "meow-dysseus", "a-paw-na", "tele-meow-chus", "extra"],
          ["purr-nelope"],
          [],
          ["ignored-row"],
        ],
      },
    }).roster.partyPresets).toEqual([
      ["meow-dysseus", "a-paw-na", "tele-meow-chus"],
      ["purr-nelope"],
      [],
    ]);
  });

  it("never trims the non-repeatable vault entitlement from receipt history", () => {
    const purchaseReceipts = [
      { purchaseId: "vault", actionId: "vault-expansion", transactionId: "tx-vault", committedAt: 1 },
      ...Array.from({ length: 210 }, (_, index) => ({
        purchaseId: `raid-${index}`,
        actionId: "raid-extra-key",
        transactionId: `tx-raid-${index}`,
        committedAt: index + 2,
      })),
    ];
    const normalized = normalizeSave({ schemaVersion: 1, purchaseReceipts });
    expect(normalized.purchaseReceipts).toHaveLength(200);
    expect(normalized.purchaseReceipts.some((receipt) => receipt.actionId === "vault-expansion")).toBe(true);
  });

  it("migrates legacy star and hero-level meta keys into formal v1 fields", () => {
    const migrated = normalizeSave({
      schemaVersion: 1,
      progress: { stageStars: { "r01-s01": 2 } },
      roster: { ownedHeroIds: ["meow-dysseus"], heroLevels: {} },
      endgame: {
        bossAffinity: {
          "__meta:stage-stars:r01-s01": 3,
          "__meta:stage-stars:r01-s02": 2,
          "__meta:hero-level:meow-dysseus": 9,
          "scylla-cat": 4,
        },
      },
    });

    expect(migrated.progress.stageStars).toEqual({ "r01-s01": 2, "r01-s02": 2 });
    expect(migrated.roster.heroLevels).toEqual({ "meow-dysseus": 9 });
    expect(migrated.endgame.bossAffinity).toEqual({ "scylla-cat": 4 });
    expect(JSON.stringify(migrated.endgame.bossAffinity)).not.toContain("stage-stars");
    expect(JSON.stringify(migrated.endgame.bossAffinity)).not.toContain("hero-level");
  });
});
