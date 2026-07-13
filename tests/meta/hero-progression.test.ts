import { describe, expect, it } from "vitest";

import { HERO_BY_ID } from "../../src/data";
import {
  createBattleHeroDefinition,
  createBattlePartyDefinitions,
  getHeroCombatProfile,
  getPartyCombatPower,
  getHeroXpProgress,
  grantHeroXp,
  grantRepeatableStageRewards,
  heroXpToNextLevel,
  initializeStarterRoster,
  writeHeroLevel,
} from "../../src/core/meta";
import { createDefaultSave } from "../../src/state";

describe("hero XP progression", () => {
  it("crosses XP thresholds, carries the remainder, and reports level gains", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const threshold = heroXpToNextLevel(1);

    const almost = grantHeroXp(save, "meow-dysseus", threshold - 1);
    expect(almost.ok).toBe(true);
    if (!almost.ok) throw new Error(almost.message);
    expect(almost.receipt).toMatchObject({ level: 1, levelsGained: 0, currentXp: threshold - 1 });

    const leveled = grantHeroXp(almost.save, "meow-dysseus", 8);
    expect(leveled.ok).toBe(true);
    if (!leveled.ok) throw new Error(leveled.message);
    expect(leveled.receipt).toMatchObject({
      levelBefore: 1,
      level: 2,
      levelsGained: 1,
      currentXp: 7,
    });
    expect(getHeroXpProgress(leveled.save, "meow-dysseus")?.level).toBe(2);
  });

  it("stops at the ascension cap without deleting earned XP", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const capped = grantHeroXp(save, "meow-dysseus", 100_000);
    expect(capped.ok).toBe(true);
    if (!capped.ok) throw new Error(capped.message);
    expect(capped.receipt).toMatchObject({ level: 10, levelCap: 10, atLevelCap: true });
    expect(capped.receipt.currentXp).toBeGreaterThan(0);

    const bankedXp = capped.receipt.currentXp;
    capped.save.roster.heroAwakening["meow-dysseus"] = 1;
    const afterAscension = grantHeroXp(capped.save, "meow-dysseus", 0);
    expect(afterAscension.ok).toBe(true);
    if (!afterAscension.ok) throw new Error(afterAscension.message);
    expect(afterAscension.receipt.level).toBe(20);
    expect(afterAscension.receipt.currentXp).toBeLessThan(bankedXp);
  });

  it("turns repeatable stage XP into persistent automatic levels", () => {
    let save = initializeStarterRoster(createDefaultSave());
    let lastReceiptLevel = 1;
    for (let index = 0; index < 3; index += 1) {
      const result = grantRepeatableStageRewards(save, { stageId: "r01-s01" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      save = result.save;
      lastReceiptLevel = result.rewards.heroProgress[0]!.level;
    }
    expect(lastReceiptLevel).toBe(2);
    expect(getHeroXpProgress(save, "meow-dysseus")).toMatchObject({ level: 2, currentXp: 14 });
  });
});

describe("battle hero growth definitions", () => {
  it("applies saved level and awakening to HP, attack, and speed", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const authored = HERO_BY_ID["meow-dysseus"]!;
    writeHeroLevel(save, authored.id, 10);
    save.roster.heroAwakening[authored.id] = 2;

    const profile = getHeroCombatProfile(save, authored);
    expect(profile).toMatchObject({ level: 10, awakening: 2 });
    expect(profile.stats.hp).toBeGreaterThan(authored.stats.hp);
    expect(profile.stats.attack).toBeGreaterThan(authored.stats.attack);
    expect(profile.stats.speed).toBeGreaterThan(authored.stats.speed);

    const battleHero = createBattleHeroDefinition(save, authored);
    expect(battleHero.stats).toEqual(profile.stats);
    expect(battleHero.friendshipSkill).toBe(authored.friendshipSkill);
    expect(authored.stats).toEqual({ hp: 920, attack: 132, speed: 118 });
  });

  it("creates an ordered battle party and omits unknown or unowned ids", () => {
    const save = initializeStarterRoster(createDefaultSave());
    save.roster.ownedHeroIds.push("tele-meow-chus");
    writeHeroLevel(save, "tele-meow-chus", 4);
    const party = createBattlePartyDefinitions(save, [
      "tele-meow-chus",
      "cat-lypso",
      "missing-hero",
      "meow-dysseus",
    ]);
    expect(party.map((hero) => hero.id)).toEqual(["tele-meow-chus", "meow-dysseus"]);
    expect(party[0]!.stats.hp).toBeGreaterThan(HERO_BY_ID["tele-meow-chus"]!.stats.hp);
  });

  it("reports a party power that grows across the campaign progression curve", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const starter = getPartyCombatPower(save);
    expect(starter).toBeGreaterThanOrEqual(25);
    expect(starter).toBeLessThan(50);

    for (const heroId of save.roster.partyHeroIds) {
      save.roster.heroLevels[heroId] = 60;
      save.roster.heroAwakening[heroId] = 5;
    }
    expect(getPartyCombatPower(save)).toBeGreaterThan(starter * 10);
  });
});
