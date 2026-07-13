import { describe, expect, it } from "vitest";

import {
  ENEMY_BEHAVIOR_BY_ID,
  ENEMY_BY_ID,
  STAGE_BY_ID,
  type HeroDefinition,
} from "../../src/data";
import {
  createBattleRuntime,
  restoreBattleRuntime,
  type BattleOutcomeReason,
  type BattleRuntime,
  type BattleSnapshot,
} from "../../src/core/battle";
import {
  BATTLE_RESCUE_TURN_BONUS,
  beginBattleRewardTicket,
  battleRescueContentRevision,
  consumePreparedBattleRescue,
  createBattlePartyDefinitions,
  createBattleRescueReward,
  createCampaignBattleCheckpoint,
  getPendingBattleRescue,
  readRestorableBattleRescue,
  writeCampaignBattleCheckpoint,
} from "../../src/core/meta";
import { commitPurchaseReward } from "../../src/core/services";
import { resolvePendingVoyageRecoveryDestination } from "../../src/core/uxFlow";
import { createMockGameHost } from "../../src/platform";
import { createDefaultSave, GameSaveStore, PurchaseService } from "../../src/state";
import { battleTurnText } from "../../src/scenes/battlePresentation";

const STAGE_ID = "r02-s04";

function defeatedBattle(
  stageId = STAGE_ID,
  reason: Extract<BattleOutcomeReason, "partyDefeated" | "objectiveFailed" | "turnLimit"> = "partyDefeated",
): { snapshot: BattleSnapshot; party: readonly HeroDefinition[] } {
  const save = createDefaultSave();
  const party = createBattlePartyDefinitions(save, ["meow-dysseus"]);
  const runtime = createBattleRuntime({
    stage: STAGE_BY_ID[stageId]!,
    party,
    enemyCatalog: ENEMY_BY_ID,
    enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
    seed: `rescue-${stageId}-${reason}`,
  });
  const snapshot = runtime.getSnapshot();
  snapshot.phase = "defeat";
  snapshot.outcome = { victory: false, reason, turnNumber: snapshot.turnNumber };
  if (reason === "partyDefeated") {
    for (const member of snapshot.party) {
      member.alive = false;
      member.hp = 0;
    }
  } else if (reason === "turnLimit") {
    snapshot.completedTurns = STAGE_BY_ID[stageId]!.objective.turnLimit;
    snapshot.turnNumber = snapshot.completedTurns + 1;
  } else {
    const target = snapshot.objective.targets[0]!;
    target.failed = true;
    target.active = false;
    target.hp = 0;
    snapshot.objective.failed = true;
    const prop = snapshot.props.find((entry) => entry.id === target.id);
    if (prop) {
      prop.active = false;
      prop.hp = 0;
      prop.state = "failed";
    }
  }
  return { snapshot, party };
}

async function purchaseRescue(options: {
  stageId?: string;
  reason?: Extract<BattleOutcomeReason, "partyDefeated" | "objectiveFailed" | "turnLimit">;
  purchaseId?: string;
} = {}) {
  const stageId = options.stageId ?? STAGE_ID;
  const defeated = defeatedBattle(stageId, options.reason);
  const host = createMockGameHost({ initialBalance: 200, confirm: async () => true });
  const store = new GameSaveStore(host);
  await store.load();
  const service = new PurchaseService(host, store, commitPurchaseReward);
  const reward = createBattleRescueReward(
    stageId,
    "campaign",
    JSON.stringify(defeated.snapshot),
    defeated.party,
  );
  const result = await service.purchase({
    actionId: "battle-rescue",
    purchaseId: options.purchaseId ?? `${stageId}:rescue-1`,
    reward,
  });
  expect(result).toMatchObject({ ok: true, status: "committed" });
  return { host, store, service, reward, ...defeated };
}

function restorePrepared(
  stageId: string,
  party: readonly HeroDefinition[],
  snapshot: BattleSnapshot,
): BattleRuntime {
  return restoreBattleRuntime({
    stage: STAGE_BY_ID[stageId]!,
    party,
    enemyCatalog: ENEMY_BY_ID,
    enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
    seed: "ignored-after-restore",
  }, snapshot);
}

function advanceShot(runtime: BattleRuntime): void {
  runtime.setAim({ direction: { x: 0, y: 1 }, power: 0.3 });
  expect(runtime.launch()).not.toBeNull();
  for (let step = 0; step < 2_000 && runtime.getSnapshot().phase === "projectile"; step += 1) {
    runtime.advance(1 / 60);
  }
}

describe("versioned paid battle rescue", () => {
  it.each(["campaign", "oracle", "storm", "raid"] as const)(
    "records the %s rescue mode in its compatibility fingerprint",
    (mode) => {
      const defeated = defeatedBattle();
      const reward = createBattleRescueReward(
        STAGE_ID,
        mode,
        JSON.stringify(defeated.snapshot),
        defeated.party,
      );
      expect(reward).toMatchObject({
        version: 1,
        mode,
        contentRevision: battleRescueContentRevision(STAGE_ID, mode),
      });
    },
  );

  it("freezes mode, party definitions, content revision, and restores before one-use consumption", async () => {
    const { host, store, party } = await purchaseRescue({ purchaseId: "r02-s04:rescue-integrity" });
    const pending = getPendingBattleRescue(store.getSnapshot())!;
    expect(pending).toMatchObject({
      version: 1,
      purchaseId: "r02-s04:rescue-integrity",
      mode: "campaign",
      stageId: STAGE_ID,
      deployedHeroIds: ["meow-dysseus"],
      contentRevision: battleRescueContentRevision(STAGE_ID, "campaign"),
      hpRatio: 0.5,
    });
    expect(JSON.parse(pending.partyDefinitions)).toEqual(party);

    const prepared = readRestorableBattleRescue(store.getSnapshot(), {
      stageId: STAGE_ID,
      mode: "campaign",
    });
    expect(prepared).toBeDefined();
    const restored = restorePrepared(STAGE_ID, prepared!.partyDefinitions, prepared!.preparedSnapshot);
    expect(restored.getSnapshot().phase).toBe("awaitingAim");
    expect(restored.getSnapshot().party[0]).toMatchObject({ alive: true });
    expect(restored.getSnapshot().party[0]!.hp).toBe(Math.round(restored.getSnapshot().party[0]!.maxHp * 0.5));

    const consumed = consumePreparedBattleRescue(store.getSnapshot(), prepared!);
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) throw new Error(consumed.message);
    await store.replace(consumed.save);
    expect(getPendingBattleRescue(store.getSnapshot())).toBeUndefined();
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(consumePreparedBattleRescue(store.getSnapshot(), prepared!)).toMatchObject({
      ok: false,
      code: "battle_rescue_missing",
    });
  });

  it("never consumes mismatched or corrupted rescue data", async () => {
    const { store } = await purchaseRescue();
    const prepared = readRestorableBattleRescue(store.getSnapshot())!;

    const outdated = store.getSnapshot();
    outdated.recovery.pendingBattleRescue!.contentRevision = "outdated";
    expect(readRestorableBattleRescue(outdated)).toBeUndefined();
    const mismatch = consumePreparedBattleRescue(outdated, prepared);
    expect(mismatch).toMatchObject({ ok: false, code: "battle_rescue_mismatch" });
    expect(mismatch.save.recovery.pendingBattleRescue).not.toBeNull();

    const corrupted = store.getSnapshot();
    corrupted.recovery.pendingBattleRescue!.partyDefinitions = "not-json";
    expect(readRestorableBattleRescue(corrupted)).toBeUndefined();
    expect(consumePreparedBattleRescue(corrupted, prepared).save.recovery.pendingBattleRescue).not.toBeNull();

    const numericCorruption = store.getSnapshot();
    const badSnapshot = JSON.parse(numericCorruption.recovery.pendingBattleRescue!.battleSnapshot);
    badSnapshot.enemies[0].position.x = null;
    numericCorruption.recovery.pendingBattleRescue!.battleSnapshot = JSON.stringify(badSnapshot);
    expect(readRestorableBattleRescue(numericCorruption)).toBeUndefined();
    expect(numericCorruption.recovery.pendingBattleRescue).not.toBeNull();
  });

  it("rejects a second rescue before wallet spend and never overwrites the first", async () => {
    const { host, store, service, reward } = await purchaseRescue({ purchaseId: "first-rescue" });
    const first = getPendingBattleRescue(store.getSnapshot())!;
    const second = await service.purchase({
      actionId: "battle-rescue",
      purchaseId: "second-rescue",
      reward,
    });
    expect(second).toMatchObject({ ok: false, status: "rejected", code: "pending_rescue_exists" });
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(getPendingBattleRescue(store.getSnapshot())).toEqual(first);

    await store.update((draft) => {
      draft.pendingPurchases.push({
        purchaseId: "recovered-second-rescue",
        actionId: "battle-rescue",
        idempotencyKey: "pack:battle-rescue:recovered-second-rescue",
        phase: "spending",
        createdAt: 20,
        updatedAt: 20,
        reward,
      });
    });
    const recovered = await service.recoverPendingPurchases();
    expect(recovered).toContainEqual(expect.objectContaining({
      ok: false,
      status: "rejected",
      code: "pending_rescue_exists",
    }));
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(store.getSnapshot().pendingPurchases).toEqual([]);
    expect(getPendingBattleRescue(store.getSnapshot())).toEqual(first);
  });

  it("adds exactly three effective turns and both HUD and runtime honor the extended deadline", () => {
    const turnStageId = "r01-s01";
    const { snapshot, party } = defeatedBattle(turnStageId, "turnLimit");
    const save = createDefaultSave();
    save.recovery.pendingBattleRescue = {
      version: 1,
      purchaseId: "turn-limit-rescue",
      mode: "campaign",
      stageId: turnStageId,
      deployedHeroIds: party.map((hero) => hero.id),
      partyDefinitions: JSON.stringify(party),
      contentRevision: battleRescueContentRevision(turnStageId, "campaign"),
      battleSnapshot: JSON.stringify(snapshot),
      hpRatio: 0.5,
      createdAt: 1,
    };
    const prepared = readRestorableBattleRescue(save)!;
    expect(prepared.preparedSnapshot.rescueTurnLimitBonus).toBe(BATTLE_RESCUE_TURN_BONUS);
    const effectiveLimit = STAGE_BY_ID[turnStageId]!.objective.turnLimit + BATTLE_RESCUE_TURN_BONUS;
    expect(battleTurnText(prepared.preparedSnapshot.turnNumber, effectiveLimit)).toContain(`/ ${effectiveLimit}`);

    const runtime = restorePrepared(turnStageId, prepared.partyDefinitions, prepared.preparedSnapshot);
    // The defeated snapshot was at the original deadline. Two completed turns
    // remain safe; the third reaches the exactly +3 effective deadline.
    for (let turn = 0; turn < 2; turn += 1) {
      advanceShot(runtime);
      expect(runtime.getSnapshot().outcome?.reason).not.toBe("turnLimit");
    }
    advanceShot(runtime);
    expect(runtime.getSnapshot().outcome).toMatchObject({ victory: false, reason: "turnLimit" });
  });

  it("restores failed objectives as well as a fully defeated party", () => {
    const objective = defeatedBattle("r01-s02", "objectiveFailed");
    const objectiveSave = createDefaultSave();
    objectiveSave.recovery.pendingBattleRescue = {
      version: 1,
      purchaseId: "objective-rescue",
      mode: "campaign",
      stageId: "r01-s02",
      deployedHeroIds: objective.party.map((hero) => hero.id),
      partyDefinitions: JSON.stringify(objective.party),
      contentRevision: battleRescueContentRevision("r01-s02", "campaign"),
      battleSnapshot: JSON.stringify(objective.snapshot),
      hpRatio: 0.5,
      createdAt: 1,
    };
    const objectivePrepared = readRestorableBattleRescue(objectiveSave)!.preparedSnapshot;
    expect(objectivePrepared.objective.failed).toBe(false);
    expect(objectivePrepared.objective.targets[0]).toMatchObject({ failed: false, active: true });
    expect(objectivePrepared.objective.targets[0]!.hp).toBeGreaterThan(0);
    expect(objectivePrepared.props.find(
      (prop) => prop.id === objectivePrepared.objective.targets[0]!.id,
    )).toMatchObject({ active: true, state: "protected" });

    const party = defeatedBattle(STAGE_ID, "partyDefeated");
    const partySave = createDefaultSave();
    partySave.recovery.pendingBattleRescue = {
      version: 1,
      purchaseId: "party-rescue",
      mode: "campaign",
      stageId: STAGE_ID,
      deployedHeroIds: party.party.map((hero) => hero.id),
      partyDefinitions: JSON.stringify(party.party),
      contentRevision: battleRescueContentRevision(STAGE_ID, "campaign"),
      battleSnapshot: JSON.stringify(party.snapshot),
      hpRatio: 0.5,
      createdAt: 1,
    };
    const partyPrepared = readRestorableBattleRescue(partySave)!.preparedSnapshot;
    expect(partyPrepared.party.every((member) => member.alive && member.hp > 0)).toBe(true);
  });

  it("routes a valid paid rescue ahead of an ordinary campaign checkpoint", async () => {
    const host = createMockGameHost({ initialBalance: 200, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();

    const ticket = beginBattleRewardTicket(store.getSnapshot(), "r01-s01", "campaign");
    if (!ticket.ok) throw new Error(ticket.message);
    const checkpointParty = createBattlePartyDefinitions(ticket.save, ["meow-dysseus"]);
    const checkpointRuntime = createBattleRuntime({
      stage: STAGE_BY_ID["r01-s01"]!,
      party: checkpointParty,
      enemyCatalog: ENEMY_BY_ID,
      enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
      seed: "rescue-priority-checkpoint",
    });
    await store.replace(writeCampaignBattleCheckpoint(
      ticket.save,
      createCampaignBattleCheckpoint(checkpointRuntime.getSnapshot(), checkpointParty),
    ));

    const defeated = defeatedBattle(STAGE_ID, "partyDefeated");
    const service = new PurchaseService(host, store, commitPurchaseReward);
    const purchased = await service.purchase({
      actionId: "battle-rescue",
      purchaseId: "priority-rescue",
      reward: createBattleRescueReward(
        STAGE_ID,
        "storm",
        JSON.stringify(defeated.snapshot),
        defeated.party,
      ),
    });
    expect(purchased.ok).toBe(true);
    expect(resolvePendingVoyageRecoveryDestination(store.getSnapshot())).toEqual({
      sceneKey: "Battle",
      data: { stageId: STAGE_ID, resumeRescue: true, endgameMode: "stormRoute" },
    });
  });
});
