import { describe, expect, it } from "vitest";

import {
  ascendHero,
  getHeroProgress,
  initializeStarterRoster,
  quoteAscension,
  quoteLevelUpgrade,
  setCampaignParty,
  upgradeHeroLevel,
  validateParty,
} from "../../src/core/meta";
import { createDefaultSave, normalizeSave } from "../../src/state";

describe("roster and one-to-three-hero party", () => {
  it("keeps a fresh voyage as a valid one-hero starter party", () => {
    const save = initializeStarterRoster(createDefaultSave());
    expect(save.roster.ownedHeroIds).toEqual(["meow-dysseus"]);
    expect(save.roster.partyHeroIds).toEqual(["meow-dysseus"]);
    expect(validateParty(save, save.roster.partyHeroIds)).toEqual({
      valid: true,
      heroIds: save.roster.partyHeroIds,
      issues: [],
    });
  });

  it("accepts one to three heroes and rejects empty, oversized, duplicate, unknown, and unowned parties", () => {
    const save = initializeStarterRoster(createDefaultSave());
    save.roster.ownedHeroIds.push("tele-meow-chus", "a-paw-na");
    expect(validateParty(save, ["meow-dysseus"]).valid).toBe(true);
    expect(validateParty(save, ["meow-dysseus", "tele-meow-chus"]).valid).toBe(true);
    expect(validateParty(save, ["meow-dysseus", "tele-meow-chus", "a-paw-na"]).valid).toBe(true);
    expect(validateParty(save, []).issues.map((issue) => issue.code)).toContain(
      "party_size",
    );
    expect(validateParty(save, ["meow-dysseus", "tele-meow-chus", "a-paw-na", "cat-lypso"]).issues.map((issue) => issue.code)).toContain("party_size");
    expect(
      validateParty(save, ["meow-dysseus", "meow-dysseus"]).issues.map(
        (issue) => issue.code,
      ),
    ).toContain("duplicate_hero");
    expect(
      validateParty(save, ["meow-dysseus", "unknown"]).issues.map(
        (issue) => issue.code,
      ),
    ).toContain("unknown_hero");
    expect(
      validateParty(save, ["meow-dysseus", "cat-lypso"]).issues.map(
        (issue) => issue.code,
      ),
    ).toContain("hero_not_owned");
    expect(setCampaignParty(save, ["meow-dysseus", "unknown"])).toMatchObject({
      ok: false,
      code: "invalid_party",
    });
  });
});

describe("soft-currency upgrades", () => {
  it("levels and ascends atomically using gold, shards, and awakening materials", () => {
    const save = initializeStarterRoster(createDefaultSave());
    save.resources.gold = 100_000;
    save.resources.awakeningMaterials = 10;
    save.roster.heroShards["meow-dysseus"] = 100;

    const levelQuote = quoteLevelUpgrade(save, "meow-dysseus", 9);
    expect("gold" in levelQuote).toBe(true);
    if (!("gold" in levelQuote)) throw new Error(levelQuote.message);
    const leveled = upgradeHeroLevel(save, "meow-dysseus", 9);
    expect(leveled.ok).toBe(true);
    if (!leveled.ok) throw new Error(leveled.message);
    expect(leveled.hero.level).toBe(10);
    expect(leveled.save.resources.gold).toBe(100_000 - levelQuote.gold);

    const ascensionQuote = quoteAscension(leveled.save, "meow-dysseus");
    expect("gold" in ascensionQuote).toBe(true);
    if (!("gold" in ascensionQuote)) throw new Error(ascensionQuote.message);
    const ascended = ascendHero(leveled.save, "meow-dysseus");
    expect(ascended.ok).toBe(true);
    if (!ascended.ok) throw new Error(ascended.message);
    expect(ascended.hero.ascension).toBe(1);
    expect(ascended.hero.levelCap).toBe(20);
    expect(ascended.save.resources.gold).toBe(
      leveled.save.resources.gold - ascensionQuote.gold,
    );
    expect(ascended.save.roster.heroShards["meow-dysseus"]).toBe(
      100 - ascensionQuote.shards,
    );
  });

  it("leaves the save unchanged when gold is insufficient", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const before = JSON.stringify(save);
    const result = upgradeHeroLevel(save, "meow-dysseus", 1);
    expect(result).toMatchObject({ ok: false, code: "insufficient_gold" });
    expect(JSON.stringify(save)).toBe(before);
  });

  it("rejects non-finite and fractional level requests", () => {
    const save = initializeStarterRoster(createDefaultSave());
    expect(quoteLevelUpgrade(save, "meow-dysseus", Number.NaN)).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(quoteLevelUpgrade(save, "meow-dysseus", 1.5)).toMatchObject({ ok: false, code: "invalid_amount" });
  });

  it("persists levels and ascension through the existing v1 normalizer", () => {
    const save = initializeStarterRoster(createDefaultSave());
    save.resources.gold = 100_000;
    const result = upgradeHeroLevel(save, "meow-dysseus", 3);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const roundTrip = normalizeSave(JSON.parse(JSON.stringify(result.save)) as unknown);
    expect(getHeroProgress(roundTrip, "meow-dysseus")?.level).toBe(4);
    expect(JSON.stringify(roundTrip)).not.toMatch(/walletBalance|diamondBalance|diamonds/i);
  });
});
