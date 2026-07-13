import { describe, expect, it } from "vitest";
import { HEROES } from "../../src/data";
import {
  beginBattleRewardTicket,
  consumeEndgameEntryCost,
  getStormNodeStageId,
  prepareEndgameVictorySettlement,
  readPendingBattleRewardTicket,
  readPendingEndgameVictorySettlement,
  saveScyllaRaidSquads,
  setStormRouteParty,
  settlePendingEndgameVictory,
} from "../../src/core/meta";
import { resolvePendingVoyageRecoveryDestination } from "../../src/core/uxFlow";
import { createDefaultSave, normalizeSave, type GameSaveV1 } from "../../src/state";

const WON_AT = 1_777_777;

function prepareOracle(): ReturnType<typeof prepareEndgameVictorySettlement> {
  const started = beginBattleRewardTicket(createDefaultSave(), "r01-s02", "oracleTower");
  if (!started.ok) throw new Error(started.message);
  return prepareEndgameVictorySettlement(started.save, {
    mode: "oracleTower",
    stageId: "r01-s02",
    stars: 3,
    turns: 5,
    bestCombo: 4,
    totalDamage: 321,
    hpRatio: 0.75,
    partyHeroIds: ["meow-dysseus"],
    fallenHeroIds: [],
  }, WON_AT);
}

function createStormBattle(): { save: GameSaveV1; stageId: string; party: string[] } {
  let save = createDefaultSave();
  const party = HEROES.slice(0, 3).map((hero) => hero.id);
  save.roster.ownedHeroIds = [...new Set([...save.roster.ownedHeroIds, ...party])];
  save.roster.partyHeroIds = [...party];
  save.endgame.stormRoute.weekId = 202630;
  const entered = consumeEndgameEntryCost(save, "stormRoute");
  if (!entered.ok) throw new Error(entered.message);
  save = entered.save;
  const selected = setStormRouteParty(save, party);
  if (!selected.ok) throw new Error(selected.message);
  save = selected.save;
  const stageId = getStormNodeStageId(save)!;
  const started = beginBattleRewardTicket(save, stageId, "stormRoute");
  if (!started.ok) throw new Error(started.message);
  return { save: started.save, stageId, party };
}

function createRaid(): { save: GameSaveV1; squads: string[][] } {
  let save = createDefaultSave();
  const heroIds = HEROES.slice(0, 12).map((hero) => hero.id);
  expect(heroIds).toHaveLength(12);
  save.roster.ownedHeroIds = [...new Set([...save.roster.ownedHeroIds, ...heroIds])];
  save.endgame.raidKeys = 1;
  const squads = [heroIds.slice(0, 4), heroIds.slice(4, 8), heroIds.slice(8, 12)];
  const configured = saveScyllaRaidSquads(save, squads);
  if (!configured.ok) throw new Error(configured.message);
  const entered = consumeEndgameEntryCost(configured.save, "scyllaRaid");
  if (!entered.ok) throw new Error(entered.message);
  return { save: entered.save, squads };
}

function winRaidPhase(save: GameSaveV1, party: readonly string[], damage = 250) {
  const started = beginBattleRewardTicket(save, "r08-s05", "scyllaRaid");
  if (!started.ok) throw new Error(started.message);
  const prepared = prepareEndgameVictorySettlement(started.save, {
    mode: "scyllaRaid",
    stageId: "r08-s05",
    stars: 2,
    turns: 8,
    bestCombo: 3,
    totalDamage: damage,
    hpRatio: 0.6,
    partyHeroIds: party,
    fallenHeroIds: [],
  }, WON_AT + started.ticket.token);
  if (!prepared.ok) throw new Error(prepared.message);
  return prepared;
}

describe("durable endgame victory settlement", () => {
  it("survives a serialized restart and settles an Oracle reward exactly once", () => {
    const prepared = prepareOracle();
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const restarted = normalizeSave(JSON.parse(JSON.stringify(prepared.save)));
    expect(readPendingEndgameVictorySettlement(restarted)).toEqual(prepared.settlement);
    expect(beginBattleRewardTicket(restarted, "r01-s01", "campaign")).toMatchObject({
      ok: false,
      code: "pending_victory_settlement",
    });
    expect(resolvePendingVoyageRecoveryDestination(restarted)).toMatchObject({
      sceneKey: "Reward",
      data: { stageId: "r01-s02", endgameMode: "oracleTower" },
    });

    const settled = settlePendingEndgameVictory(restarted);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.save.endgame.oracleTowerFloor).toBe(1);
    expect(settled.save.records).toMatchObject({
      wins: 1,
      bestRicochetChain: 4,
      totalDamage: 321,
      lastPlayedAt: WON_AT,
    });
    expect(settled.save.recovery.pendingEndgameVictorySettlement).toBeNull();
    expect(readPendingBattleRewardTicket(settled.save, "r01-s02", "oracleTower")).toBeUndefined();

    const duplicate = settlePendingEndgameVictory(settled.save);
    expect(duplicate).toMatchObject({ ok: false, code: "settlement_missing" });
    expect(duplicate.save.resources).toEqual(settled.save.resources);
    expect(duplicate.save.endgame.oracleTowerFloor).toBe(1);
  });

  it("freezes the Storm node party and ignores scene attempts to opt into weekly score", () => {
    const battle = createStormBattle();
    const prepared = prepareEndgameVictorySettlement(battle.save, {
      mode: "stormRoute",
      stageId: battle.stageId,
      stars: 2,
      turns: 7,
      bestCombo: 2,
      totalDamage: 999,
      hpRatio: 0.5,
      partyHeroIds: battle.party,
      fallenHeroIds: [battle.party[2]!],
      weeklyScoreEnabled: true,
    }, WON_AT);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    // Storm node 1 does not author the weekly score rule.
    expect(prepared.settlement.weeklyScoreEnabled).toBe(false);

    const settled = settlePendingEndgameVictory(prepared.save);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.save.endgame.stormRoute.fallenHeroIds).toContain(battle.party[2]);
    expect(settled.save.endgame.stormRoute.nodeIndex).toBe(1);
    expect(settled.save.endgame.bossAffinity["__meta:storm-weekly-score"] ?? 0).toBe(0);
  });

  it("commits each intermediate Scylla phase once and resumes the next squad after a crash", () => {
    const raid = createRaid();
    const phaseOne = winRaidPhase(raid.save, raid.squads[0]!);
    const restarted = normalizeSave(JSON.parse(JSON.stringify(phaseOne.save)));
    const settledOne = settlePendingEndgameVictory(restarted);
    expect(settledOne.ok).toBe(true);
    if (!settledOne.ok) return;
    expect(settledOne.raidNextPhase).toBe(1);
    expect(settledOne.save.endgame.scyllaRaid).toMatchObject({ active: true, phaseIndex: 1 });
    expect(settledOne.save.records.wins).toBe(1);

    expect(settlePendingEndgameVictory(settledOne.save)).toMatchObject({
      ok: false,
      code: "settlement_missing",
    });
    const phaseTwo = winRaidPhase(settledOne.save, raid.squads[1]!);
    const settledTwo = settlePendingEndgameVictory(phaseTwo.save);
    expect(settledTwo.ok).toBe(true);
    if (!settledTwo.ok) return;
    expect(settledTwo.raidNextPhase).toBe(2);
    expect(settledTwo.save.endgame.scyllaRaid.phaseIndex).toBe(2);

    const phaseThree = winRaidPhase(settledTwo.save, raid.squads[2]!, 700);
    const settledThree = settlePendingEndgameVictory(phaseThree.save);
    expect(settledThree.ok).toBe(true);
    if (!settledThree.ok) return;
    expect(settledThree.raidNextPhase).toBeUndefined();
    expect(settledThree.save.endgame.scyllaRaid).toMatchObject({ active: false, phaseIndex: 0 });
    expect(settledThree.save.endgame.bossAffinity["scylla-cat"]).toBe(1);
    expect(settledThree.save.records.wins).toBe(3);
    expect(settledThree.save.records.totalDamage).toBe(1_200);
  });

  it("rejects ticket or run-state tampering without granting partial rewards", () => {
    const prepared = prepareOracle();
    if (!prepared.ok) throw new Error(prepared.message);
    const beforeResources = structuredClone(prepared.save.resources);
    const broken = structuredClone(prepared.save);
    broken.recovery.pendingEndgameVictorySettlement!.rewardTicketToken += 1;
    expect(readPendingEndgameVictorySettlement(broken)).toBeUndefined();
    const rejected = settlePendingEndgameVictory(broken);
    expect(rejected.ok).toBe(false);
    expect(rejected.save.resources).toEqual(beforeResources);
    expect(rejected.save.endgame.oracleTowerFloor).toBe(0);

    const changedFloor = structuredClone(prepared.save);
    changedFloor.endgame.oracleTowerFloor = 1;
    expect(readPendingEndgameVictorySettlement(changedFloor)).toBeUndefined();
    expect(settlePendingEndgameVictory(changedFloor)).toMatchObject({ ok: false });
  });

  it("normalizes malformed settlement payloads to null", () => {
    const save = normalizeSave({
      schemaVersion: 1,
      recovery: {
        pendingEndgameVictorySettlement: {
          version: 1,
          mode: "scyllaRaid",
          stageId: "r08-s05",
          rewardTicketToken: 1,
          partyHeroIds: [],
          rewardHeroIds: [],
          contentRevision: "x",
          runStateRevision: "y",
          scyllaPhaseIndex: 0,
          stormWeekId: null,
        },
      },
    });
    expect(save.recovery.pendingEndgameVictorySettlement).toBeNull();
  });
});
