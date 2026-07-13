import { describe, expect, it } from "vitest";

import { HEROES } from "../../src/data";
import {
  createOraclePurchaseReward,
  decodeOraclePurchaseReward,
  DEFAULT_ORACLE_BANNER,
  DUPLICATE_FATE_DUST,
  DUPLICATE_SHARDS,
  initializeStarterRoster,
  resolveOracleSummons,
} from "../../src/core/meta";
import { createDefaultSave, type JsonObject } from "../../src/state";
import { commitPurchaseReward } from "../../src/core/services";

describe("deterministic oracle summons", () => {
  it("returns identical pulls for identical state, seed, and banner", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const first = resolveOracleSummons(save, { seed: "fixed-seed", count: 10 });
    const second = resolveOracleSummons(save, { seed: "fixed-seed", count: 10 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("summon failed");
    expect(first.pulls).toEqual(second.pulls);
    expect(first.save).toEqual(second.save);
    expect(first.pulls.some((pull) => pull.rarity >= 4)).toBe(true);
    expect(first.save.summons.oraclePulls).toBe(10);
  });

  it("round-trips the exact deterministic result through the purchase journal", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const result = resolveOracleSummons(save, { seed: "journal-retry", count: 10 });
    if (!result.ok) throw new Error(result.message);
    const reward = createOraclePurchaseReward(result);
    const restored = decodeOraclePurchaseReward(reward);
    expect(restored).toEqual({
      bannerId: result.bannerId,
      pulls: result.pulls,
      pityAfter: result.pityAfter,
      guaranteedFeaturedAfter: result.guaranteedFeaturedAfter,
    });
  });

  it.each([1, 10] as const)("commits a valid %i-pull journal exactly once", (count) => {
    const save = initializeStarterRoster(createDefaultSave());
    const purchaseId = `valid-journal-${count}`;
    const resolved = resolveOracleSummons(save, { seed: purchaseId, count });
    if (!resolved.ok) throw new Error(resolved.message);
    commitPurchaseReward({
      purchaseId,
      actionId: count === 1 ? "oracle-summon-1" : "oracle-summon-10",
      idempotencyKey: `pack:oracle-summon-${count}:${purchaseId}`,
      phase: "spent",
      createdAt: 100 + count,
      updatedAt: 101 + count,
      transactionId: `tx-${purchaseId}`,
      reward: createOraclePurchaseReward(resolved),
    }, save);

    expect(save.roster.ownedHeroIds).toEqual(resolved.save.roster.ownedHeroIds);
    expect(save.roster.heroShards).toEqual(resolved.save.roster.heroShards);
    expect(save.resources.fateDust).toBe(resolved.save.resources.fateDust);
    expect(save.summons).toMatchObject({
      oraclePulls: resolved.save.summons.oraclePulls,
      pityCount: resolved.pityAfter,
      guaranteedFeatured: resolved.guaranteedFeaturedAfter,
    });
    expect(save.summons.history).toHaveLength(count);
  });

  it("decodes legacy pending summon rewards without rerolling their heroes", () => {
    const restored = decodeOraclePurchaseReward({
      bannerId: "oracle-homecoming-v1",
      pulls: [{
        heroId: "nausi-cat",
        rarity: 4,
        featured: false,
        duplicate: false,
        storyLocked: true,
        heroGranted: false,
        shardsGranted: 25,
      }],
      pityAfter: 12,
      guaranteedFeatured: true,
    });
    expect(restored).toMatchObject({
      pulls: [{
        index: 1,
        heroId: "nausi-cat",
        rarity: 4,
        storyLocked: true,
        shardsGranted: 25,
        pityAfter: 12,
      }],
      pityAfter: 12,
      guaranteedFeaturedAfter: true,
    });
  });

  it("forces the hard-pity pull and honors the featured guarantee", () => {
    const save = initializeStarterRoster(createDefaultSave());
    save.summons.pityCount = DEFAULT_ORACLE_BANNER.hardPity - 1;
    save.summons.guaranteedFeatured = true;
    const result = resolveOracleSummons(save, { seed: "hard-pity", count: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.pulls[0]).toMatchObject({
      rarity: 5,
      heroId: DEFAULT_ORACLE_BANNER.featuredHeroId,
      featured: true,
      pityAfter: 0,
    });
    expect(result.guaranteedFeaturedAfter).toBe(false);
  });

  it("turns every duplicate into rarity-scaled hero shards and fate dust", () => {
    const save = initializeStarterRoster(createDefaultSave());
    save.roster.ownedHeroIds = HEROES.map((hero) => hero.id);
    const beforeShards = { ...save.roster.heroShards };
    const result = resolveOracleSummons(save, { seed: "duplicates", count: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.pulls.every((pull) => pull.duplicate)).toBe(true);
    for (const pull of result.pulls) {
      expect(pull.shardsGranted).toBe(DUPLICATE_SHARDS[pull.rarity]);
    }
    const granted = result.pulls.reduce((sum, pull) => sum + pull.shardsGranted, 0);
    const fateDustGranted = result.pulls.reduce((sum, pull) => sum + DUPLICATE_FATE_DUST[pull.rarity], 0);
    const stored = Object.entries(result.save.roster.heroShards).reduce(
      (sum, [heroId, shards]) => sum + shards - (beforeShards[heroId] ?? 0),
      0,
    );
    expect(stored).toBe(granted);
    expect(result.save.resources.fateDust).toBe(fateDustGranted);
    expect(JSON.stringify(result.save)).not.toMatch(/walletBalance|diamondBalance|diamonds/i);
  });

  it("commits duplicate fate dust exactly once with the purchase reward", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const duplicateHero = HEROES.find((hero) => hero.rarity === 3);
    if (!duplicateHero) throw new Error("missing three-star summon hero");
    const duplicateHeroId = duplicateHero.id;
    save.roster.ownedHeroIds.push(duplicateHeroId);
    commitPurchaseReward({
      purchaseId: "oracle-duplicate-dust",
      actionId: "oracle-summon-1",
      idempotencyKey: "pack:oracle-duplicate-dust",
      phase: "spent",
      createdAt: 200,
      updatedAt: 201,
      transactionId: "tx-duplicate-dust",
      reward: {
        // Legacy pending journals omitted banner/index/pity fields; the only
        // supported fallback is the authoritative permanent banner.
        pulls: [{
          heroId: duplicateHeroId,
          rarity: 3,
          featured: false,
          duplicate: true,
          storyLocked: false,
          shardsGranted: DUPLICATE_SHARDS[3],
        }],
        pityAfter: 1,
        guaranteedFeatured: false,
      },
    }, save);
    expect(save.resources.fateDust).toBe(DUPLICATE_FATE_DUST[3]);
  });

  it.each([
    ["wrong banner", (reward: MutableOracleReward) => { reward.bannerId = "oracle-forged"; }],
    ["wrong pull count", (reward: MutableOracleReward) => { reward.pulls = reward.pulls.slice(0, 9); }],
    ["unknown hero", (reward: MutableOracleReward) => { reward.pulls[4]!.heroId = "forged-cat"; }],
    ["catalog rarity mismatch", (reward: MutableOracleReward) => {
      const pull = reward.pulls[4]!;
      pull.rarity = pull.rarity === 5 ? 4 : 5;
    }],
    ["forged duplicate flag", (reward: MutableOracleReward) => {
      const pull = reward.pulls[4]!;
      pull.duplicate = !pull.duplicate;
    }],
    ["forged shards", (reward: MutableOracleReward) => { reward.pulls[4]!.shardsGranted = 999_999; }],
    ["out-of-bounds pity", (reward: MutableOracleReward) => { reward.pityAfter = 999_999; }],
  ])("rejects a %s without granting a valid prefix", (_label, corrupt) => {
    const save = initializeStarterRoster(createDefaultSave());
    const resolved = resolveOracleSummons(save, { seed: "tampered-ten-pull", count: 10 });
    if (!resolved.ok) throw new Error(resolved.message);
    const reward = structuredClone(createOraclePurchaseReward(resolved)) as MutableOracleReward;
    corrupt(reward);
    const before = structuredClone(save);

    expect(() => commitPurchaseReward({
      purchaseId: "tampered-ten-pull",
      actionId: "oracle-summon-10",
      idempotencyKey: "pack:oracle-summon-10:tampered-ten-pull",
      phase: "spent",
      createdAt: 300,
      updatedAt: 301,
      transactionId: "tx-tampered-ten-pull",
      reward,
    }, save)).toThrow(/Invalid oracle summon reward journal/);
    expect(save).toEqual(before);
  });

  it("rejects a forged story unlock instead of granting the hero early", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const before = structuredClone(save);
    expect(() => commitPurchaseReward({
      purchaseId: "forged-story-unlock",
      actionId: "oracle-summon-1",
      idempotencyKey: "pack:oracle-summon-1:forged-story-unlock",
      phase: "spent",
      createdAt: 302,
      updatedAt: 303,
      transactionId: "tx-forged-story-unlock",
      reward: {
        bannerId: DEFAULT_ORACLE_BANNER.id,
        pulls: [{
          index: 1,
          heroId: "nausi-cat",
          rarity: 4,
          featured: false,
          duplicate: false,
          storyLocked: false,
          heroGranted: true,
          shardsGranted: 0,
          pityBefore: 0,
          pityAfter: 1,
        }],
        pityAfter: 1,
        guaranteedFeatured: false,
      },
    }, save)).toThrow(/ownership flags/);
    expect(save).toEqual(before);
    expect(save.roster.ownedHeroIds).not.toContain("nausi-cat");
  });

  it("never acquires a story hero before its canonical join stage", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const banner = {
      ...DEFAULT_ORACLE_BANNER,
      id: "story-order-test",
      poolHeroIds: ["heli-paws", "purr-nelope", "nausi-cat", "orange-sailor"],
    };
    const result = resolveOracleSummons(save, { seed: "locked-story", count: 10, banner });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const locked = result.pulls.filter((pull) => pull.storyLocked);
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((pull) => !pull.heroGranted && pull.shardsGranted > 0)).toBe(true);
    for (const pull of locked) {
      expect(result.save.roster.ownedHeroIds).not.toContain(pull.heroId);
      expect(result.save.roster.heroShards[pull.heroId]).toBeGreaterThan(0);
    }
  });

  it("commits story-locked shards and a bounded disclosure history without granting the hero", () => {
    const save = initializeStarterRoster(createDefaultSave());
    commitPurchaseReward({
      purchaseId: "oracle-history-1",
      actionId: "oracle-summon-1",
      idempotencyKey: "pack:oracle-history-1",
      phase: "spent",
      createdAt: 123,
      updatedAt: 124,
      transactionId: "tx-history-1",
      reward: {
        bannerId: "oracle-homecoming-v1",
        pulls: [{
          heroId: "nausi-cat",
          rarity: 4,
          featured: false,
          duplicate: false,
          storyLocked: true,
          heroGranted: false,
          shardsGranted: 25,
        }],
        pityAfter: 1,
        guaranteedFeatured: false,
      },
    }, save);
    expect(save.roster.ownedHeroIds).not.toContain("nausi-cat");
    expect(save.roster.heroShards["nausi-cat"]).toBe(25);
    expect(save.summons.history).toEqual([expect.objectContaining({
      summonId: "oracle-history-1:1",
      heroId: "nausi-cat",
      duplicate: true,
    })]);
  });
});

type MutableOracleReward = JsonObject & { pulls: JsonObject[] };
