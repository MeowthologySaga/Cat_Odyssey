import { describe, expect, it } from "vitest";

import {
  ENEMY_BEHAVIOR_BY_ID,
  ENEMY_BY_ID,
  HERO_BY_ID,
  STAGE_BY_ID,
} from "../../src/data";
import {
  createBattleRuntime,
  restoreBattleRuntime,
  type BattleRuntime,
} from "../../src/core/battle";
import {
  abandonPendingBattleRun,
  beginBattleRewardTicket,
  campaignBattleContentRevision,
  clearCampaignBattleCheckpoint,
  commitBattleRewardTicket,
  createBattlePartyDefinitions,
  createCampaignBattleCheckpoint,
  readPendingBattleRewardTicket,
  readRestorableCampaignBattle,
  sanitizeCampaignBattleCheckpoint,
  writeCampaignBattleCheckpoint,
} from "../../src/core/meta";
import { createDefaultSave, normalizeSave, type GameSaveV1 } from "../../src/state";
import { resolveTitleVoyageDestination } from "../../src/core/uxFlow";

const STAGE_ID = "r02-s04";

function createPreparedBattle(stageId = STAGE_ID): {
  save: GameSaveV1;
  runtime: BattleRuntime;
  party: ReturnType<typeof createBattlePartyDefinitions>;
} {
  const original = createDefaultSave();
  const ticket = beginBattleRewardTicket(original, stageId, "campaign");
  if (!ticket.ok) throw new Error(ticket.message);
  const party = createBattlePartyDefinitions(ticket.save, ["meow-dysseus"]);
  const runtime = createBattleRuntime({
    stage: STAGE_BY_ID[stageId]!,
    party,
    enemyCatalog: ENEMY_BY_ID,
    enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
    seed: "campaign-resume-test",
  });
  runtime.drainEvents();
  return { save: ticket.save, runtime, party };
}

function installCheckpoint(
  save: GameSaveV1,
  runtime: BattleRuntime,
  party: ReturnType<typeof createBattlePartyDefinitions>,
): GameSaveV1 {
  const checkpoint = createCampaignBattleCheckpoint(runtime.getSnapshot(), party, 1234);
  return writeCampaignBattleCheckpoint(save, checkpoint);
}

function advanceShot(runtime: BattleRuntime): void {
  runtime.setAim({ direction: { x: 0.22, y: -0.9755 }, power: 0.45 });
  expect(runtime.launch()).toBeTruthy();
  for (let step = 0; step < 1_000 && runtime.getSnapshot().phase === "projectile"; step += 1) {
    runtime.advance(1 / 60);
  }
}

describe("ordinary campaign battle resume checkpoints", () => {
  it("round-trips a versioned representative boss snapshot with objective, walls, hazards, statuses, and charges", () => {
    const prepared = createPreparedBattle();
    advanceShot(prepared.runtime);
    expect(prepared.runtime.getSnapshot().phase).toBe("awaitingAim");
    const before = prepared.runtime.getSnapshot();
    expect(before.objective).toBeDefined();
    expect(before.walls.length).toBeGreaterThan(0);
    expect(before.hazards.length).toBeGreaterThan(0);
    expect(before.party[0]?.activeSkill).toBeDefined();

    const persisted = installCheckpoint(prepared.save, prepared.runtime, prepared.party);
    const roundTrip = normalizeSave(JSON.parse(JSON.stringify(persisted)) as unknown);
    const resume = readRestorableCampaignBattle(roundTrip);
    expect(resume?.checkpoint).toMatchObject({
      version: 1,
      stageId: STAGE_ID,
      deployedHeroIds: ["meow-dysseus"],
      savedAt: 1234,
      contentRevision: campaignBattleContentRevision(STAGE_ID),
    });
    expect(resume?.snapshot).toEqual(before);
    expect(resolveTitleVoyageDestination(roundTrip)).toEqual({
      sceneKey: "Battle",
      data: { stageId: STAGE_ID, resumeCampaign: true },
    });

    const restored = restoreBattleRuntime({
      stage: STAGE_BY_ID[STAGE_ID]!,
      party: resume!.partyDefinitions,
      enemyCatalog: ENEMY_BY_ID,
      enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
      seed: "ignored-after-restore",
    }, resume!.snapshot);
    expect(restored.getSnapshot()).toEqual(before);
  });

  it("continues deterministically from the same quiet turn boundary", () => {
    const prepared = createPreparedBattle();
    const persisted = installCheckpoint(prepared.save, prepared.runtime, prepared.party);
    const resume = readRestorableCampaignBattle(persisted)!;
    const restored = restoreBattleRuntime({
      stage: STAGE_BY_ID[STAGE_ID]!,
      party: resume.partyDefinitions,
      enemyCatalog: ENEMY_BY_ID,
      enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
      seed: "ignored",
    }, resume.snapshot);
    restored.drainEvents();

    advanceShot(prepared.runtime);
    advanceShot(restored);
    expect(restored.getSnapshot()).toEqual(prepared.runtime.getSnapshot());
    expect(restored.drainEvents()).toEqual(prepared.runtime.drainEvents());
  });

  it("rejects moving snapshots so no projectile or partial enemy action can be repeated", () => {
    const prepared = createPreparedBattle();
    prepared.runtime.setAim({ direction: { x: 0, y: -1 }, power: 0.5 });
    expect(() => createCampaignBattleCheckpoint(
      prepared.runtime.getSnapshot(),
      prepared.party,
    )).toThrow(/stable player-input boundary/);
    prepared.runtime.launch();
    expect(() => createCampaignBattleCheckpoint(
      prepared.runtime.getSnapshot(),
      prepared.party,
    )).toThrow(/stable player-input boundary/);
  });

  it("safely discards corrupted, outdated, missing-stage, missing-hero, and orphaned checkpoints", () => {
    const prepared = createPreparedBattle();
    const valid = installCheckpoint(prepared.save, prepared.runtime, prepared.party);
    const mutations: Array<(save: GameSaveV1) => void> = [
      (save) => { save.recovery.activeCampaignBattle!.battleSnapshot = "not-json"; },
      (save) => { save.recovery.activeCampaignBattle!.contentRevision = "outdated"; },
      (save) => { save.recovery.activeCampaignBattle!.stageId = "missing-stage"; },
      (save) => { save.recovery.activeCampaignBattle!.deployedHeroIds = ["missing-hero"]; },
      (save) => {
        for (const key of Object.keys(save.endgame.bossAffinity)) {
          if (key.includes("battle-reward-pending")) delete save.endgame.bossAffinity[key];
        }
      },
    ];

    for (const mutate of mutations) {
      const corrupted = structuredClone(valid);
      mutate(corrupted);
      expect(readRestorableCampaignBattle(corrupted)).toBeUndefined();
      expect(sanitizeCampaignBattleCheckpoint(corrupted).recovery.activeCampaignBattle).toBeNull();
    }
  });

  it("resumes a completed-stage replay while its matching campaign reward ticket is pending", () => {
    const completed = createDefaultSave();
    completed.progress.completedStageIds.push(STAGE_ID);
    completed.progress.stageStars[STAGE_ID] = 2;
    const prepared = beginBattleRewardTicket(completed, STAGE_ID, "campaign");
    if (!prepared.ok) throw new Error(prepared.message);
    const party = createBattlePartyDefinitions(prepared.save, ["meow-dysseus"]);
    const runtime = createBattleRuntime({
      stage: STAGE_BY_ID[STAGE_ID]!,
      party,
      enemyCatalog: ENEMY_BY_ID,
      enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
      seed: "completed-stage-three-star-replay",
    });
    const persisted = installCheckpoint(prepared.save, runtime, party);

    expect(readRestorableCampaignBattle(persisted)?.checkpoint.stageId).toBe(STAGE_ID);
    expect(resolveTitleVoyageDestination(persisted)).toEqual({
      sceneKey: "Battle",
      data: { stageId: STAGE_ID, resumeCampaign: true },
    });
  });

  it("preserves the pending reward ticket through checkpoint writes and clears", () => {
    const prepared = createPreparedBattle();
    const ticketBefore = readPendingBattleRewardTicket(prepared.save, STAGE_ID, "campaign")!;
    const withCheckpoint = installCheckpoint(prepared.save, prepared.runtime, prepared.party);
    expect(readPendingBattleRewardTicket(withCheckpoint, STAGE_ID, "campaign")).toEqual(ticketBefore);

    const cleared = clearCampaignBattleCheckpoint(withCheckpoint);
    expect(cleared.recovery.activeCampaignBattle).toBeNull();
    expect(readPendingBattleRewardTicket(cleared, STAGE_ID, "campaign")).toEqual(ticketBefore);
    const committed = commitBattleRewardTicket(cleared, ticketBefore);
    expect(committed.ok).toBe(true);
    if (!committed.ok) throw new Error(committed.message);
    expect(commitBattleRewardTicket(committed.save, ticketBefore)).toMatchObject({
      ok: false,
      code: "ticket_missing",
    });
  });

  it("does not treat endgame reward tickets as campaign resume authority", () => {
    const save = createDefaultSave();
    const endgameTicket = beginBattleRewardTicket(save, STAGE_ID, "oracleTower");
    if (!endgameTicket.ok) throw new Error(endgameTicket.message);
    const party = [HERO_BY_ID["meow-dysseus"]!];
    const runtime = createBattleRuntime({
      stage: STAGE_BY_ID[STAGE_ID]!,
      party,
      enemyCatalog: ENEMY_BY_ID,
      enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
      seed: "endgame-not-resumable",
    });
    const withCheckpoint = installCheckpoint(endgameTicket.save, runtime, party);
    expect(readRestorableCampaignBattle(withCheckpoint)).toBeUndefined();
  });

  it("preserves an active checkpoint when a different battle start was not explicitly abandoned", () => {
    const prepared = createPreparedBattle();
    const active = installCheckpoint(prepared.save, prepared.runtime, prepared.party);
    const blocked = beginBattleRewardTicket(active, "r01-s01", "campaign");
    expect(blocked).toMatchObject({ ok: false, code: "battle_run_conflict" });
    expect(readRestorableCampaignBattle(blocked.save)?.checkpoint.stageId).toBe(STAGE_ID);

    const abandoned = abandonPendingBattleRun(blocked.save);
    expect(abandoned.recovery.activeCampaignBattle).toBeNull();
    expect(readRestorableCampaignBattle(abandoned)).toBeUndefined();
    expect(beginBattleRewardTicket(abandoned, "r01-s01", "campaign")).toMatchObject({ ok: true });
  });
});
