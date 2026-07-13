import { HEROES, HERO_BY_ID, STAGES } from "../../src/data";
import {
  assessPartyPower,
  clearPartyPreset,
  queryOwnedHeroes,
  readPartyPreset,
  recommendedPowerForPartySize,
  recommendParty,
  writePartyPreset,
} from "../../src/core/meta";
import { createDefaultSave, normalizeSave } from "../../src/state";
import { describe, expect, it } from "vitest";

const breakPartsStage = STAGES.find((stage) => stage.objective.type === "break-parts")!;
const surviveStage = STAGES.find((stage) => stage.objective.type === "survive")!;

function broadRoster() {
  const save = createDefaultSave();
  save.roster.ownedHeroIds = HEROES.slice(0, 10).map((hero) => hero.id);
  save.roster.partyHeroIds = save.roster.ownedHeroIds.slice(0, 3);
  for (const heroId of save.roster.ownedHeroIds) save.roster.heroLevels[heroId] = 1;
  return save;
}

describe("commercial party tools", () => {
  it("filters the owned roster by role and element and sorts by progression", () => {
    const save = broadRoster();
    save.roster.heroLevels["tuxedo-sailor"] = 8;
    save.roster.heroLevels["tele-meow-chus"] = 3;

    const heroes = queryOwnedHeroes(save, { role: "pierce", element: "storm", level: "1-10", sort: "level" });

    expect(heroes.map((hero) => hero.id)).toEqual(["tuxedo-sailor", "tele-meow-chus"]);
    expect(heroes.every((hero) => save.roster.ownedHeroIds.includes(hero.id))).toBe(true);
    expect(queryOwnedHeroes(save, { role: "all", element: "all", level: "11-30", sort: "level" })).toEqual([]);
  });

  it("produces deterministic valid recommendations for one, two, and three heroes", () => {
    const save = broadRoster();
    for (const size of [1, 2, 3] as const) {
      const first = recommendParty(save, breakPartsStage, size);
      const second = recommendParty(save, breakPartsStage, size);
      expect(first.heroIds).toEqual(second.heroIds);
      expect(first.heroIds).toHaveLength(size);
      expect(new Set(first.heroIds).size).toBe(size);
      expect(first.heroIds.every((heroId) => save.roster.ownedHeroIds.includes(heroId))).toBe(true);
      expect(first.reasons.length).toBeGreaterThanOrEqual(2);
      expect(first.reasons.length).toBeLessThanOrEqual(3);
    }
  });

  it("excludes locked heroes and forbidden roles from recommendation", () => {
    const save = broadRoster();
    const lockedHeroId = "a-paw-na";
    const recommendation = recommendParty(save, surviveStage, 3, {
      lockedHeroIds: [lockedHeroId],
      forbiddenClasses: ["support"],
    });

    expect(recommendation.heroIds).not.toContain(lockedHeroId);
    expect(recommendation.heroIds.every((heroId) => HERO_BY_ID[heroId]?.ricochetClass !== "support")).toBe(true);
  });

  it("explains objective fit and surfaces power risk without blocking the recommendation", () => {
    const save = broadRoster();
    const recommendation = recommendParty(save, breakPartsStage, 1, {}, 99_999);

    expect(recommendation.heroIds).toHaveLength(1);
    expect(recommendation.reasons.join(" ")).toContain("부위 파괴");
    expect(recommendation.assessment.level).toBe("danger");
    expect(recommendation.reasons.join(" ")).toMatch(/고위험|부족/);
  });

  it("classifies ready, caution, danger, and unrated party power", () => {
    const save = broadRoster();
    const ids = save.roster.ownedHeroIds.slice(0, 3);
    const power = assessPartyPower(save, ids).currentPower;

    expect(assessPartyPower(save, ids).level).toBe("unrated");
    expect(assessPartyPower(save, ids, power).level).toBe("ready");
    expect(assessPartyPower(save, ids, Math.ceil(power / 0.9)).level).toBe("caution");
    expect(assessPartyPower(save, ids, power * 2).level).toBe("danger");
  });

  it("scales the authored three-hero benchmark for intentional 1-3 hero sorties", () => {
    expect(recommendedPowerForPartySize(80, 1)).toBe(27);
    expect(recommendedPowerForPartySize(80, 2)).toBe(53);
    expect(recommendedPowerForPartySize(80, 3)).toBe(80);
    expect(recommendedPowerForPartySize(80, 99)).toBe(80);
    expect(recommendedPowerForPartySize(undefined, 1)).toBeUndefined();
    expect(recommendedPowerForPartySize(0, 1)).toBeUndefined();

    const save = createDefaultSave();
    const starterPower = assessPartyPower(save, ["meow-dysseus"]).currentPower;
    const scaledFirstStagePower = recommendedPowerForPartySize(80, 1)!;
    expect(starterPower).toBeGreaterThanOrEqual(scaledFirstStagePower);
    expect(assessPartyPower(save, ["meow-dysseus"], scaledFirstStagePower).level).toBe("ready");
  });

  it("stores three presets and cleans duplicates, deleted, unowned, locked, and forbidden heroes", () => {
    let save = broadRoster();
    save = writePartyPreset(save, 1, [
      "meow-dysseus",
      "meow-dysseus",
      "tele-meow-chus",
      "a-paw-na",
      "not-a-hero",
    ]);
    expect(save.roster.partyPresets[1]).toEqual(["meow-dysseus", "tele-meow-chus", "a-paw-na"]);

    const cleaned = readPartyPreset(save, 1, {
      lockedHeroIds: ["tele-meow-chus"],
      forbiddenClasses: ["heavy"],
    });
    expect(cleaned).toEqual(["meow-dysseus"]);

    save.roster.ownedHeroIds = save.roster.ownedHeroIds.filter((heroId) => heroId !== "tele-meow-chus");
    const normalized = normalizeSave(save);
    expect(readPartyPreset(normalized, 1)).toEqual(["meow-dysseus", "a-paw-na"]);
    expect(clearPartyPreset(normalized, 1).roster.partyPresets[1]).toEqual([]);
  });
});
