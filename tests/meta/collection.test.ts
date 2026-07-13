import { describe, expect, it } from "vitest";

import { HEROES, RELICS, ROUTES, STAGES } from "../../src/data";
import {
  formatCollectionLastPlayed,
  getHeroCollection,
  getRelicCollection,
  getRouteCollection,
  getTitleCollection,
  getVoyageCollectionSummary,
  selectTitle,
  STORM_WEEKLY_SCORE_KEY,
  TITLE_CATALOG,
} from "../../src/core/meta";
import { createDefaultSave } from "../../src/state";

describe("save-derived collection catalog", () => {
  it("hides locked hero spoilers while exposing complete owned hero combat identity", () => {
    const save = createDefaultSave();
    save.roster.ownedHeroIds.push("tele-meow-chus");
    save.roster.heroLevels["tele-meow-chus"] = 8;
    save.roster.heroAwakening["tele-meow-chus"] = 1;

    const heroes = getHeroCollection(save);
    expect(heroes).toHaveLength(HEROES.length);
    expect(heroes.find((hero) => hero.id === "tele-meow-chus")).toMatchObject({
      owned: true,
      name: "텔레-묘-쿠스",
      level: 8,
      awakening: 1,
      role: expect.stringContaining("관통형"),
      friendshipName: expect.any(String),
      activeName: expect.any(String),
      activeChargeTurns: expect.any(Number),
    });
    const locked = heroes.find((hero) => !hero.owned)!;
    expect(locked.name).toMatch(/^미확인 선원/);
    expect(locked.rarity).toBeUndefined();
    expect(locked.friendshipName).toBeUndefined();
    expect(locked.activeName).toBeUndefined();
  });

  it("lists all 32 relics and derives ownership, level, effects, and loadout state", () => {
    const save = createDefaultSave();
    const relic = RELICS[0]!;
    save.inventory.relicIds = [relic.id];
    save.inventory.equippedRelicIds = [relic.id];
    save.inventory.relicLevels[relic.id] = 4;

    const entries = getRelicCollection(save);
    expect(entries).toHaveLength(32);
    expect(entries.find((entry) => entry.id === relic.id)).toMatchObject({
      owned: true,
      equipped: true,
      level: 4,
      name: relic.name,
      effectSummary: expect.stringContaining("약점 피해"),
    });
    const locked = entries.find((entry) => !entry.owned)!;
    expect(locked.name).toMatch(/^미확인 유물/);
    expect(locked.effectSummary).toBeUndefined();
  });

  it("derives all 43 stage records, route progress, bosses, and endgame records", () => {
    const save = createDefaultSave();
    save.progress.completedStageIds = ["r01-s01", "r01-s04"];
    save.progress.stageStars = { "r01-s01": 3, "r01-s04": 2 };
    save.records = { wins: 7, losses: 2, bestRicochetChain: 11, totalDamage: 123_456, lastPlayedAt: Date.UTC(2026, 6, 12) };
    save.endgame.oracleTowerFloor = 9;
    save.endgame.weeklyStormRuns = 2;
    save.endgame.bossAffinity[STORM_WEEKLY_SCORE_KEY] = 7_500;
    save.endgame.bossAffinity["scylla-cat"] = 20;
    save.endgame.scyllaRaid.active = true;
    save.endgame.scyllaRaid.phaseIndex = 1;

    const routes = getRouteCollection(save);
    expect(routes).toHaveLength(ROUTES.length);
    expect(routes.flatMap((route) => route.stages)).toHaveLength(STAGES.length);
    expect(routes[0]).toMatchObject({
      completedStages: 2,
      stars: 5,
      bossDefeated: true,
      biome: "햇살 드는 섬과 폭풍 해안",
      signatureMechanic: "이동 범퍼 · 파도 해류",
    });
    expect(routes[1]).toMatchObject({ unlocked: false, name: "미해금 항로 02" });
    expect(routes[1]!.stages.every((stage) => stage.name === "미확인 해역")).toBe(true);

    const summary = getVoyageCollectionSummary(save);
    expect(summary).toMatchObject({
      completedStages: 2,
      stars: 5,
      wins: 7,
      losses: 2,
      bestRicochetChain: 11,
      oracleFloor: 9,
      weeklyStormRuns: 2,
      weeklyStormScore: 7_500,
      scyllaAffinity: 20,
      raidActive: true,
      raidPhase: 2,
    });
    expect(summary.defeatedBossNames).toHaveLength(1);
    expect(summary.starMilestones[0]).toMatchObject({
      requiredStars: 30,
      currentStars: 5,
      remainingStars: 25,
      reached: false,
      claimed: false,
    });
    expect(formatCollectionLastPlayed(summary.lastPlayedAt)).toBe("2026.07.12");
    expect(formatCollectionLastPlayed(0)).toBe("아직 항해 기록 없음");
  });

  it("shows canonical title conditions and uses the existing safe equip path", () => {
    const save = createDefaultSave();
    save.inventory.skinIds.push("title:strait-bond");
    let titles = getTitleCollection(save);
    expect(titles).toHaveLength(TITLE_CATALOG.length);
    expect(titles.find((title) => title.id === "title:strait-bond")).toMatchObject({
      owned: true,
      selected: false,
      unlockCondition: "스킬라 항해 인연 20 달성",
    });
    const equipped = selectTitle(save, "title:strait-bond");
    titles = getTitleCollection(equipped);
    expect(titles.find((title) => title.id === "title:strait-bond")?.selected).toBe(true);
    expect(selectTitle(equipped, null).inventory.selectedTitleId).toBeNull();
  });
});
