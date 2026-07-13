import { describe, expect, it } from "vitest";

import {
  createBattleRuntime,
} from "../../src/core/battle";
import {
  beginBattleRewardTicket,
  createBattlePartyDefinitions,
  createCampaignBattleCheckpoint,
  prepareCampaignVictorySettlement,
  readPendingBattleRewardTicket,
  readPendingCampaignVictorySettlement,
  readRestorableCampaignBattle,
  sanitizePendingCampaignVictorySettlement,
  settlePendingCampaignVictory,
  wasBattleRewardCommitted,
  writeCampaignBattleCheckpoint,
} from "../../src/core/meta";
import { resolveTitleVoyageDestination } from "../../src/core/uxFlow";
import {
  ENEMY_BEHAVIOR_BY_ID,
  ENEMY_BY_ID,
  STAGE_BY_ID,
} from "../../src/data";
import { createMockGameHost } from "../../src/platform";
import { createDefaultSave, GameSaveStore, normalizeSave, type GameSaveV1 } from "../../src/state";

const STAGE_ID = "r01-s01";

function createPreparedBattleSave(): GameSaveV1 {
  const begun = beginBattleRewardTicket(createDefaultSave(), STAGE_ID, "campaign");
  if (!begun.ok) throw new Error(begun.message);
  const party = createBattlePartyDefinitions(begun.save, ["meow-dysseus"]);
  const runtime = createBattleRuntime({
    stage: STAGE_BY_ID[STAGE_ID]!,
    party,
    enemyCatalog: ENEMY_BY_ID,
    enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
    seed: "victory-settlement-test",
  });
  runtime.drainEvents();
  return writeCampaignBattleCheckpoint(
    begun.save,
    createCampaignBattleCheckpoint(runtime.getSnapshot(), party, 100),
  );
}

function prepareVictory(input = createPreparedBattleSave(), wonAt = 999): ReturnType<typeof prepareCampaignVictorySettlement> {
  return prepareCampaignVictorySettlement(input, {
    stageId: STAGE_ID,
    stars: 3,
    turns: 7,
    bestCombo: 6,
    totalDamage: 4321,
    hpRatio: 0.76,
    partyHeroIds: ["meow-dysseus"],
    fallenHeroIds: [],
  }, wonAt);
}

describe("durable ordinary-campaign victory settlement", () => {
  it("round-trips a versioned victory hand-off and prioritizes Reward over the retained battle checkpoint", () => {
    const beforeVictory = createPreparedBattleSave();
    expect(readRestorableCampaignBattle(beforeVictory)).toBeDefined();

    const prepared = prepareVictory(beforeVictory);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.save.recovery.activeCampaignBattle).toEqual(beforeVictory.recovery.activeCampaignBattle);
    expect(beforeVictory.recovery.pendingCampaignVictorySettlement).toBeNull();

    const afterRestart = normalizeSave(JSON.parse(JSON.stringify(prepared.save)) as unknown);
    expect(readPendingCampaignVictorySettlement(afterRestart)).toEqual(prepared.settlement);
    expect(readRestorableCampaignBattle(afterRestart)).toBeUndefined();
    expect(resolveTitleVoyageDestination(afterRestart)).toMatchObject({
      sceneKey: "Reward",
      data: {
        stageId: STAGE_ID,
        turns: 7,
        bestCombo: 6,
        totalDamage: 4321,
        hpRatio: 0.76,
        partyHeroIds: ["meow-dysseus"],
        fallenHeroIds: [],
      },
    });
  });

  it("atomically grants rewards, commits the ticket, and clears both recovery records exactly once", () => {
    const prepared = prepareVictory();
    if (!prepared.ok) throw new Error(prepared.message);
    const ticket = readPendingBattleRewardTicket(prepared.save, STAGE_ID, "campaign")!;
    const goldBefore = prepared.save.resources.gold;
    const damageBefore = prepared.save.records.totalDamage;

    const settled = settlePendingCampaignVictory(prepared.save);
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(settled.message);
    expect(settled.save.progress.completedStageIds).toContain(STAGE_ID);
    expect(settled.save.progress.stageStars[STAGE_ID]).toBe(3);
    expect(settled.save.resources.gold).toBe(goldBefore + settled.rewards.gold);
    expect(settled.rewards.heroXpHeroIds).toEqual(["meow-dysseus"]);
    expect(settled.save.records.totalDamage).toBe(damageBefore + 4321);
    expect(settled.save.records.bestRicochetChain).toBe(6);
    expect(settled.save.records.lastPlayedAt).toBe(999);
    expect(settled.save.recovery.activeCampaignBattle).toBeNull();
    expect(settled.save.recovery.pendingCampaignVictorySettlement).toBeNull();
    expect(readPendingBattleRewardTicket(settled.save, STAGE_ID, "campaign")).toBeUndefined();
    expect(wasBattleRewardCommitted(settled.save, STAGE_ID, "campaign")).toBe(true);
    expect(settled.ticket).toEqual(ticket);

    const goldAfter = settled.save.resources.gold;
    const duplicate = settlePendingCampaignVictory(settled.save);
    expect(duplicate).toMatchObject({ ok: false, code: "settlement_missing" });
    expect(duplicate.save.resources.gold).toBe(goldAfter);
  });

  it("covers both crash windows without replaying a final turn or losing the reward", () => {
    const quietCheckpoint = createPreparedBattleSave();
    const prepared = prepareVictory(quietCheckpoint);
    if (!prepared.ok) throw new Error(prepared.message);

    // Crash before the hand-off write: the last quiet turn is still playable.
    const beforeWriteRestart = normalizeSave(JSON.parse(JSON.stringify(quietCheckpoint)) as unknown);
    expect(readRestorableCampaignBattle(beforeWriteRestart)).toBeDefined();
    expect(readPendingCampaignVictorySettlement(beforeWriteRestart)).toBeUndefined();

    // Crash after the hand-off write: Reward opens, while battle replay is suppressed.
    const afterWriteRestart = normalizeSave(JSON.parse(JSON.stringify(prepared.save)) as unknown);
    expect(readPendingCampaignVictorySettlement(afterWriteRestart)).toBeDefined();
    expect(readRestorableCampaignBattle(afterWriteRestart)).toBeUndefined();
    const settled = settlePendingCampaignVictory(afterWriteRestart);
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(settled.message);

    // Crash after the single settlement write: nothing remains to grant again.
    const afterSettlementRestart = normalizeSave(JSON.parse(JSON.stringify(settled.save)) as unknown);
    expect(readPendingCampaignVictorySettlement(afterSettlementRestart)).toBeUndefined();
    expect(settlePendingCampaignVictory(afterSettlementRestart)).toMatchObject({
      ok: false,
      code: "settlement_missing",
    });
  });

  it("keeps the exact recoverable hand-off in memory when the host write fails and retries it unchanged", async () => {
    const prepared = prepareVictory();
    if (!prepared.ok) throw new Error(prepared.message);
    const backingHost = createMockGameHost();
    let rejectNextWrite = false;
    const host: LemGameHostApi = {
      ...backingHost,
      save: {
        ...backingHost.save,
        async write<T>(value: T): Promise<void> {
          if (rejectNextWrite) {
            rejectNextWrite = false;
            throw new Error("simulated host write failure");
          }
          await backingHost.save.write(value);
        },
      },
    };
    const store = new GameSaveStore(host);
    await store.load();

    rejectNextWrite = true;
    await expect(store.replace(prepared.save)).rejects.toThrow("simulated host write failure");
    expect(readPendingCampaignVictorySettlement(store.getSnapshot())).toEqual(prepared.settlement);
    expect(store.getSnapshot().recovery.activeCampaignBattle).not.toBeNull();

    await store.saveNow();
    const persisted = normalizeSave(backingHost.__mock.getSavedValue());
    expect(readPendingCampaignVictorySettlement(persisted)).toEqual(prepared.settlement);
    expect(persisted.recovery.activeCampaignBattle).not.toBeNull();
  });

  it("refuses to begin another battle without erasing a recoverable victory ticket", () => {
    const prepared = prepareVictory();
    if (!prepared.ok) throw new Error(prepared.message);
    const ticketBefore = readPendingBattleRewardTicket(prepared.save, STAGE_ID, "campaign");

    const next = beginBattleRewardTicket(prepared.save, "r01-s02", "campaign");
    expect(next).toMatchObject({ ok: false, code: "pending_victory_settlement" });
    expect(readPendingBattleRewardTicket(next.save, STAGE_ID, "campaign")).toEqual(ticketBefore);
    expect(readPendingCampaignVictorySettlement(next.save)).toEqual(prepared.settlement);
  });

  it("migrates missing fields additively and drops malformed or orphaned settlement payloads safely", () => {
    expect(normalizeSave({ schemaVersion: 1 }).recovery.pendingCampaignVictorySettlement).toBeNull();
    expect(normalizeSave({
      schemaVersion: 1,
      recovery: {
        pendingCampaignVictorySettlement: {
          version: 99,
          stageId: STAGE_ID,
          rewardTicketToken: 1,
          partyHeroIds: ["meow-dysseus"],
        },
      },
    }).recovery.pendingCampaignVictorySettlement).toBeNull();

    const prepared = prepareVictory();
    if (!prepared.ok) throw new Error(prepared.message);
    const corruptions: Array<(save: GameSaveV1) => void> = [
      (save) => { save.recovery.pendingCampaignVictorySettlement!.stageId = "missing-stage"; },
      (save) => { save.recovery.pendingCampaignVictorySettlement!.partyHeroIds = ["missing-hero"]; },
      (save) => { save.recovery.pendingCampaignVictorySettlement!.rewardTicketToken += 1; },
      (save) => {
        for (const key of Object.keys(save.endgame.bossAffinity)) {
          if (key.includes("battle-reward-pending")) delete save.endgame.bossAffinity[key];
        }
      },
    ];
    for (const corrupt of corruptions) {
      const broken = structuredClone(prepared.save);
      corrupt(broken);
      expect(readPendingCampaignVictorySettlement(broken)).toBeUndefined();
      expect(sanitizePendingCampaignVictorySettlement(broken).recovery.pendingCampaignVictorySettlement).toBeNull();
    }
  });
});
