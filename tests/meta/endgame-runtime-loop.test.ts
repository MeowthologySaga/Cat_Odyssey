import { describe, expect, it } from "vitest";

import { BLESSINGS, ENDGAME, ENEMY_BY_ID, HEROES, STAGE_BY_ID } from "../../src/data";
import {
  advanceScyllaAffinity,
  buildEndgameBattleOverride,
  chooseStormNodeOption,
  compileEndgameRules,
  consumeEndgameEntryCost,
  getCurrentStormNode,
  getEndgamePartyRules,
  getEndgameBattlePreview,
  getEndgameRewardPlan,
  getScyllaAffinityProgress,
  getScyllaRaidClearCount,
  getScyllaRaidRewardHeroIds,
  getStormNodeOptions,
  getStormScoreTierProgress,
  grantEndgameStageRewards,
  lockOraclePartyAfterVictory,
  prepareWeeklyStormState,
  saveScyllaRaidSquads,
  setStormRouteParty,
  STORM_REROLL_BLESSING_IDS,
  STORM_HARBOR_SUPPLY_AMOUNT,
  STORM_HARBOR_SUPPLY_MATERIAL_ID,
  STORM_HARBOR_SUPPLY_OPTION_ID,
  settleScyllaRaidPhase,
  settleStormBattleVictory,
} from "../../src/core/meta";
import { createDefaultSave, normalizeSave } from "../../src/state";

describe("typed endgame battle overrides", () => {
  it("recognizes every authored Oracle floor combat modifier", () => {
    const compilation = compileEndgameRules(ENDGAME.oracleTower.floors.flatMap((floor) => floor.modifiers));
    expect(compilation.unsupported).toEqual([]);
    expect(compilation.rules.length).toBeGreaterThanOrEqual(ENDGAME.oracleTower.floors.length);
  });

  it("compiles all thirty blessings and keeps the six active offers faithful", () => {
    const compilation = compileEndgameRules(BLESSINGS.map((blessing) => blessing.id));
    expect(BLESSINGS).toHaveLength(30);
    expect(compilation.unsupported).toEqual([]);
    expect(compilation.rules.length).toBeGreaterThanOrEqual(BLESSINGS.length);

    const save = createDefaultSave();
    save.endgame.stormRoute.active = true;
    save.endgame.stormRoute.nodeIndex = 0;
    save.endgame.stormRoute.blessingIds = [
      "athena-true-line",
      "hermes-winged-start",
      "helios-warm-ray",
      "aeolus-all-winds",
      "circe-palace-of-mirrors",
      "calypso-undying-island",
    ];
    const stage = STAGE_BY_ID["r01-s02"]!;
    const override = buildEndgameBattleOverride(save, "stormRoute", stage, HEROES.slice(0, 3), ENEMY_BY_ID);
    expect(override.previewReflections).toBe(2);
    expect(override.party[0]!.stats.speed).toBeGreaterThan(HEROES[0]!.stats.speed);
    expect(override.party[0]!.runtimeRelicEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "blessing:helios-warm-ray", kind: "regeneration", value: 8 }),
      expect.objectContaining({ sourceId: "blessing:aeolus-all-winds", kind: "precision-chain", value: 22 }),
      expect.objectContaining({ sourceId: "blessing:calypso-undying-island", kind: "first-countdown-delay", value: 1 }),
    ]));
    expect(override.stage.hazards.filter((hazard) => hazard.id.startsWith("blessing-mirror-wall-"))).toHaveLength(2);
    expect(getEndgameBattlePreview(save, "stormRoute", stage).ruleLabels).toEqual(expect.arrayContaining([
      expect.stringContaining("따뜻한 햇살"),
      expect.stringContaining("거울 궁전"),
    ]));
    expect(STORM_REROLL_BLESSING_IDS).toEqual(BLESSINGS.map((blessing) => blessing.id));
  });

  it("applies floor power and enemy HP without leaking endgame strings into core modifiers", () => {
    const save = createDefaultSave();
    const stage = STAGE_BY_ID["r01-s02"]!;
    const party = HEROES.slice(0, 3);
    const override = buildEndgameBattleOverride(save, "oracleTower", stage, party, ENEMY_BY_ID);
    expect(override.stage.recommendedPower).toBe(900);
    const enemyId = stage.enemies[0]!.enemyId;
    expect(override.enemyCatalog[enemyId]!.stats.hp).toBeGreaterThan(ENEMY_BY_ID[enemyId]!.stats.hp);
    expect(override.stage.modifiers.every((modifier) => !modifier.startsWith("enemy-hp:"))).toBe(true);
  });

  it("turns raid phases into distinct break-part battles", () => {
    const save = createDefaultSave();
    save.endgame.scyllaRaid.phaseIndex = 0;
    let override = buildEndgameBattleOverride(save, "scyllaRaid", STAGE_BY_ID["r08-s05"]!, HEROES.slice(0, 4), ENEMY_BY_ID);
    expect(override.stage.objective.targetIds).toEqual(["scylla-forepaws"]);
    expect(override.stage.objective.requiredCount).toBe(2);
    save.endgame.scyllaRaid.phaseIndex = 1;
    save.endgame.scyllaRaid.carryForward = ["broken-forepaws", "opened-safe-bumper"];
    override = buildEndgameBattleOverride(save, "scyllaRaid", STAGE_BY_ID["r08-s05"]!, HEROES.slice(4, 8), ENEMY_BY_ID);
    expect(override.stage.hazards.some((hazard) => hazard.id === "raid-safe-bumper-1")).toBe(true);
    expect(override.stage.boss?.parts.some((part) => part.id === "scylla-forepaws")).toBe(false);
    save.endgame.scyllaRaid.phaseIndex = 2;
    save.endgame.scyllaRaid.carryForward.push("staggered-head-count", "exposed-cave-body");
    override = buildEndgameBattleOverride(save, "scyllaRaid", STAGE_BY_ID["r08-s05"]!, HEROES.slice(8, 12), ENEMY_BY_ID);
    expect(override.stage.objective.targetIds).toEqual(["scylla-body"]);
    expect(override.stage.boss?.parts.find((part) => part.id === "scylla-body")).toMatchObject({ weakpoint: true, breakable: true });
    expect(override.stage.boss?.parts.some((part) => part.id === "scylla-heads" || part.id === "scylla-necks")).toBe(false);
  });

  it("writes only runtime-consumed hazard keys and applies information restrictions", () => {
    const buildFloor = (floorIndex: number, party = HEROES.slice(0, 3)) => {
      const save = createDefaultSave();
      save.endgame.oracleTowerFloor = floorIndex;
      const floor = ENDGAME.oracleTower.floors[floorIndex]!;
      return buildEndgameBattleOverride(save, "oracleTower", STAGE_BY_ID[floor.stageId]!, party, ENEMY_BY_ID);
    };

    const slow = buildFloor(1).stage.hazards.find((hazard) => hazard.type === "slow-field")!;
    expect(slow.parameters.speedMultiplier).toBeTypeOf("number");
    expect(slow.parameters).not.toHaveProperty("slowPercent");
    const bumper = buildFloor(2).stage.hazards.find((hazard) => hazard.type === "moving-bumper")!;
    expect(bumper.parameters).toMatchObject({ distance: expect.any(Number), periodTurns: expect.any(Number) });
    expect(bumper.parameters).not.toHaveProperty("speed");
    expect(bumper.parameters).not.toHaveProperty("amplitude");
    const wind = buildFloor(3).stage.hazards.find((hazard) => hazard.type === "wind-vector" || hazard.type === "current")!;
    expect(wind.parameters.forceX).toBeTypeOf("number");
    expect(wind.parameters.forceY).toBeTypeOf("number");
    const sound = buildFloor(7).stage.hazards.find((hazard) => hazard.type === "sound-wave")!;
    expect(sound.parameters).toMatchObject({ expansion: expect.any(Number), periodTurns: expect.any(Number) });
    const suction = buildFloor(8).stage.hazards.find((hazard) => hazard.type === "whirlpool")!;
    expect(suction.parameters.force).toBeTypeOf("number");

    const oneWay = buildFloor(5).stage.hazards.find((hazard) => hazard.type === "one-way-wall")!;
    expect(oneWay.parameters.rotateEachTurn).toBeGreaterThanOrEqual(90);
    expect(oneWay.parameters.allowedAngle).toBeTypeOf("number");
    const hiddenPortal = buildFloor(6).stage.hazards.filter((hazard) => hazard.type === "portal");
    expect(hiddenPortal.some((hazard) => hazard.parameters.hiddenExit === true)).toBe(true);
    expect(buildFloor(11).stage.modifiers).toContain("rear-hit-critical");
    expect(buildFloor(17).hideCrystalOrderAfterFirst).toBe(true);
    expect(buildFloor(27)).toMatchObject({ reinforcementTurn: 3, config: { reinforcementTurnOverride: 3 } });
  });

  it("turns Storm combat directives into enforced runtime or settlement behavior", () => {
    const save = createDefaultSave();
    save.endgame.stormRoute.active = true;
    save.endgame.stormRoute.nodeIndex = 10;
    const ghost = HEROES.find((hero) => hero.id === "anticleia-ghost")!;
    let override = buildEndgameBattleOverride(save, "stormRoute", STAGE_BY_ID["r04-s04"]!, [ghost, HEROES[0]!, HEROES[1]!], ENEMY_BY_ID);
    expect(override.party.find((hero) => hero.id === ghost.id)!.activeSkill.effects.some((effect) => effect.kind === "revive")).toBe(false);

    save.endgame.stormRoute.nodeIndex = 11;
    override = buildEndgameBattleOverride(save, "stormRoute", STAGE_BY_ID["r03-s05"]!, HEROES.slice(0, 3), ENEMY_BY_ID);
    expect(override.weeklyScoreEnabled).toBe(true);
    save.endgame.stormRoute.fallenHeroIds = [HEROES[0]!.id];
    expect(() => buildEndgameBattleOverride(save, "stormRoute", STAGE_BY_ID["r03-s05"]!, HEROES.slice(0, 3), ENEMY_BY_ID)).toThrow(/Fallen Storm Route hero/);
  });

  it("applies elite HP only through the runtime elite multiplier", () => {
    const save = createDefaultSave();
    save.endgame.stormRoute.active = true;
    save.endgame.stormRoute.nodeIndex = 2;
    const override = buildEndgameBattleOverride(save, "stormRoute", STAGE_BY_ID["r03-s03"]!, HEROES.slice(0, 3), ENEMY_BY_ID);
    expect(override.config.eliteHpMultiplier).toBeCloseTo(1.35 * 1.3);
    const enemyId = STAGE_BY_ID["r03-s03"]!.enemies[0]!.enemyId;
    expect(override.enemyCatalog[enemyId]!.stats.hp).toBe(ENEMY_BY_ID[enemyId]!.stats.hp);
  });
});

describe("complete Storm Route state machine", () => {
  it("walks all twelve nodes, persists choices, locks fallen heroes, and resets after the boss", () => {
    let save = prepareWeeklyStormState(createDefaultSave(), new Date("2026-07-06T00:00:00Z")).save;
    const entry = consumeEndgameEntryCost(save, "stormRoute");
    expect(entry.ok).toBe(true);
    if (!entry.ok) throw new Error(entry.message);
    save = entry.save;
    expect(getCurrentStormNode(save).index).toBe(1);

    save = settleStormBattleVictory(save, ["meow-dysseus"]).save;
    expect(save.endgame.stormRoute.fallenHeroIds).toEqual(["meow-dysseus"]);
    let choice = chooseStormNodeOption(save, "athena-true-line");
    expect(choice.ok).toBe(true);
    expect(choice.message).toBe("아-포-나의 정확한 선");
    save = choice.save;
    expect(save.endgame.stormRoute.blessingIds).toEqual(["athena-true-line"]);

    save = settleStormBattleVictory(save).save;
    choice = chooseStormNodeOption(save, "repair");
    save = choice.save;
    expect(save.endgame.stormRoute.fallenHeroIds).toEqual([]);

    save = settleStormBattleVictory(save).save;
    choice = chooseStormNodeOption(save, "short-preview");
    save = choice.save;
    expect(save.endgame.stormRoute.curseIds).toEqual(["short-preview"]);

    save = settleStormBattleVictory(save).save;
    save = chooseStormNodeOption(save, "circe-palace-of-mirrors").save;
    save = settleStormBattleVictory(save).save;
    save = chooseStormNodeOption(save, "remove-one-curse").save;
    expect(save.endgame.stormRoute.curseIds).toEqual([]);

    save = settleStormBattleVictory(save).save;
    const final = settleStormBattleVictory(save, [], 12345);
    expect(final.routeCompleted).toBe(true);
    expect(final.save.endgame.weeklyStormRuns).toBe(1);
    expect(final.save.endgame.stormRoute).toMatchObject({ active: false, nodeIndex: 0, entryPaid: false });
    expect(final.save.endgame.stormRoute.blessingIds).toEqual([]);
    expect(final.weeklyScore).toBe(12345);
  });

  it("uses a deterministic weekly two-curse offer and makes harbor swapping real", () => {
    let save = prepareWeeklyStormState(createDefaultSave(), new Date("2026-07-06T00:00:00Z")).save;
    save.roster.ownedHeroIds = HEROES.slice(0, 6).map((hero) => hero.id);
    save.roster.partyHeroIds = HEROES.slice(0, 3).map((hero) => hero.id);
    save = consumeEndgameEntryCost(save, "stormRoute").save;
    save.endgame.stormRoute.nodeIndex = 5;
    const offered = getStormNodeOptions(save);
    expect(offered).toHaveLength(2);
    expect(getStormNodeOptions(save)).toEqual(offered);
    const hidden = ENDGAME.stormRoute.nodes[5]!.pool.find((id) => !offered.includes(id))!;
    expect(chooseStormNodeOption(save, hidden).ok).toBe(false);

    save.endgame.stormRoute.nodeIndex = 3;
    const swap = chooseStormNodeOption(save, "swap-one-hero");
    expect(swap.ok).toBe(true);
    save = swap.save;
    expect(save.endgame.stormRoute.swapCharges).toBe(1);
    const changed = [HEROES[0]!.id, HEROES[1]!.id, HEROES[3]!.id];
    const applied = setStormRouteParty(save, changed);
    expect(applied.ok).toBe(true);
    expect(applied.save.endgame.stormRoute.swapCharges).toBe(0);
    const blocked = setStormRouteParty(applied.save, [HEROES[0]!.id, HEROES[3]!.id, HEROES[4]!.id]);
    expect(blocked.ok).toBe(false);
  });

  it("never advances a harbor node for a no-effect service and offers useful supplies as fallback", () => {
    const save = createDefaultSave();
    save.endgame.stormRoute.active = true;
    save.endgame.stormRoute.nodeIndex = 3;

    expect(getStormNodeOptions(save)).toEqual(["swap-one-hero"]);
    const ineffectiveRepair = chooseStormNodeOption(save, "repair");
    expect(ineffectiveRepair.ok).toBe(false);
    expect(ineffectiveRepair.save.endgame.stormRoute.nodeIndex).toBe(3);

    save.endgame.stormRoute.nodeIndex = 9;
    expect(getStormNodeOptions(save)).toEqual([STORM_HARBOR_SUPPLY_OPTION_ID]);
    const ineffectiveRevive = chooseStormNodeOption(save, "revive-one-hero");
    expect(ineffectiveRevive.ok).toBe(false);
    expect(ineffectiveRevive.save.endgame.stormRoute.nodeIndex).toBe(9);

    const supplied = chooseStormNodeOption(save, STORM_HARBOR_SUPPLY_OPTION_ID);
    expect(supplied.ok).toBe(true);
    expect(supplied.save.resources.materials[STORM_HARBOR_SUPPLY_MATERIAL_ID]).toBe(
      STORM_HARBOR_SUPPLY_AMOUNT,
    );
    expect(supplied.save.endgame.stormRoute.nodeIndex).toBe(10);
  });

  it("grants weekly Storm score tiers once per week", () => {
    let save = prepareWeeklyStormState(createDefaultSave(), new Date("2026-07-06T00:00:00Z")).save;
    save.endgame.stormRoute.active = true;
    save.endgame.stormRoute.nodeIndex = 11;
    const result = settleStormBattleVictory(save, [], 35_000);
    expect(result.scoreRewards.map((tier) => tier.score)).toEqual([2_500, 7_500, 15_000, 30_000]);
    expect(result.save.resources.gold).toBe(500);
    expect(result.save.resources.awakeningMaterials).toBe(1);
    expect(result.save.resources.relicDust).toBe(100);
    expect(result.save.resources.materials["storm-extra-entry"]).toBe(1);
    const progress = getStormScoreTierProgress(result.save);
    expect(progress.claimed).toHaveLength(4);
    expect(progress.next).toBeUndefined();
  });
});

describe("Oracle lockout and Scylla carry-forward", () => {
  it("locks an Oracle team for the authored next three floors", () => {
    let save = createDefaultSave();
    save.roster.ownedHeroIds = HEROES.map((hero) => hero.id);
    save = lockOraclePartyAfterVictory(save, HEROES.slice(0, 3).map((hero) => hero.id));
    save.endgame.oracleTowerFloor = 1;
    expect(getEndgamePartyRules(save, "oracleTower").lockedHeroIds).toEqual(expect.arrayContaining(HEROES.slice(0, 3).map((hero) => hero.id)));
    save.endgame.oracleTowerFloor = 4;
    expect(getEndgamePartyRules(save, "oracleTower").lockedHeroIds).toEqual([]);
    save.endgame.oracleTowerFloor = 29;
    save.endgame.oracleHeroLockUntilFloor[HEROES[3]!.id] = 33;
    save = lockOraclePartyAfterVictory(save, HEROES.slice(0, 3).map((hero) => hero.id));
    save.endgame.oracleTowerFloor = 30;
    expect(save.endgame.oracleHeroLockUntilFloor).toEqual({});
    expect(getEndgamePartyRules(save, "oracleTower").lockedHeroIds).toEqual([]);
  });

  it("validates 3x4 squads and only ends the run after phase three", () => {
    let save = createDefaultSave();
    save.roster.ownedHeroIds = HEROES.map((hero) => hero.id);
    save.endgame.raidKeys = 1;
    const ids = HEROES.slice(0, 12).map((hero) => hero.id);
    const squads = [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12)];
    const saved = saveScyllaRaidSquads(save, squads);
    expect(saved.ok).toBe(true);
    save = saved.save;
    const entry = consumeEndgameEntryCost(save, "scyllaRaid");
    expect(entry.ok).toBe(true);
    if (!entry.ok) throw new Error(entry.message);
    save = entry.save;
    expect(save.endgame.raidKeys).toBe(0);

    let settled = settleScyllaRaidPhase(save);
    expect(settled.raidCompleted).toBe(false);
    expect(settled.nextPhaseIndex).toBe(1);
    expect(settled.save.endgame.scyllaRaid.carryForward).toContain("broken-forepaws");
    settled = settleScyllaRaidPhase(settled.save);
    expect(settled.raidCompleted).toBe(false);
    expect(settled.nextPhaseIndex).toBe(2);
    settled = settleScyllaRaidPhase(settled.save);
    expect(settled.raidCompleted).toBe(true);
    expect(settled.save.endgame.scyllaRaid.active).toBe(false);
  });

  it("awards final raid XP to all twelve saved squad heroes", () => {
    const save = createDefaultSave();
    save.roster.ownedHeroIds = HEROES.slice(0, 12).map((hero) => hero.id);
    save.endgame.scyllaRaid.squads = [
      save.roster.ownedHeroIds.slice(0, 4),
      save.roster.ownedHeroIds.slice(4, 8),
      save.roster.ownedHeroIds.slice(8, 12),
    ];
    save.endgame.scyllaRaid.phaseIndex = 2;
    const rewardIds = getScyllaRaidRewardHeroIds(save);
    const result = grantEndgameStageRewards(save, { mode: "scyllaRaid", stageId: "r08-s05", partyHeroIds: rewardIds });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.rewards.heroXpHeroIds).toHaveLength(12);
    expect(new Set(result.rewards.heroXpHeroIds).size).toBe(12);
  });

  it("advances Scylla voyage affinity to 99 and keeps the three-step reward honest", () => {
    let save = createDefaultSave();
    const firstPlan = getEndgameRewardPlan(save, "scyllaRaid", "r08-s05");
    expect(firstPlan.label).toContain("퍼-씨 조각");
    expect(firstPlan.bonuses).toContainEqual(expect.objectContaining({ kind: "fragment", id: "purr-ce", amount: 3 }));
    let grantedLabels: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const advanced = advanceScyllaAffinity(save);
      save = advanced.save;
      grantedLabels = [...grantedLabels, ...advanced.milestones.map((milestone) => milestone.label)];
    }
    expect(getScyllaAffinityProgress(save)).toMatchObject({ level: 20, next: { level: 35 } });
    expect(save.resources.materials["scylla-scale"]).toBe(13);
    expect(save.inventory.skinIds).toContain("title:strait-bond");
    expect(grantedLabels).toContain("칭호 · 해협의 인연");
    const migrated = createDefaultSave();
    migrated.endgame.bossAffinity["scylla-cat"] = 3;
    const cycling = getEndgameRewardPlan(migrated, "scyllaRaid", "r08-s05");
    expect(cycling.bonuses).toContainEqual(expect.objectContaining({ kind: "fragment", id: "purr-ce", amount: 3 }));
  });

  it("keeps Scylla rewards rotating beyond 100 clears while affinity remains capped", () => {
    let save = createDefaultSave();
    save.endgame.bossAffinity["scylla-cat"] = 99;

    expect(getScyllaRaidClearCount(save)).toBe(99);
    let advanced = advanceScyllaAffinity(save);
    save = advanced.save;
    expect(advanced).toMatchObject({ previousClearCount: 99, clearCount: 100, level: 99 });

    for (let clearCount = 101; clearCount <= 105; clearCount += 1) {
      advanced = advanceScyllaAffinity(save);
      save = advanced.save;
      expect(advanced.clearCount).toBe(clearCount);
      expect(advanced.level).toBe(99);
      expect(advanced.milestones).toEqual([]);
    }

    expect(getScyllaRaidClearCount(save)).toBe(105);
    expect(getScyllaAffinityProgress(save).level).toBe(99);
    expect(getEndgameRewardPlan(save, "scyllaRaid", "r08-s05").bonuses).toContainEqual(
      expect.objectContaining({ kind: "fragment", id: "purr-ce", amount: 3 }),
    );
    save = advanceScyllaAffinity(save).save;
    expect(getEndgameRewardPlan(save, "scyllaRaid", "r08-s05").bonuses).toContainEqual(
      expect.objectContaining({ kind: "fragment", id: "purr-ce", amount: 5 }),
    );
    save = advanceScyllaAffinity(save).save;
    expect(getEndgameRewardPlan(save, "scyllaRaid", "r08-s05").bonuses).toContainEqual(
      expect.objectContaining({ kind: "relic", id: "relic-scylla-tooth" }),
    );
  });

  it("round-trips the formal endgame run state", () => {
    const save = createDefaultSave();
    save.endgame.stormRoute = { weekId: 202628, nodeIndex: 5, active: true, entryPaid: true, blessingIds: ["athena-true-line"], blessingOfferIds: [], blessingRerollCount: 0, curseIds: ["short-preview"], fallenHeroIds: ["meow-dysseus"], partyHeroIds: ["tele-meow-chus", "a-paw-na", "purr-nelope"], swapCharges: 1, selectedStageId: "r07-s03" };
    save.endgame.scyllaRaid = { active: true, phaseIndex: 1, squads: [["a", "b"], ["c"], ["d"]], carryForward: ["broken-forepaws"] };
    expect(normalizeSave(JSON.parse(JSON.stringify(save)))).toMatchObject({ endgame: save.endgame });
  });
});
