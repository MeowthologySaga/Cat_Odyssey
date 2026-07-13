import { describe, expect, it } from "vitest";

import { commitPurchaseReward } from "../../src/core/services";
import { planStormBlessingReroll } from "../../src/core/meta";
import { createMockGameHost } from "../../src/platform";
import { createDefaultSave, GameSaveStore, PurchaseService } from "../../src/state";

describe("diamond progression products", () => {
  it("commits a deterministic blessing reroll once and safely replays the same intent", async () => {
    const host = createMockGameHost({ initialBalance: 200, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const save = createDefaultSave();
    save.endgame.stormRoute.weekId = 202628;
    save.endgame.stormRoute.nodeIndex = 1;
    save.endgame.stormRoute.active = true;
    await store.replace(save);

    const plan = planStormBlessingReroll(store.getSnapshot());
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.message);
    expect(store.getSnapshot().endgame.stormRoute.blessingOfferIds).toEqual([]);
    expect(plan.candidateIds).toHaveLength(3);
    expect(plan.candidateIds.every((id) => !["athena-true-line", "hermes-winged-start", "helios-warm-ray"].includes(id))).toBe(true);

    const service = new PurchaseService(host, store, commitPurchaseReward);
    const first = await service.purchase({
      actionId: "blessing-reroll",
      purchaseId: plan.purchaseId,
      reward: plan.reward,
    });
    expect(first).toMatchObject({ ok: true, status: "committed", balanceAfter: 170 });
    expect(store.getSnapshot().endgame.stormRoute).toMatchObject({
      blessingOfferIds: plan.candidateIds,
      blessingRerollCount: 1,
    });

    const replay = await service.purchase({
      actionId: "blessing-reroll",
      purchaseId: plan.purchaseId,
      reward: plan.reward,
    });
    expect(replay).toMatchObject({ ok: true, status: "already_committed" });
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(store.getSnapshot().endgame.stormRoute.blessingRerollCount).toBe(1);
  });

  it("expands the vault by exactly 20 slots and cannot be bought twice", async () => {
    const host = createMockGameHost({ initialBalance: 500, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const service = new PurchaseService(host, store, commitPurchaseReward);

    const first = await service.purchase({ actionId: "vault-expansion", purchaseId: "vault:first" });
    expect(first).toMatchObject({ ok: true, status: "committed", balanceAfter: 320 });
    expect(store.getSnapshot().resources.vaultSlots).toBe(40);

    const second = await service.purchase({ actionId: "vault-expansion", purchaseId: "vault:second" });
    expect(second).toMatchObject({ ok: true, status: "already_committed" });
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(store.getSnapshot().resources.vaultSlots).toBe(40);
  });

  it("treats existing 40-slot capacity as the one-time vault entitlement", async () => {
    const host = createMockGameHost({ initialBalance: 500, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const save = createDefaultSave();
    save.resources.vaultSlots = 40;
    await store.replace(save);
    const service = new PurchaseService(host, store, commitPurchaseReward);

    const result = await service.purchase({ actionId: "vault-expansion", purchaseId: "vault:legacy-capacity" });
    expect(result).toMatchObject({ ok: false, status: "rejected", code: "entitlement_already_owned" });
    expect(host.__mock.getSuccessfulSpendCount()).toBe(0);
    expect(store.getSnapshot().resources.vaultSlots).toBe(40);
  });

  it("repairs a damaged vault capacity from its permanent purchase receipt", async () => {
    const host = createMockGameHost({ initialBalance: 500, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const save = createDefaultSave();
    save.resources.vaultSlots = 20;
    save.purchaseReceipts.push({
      purchaseId: "vault:original",
      actionId: "vault-expansion",
      transactionId: "tx:vault:original",
      committedAt: 1,
    });
    await store.replace(save);
    const service = new PurchaseService(host, store, commitPurchaseReward);

    const result = await service.purchase({ actionId: "vault-expansion", purchaseId: "vault:retry" });
    expect(result).toMatchObject({ ok: true, status: "already_committed" });
    expect(host.__mock.getSuccessfulSpendCount()).toBe(0);
    expect(store.getSnapshot().resources.vaultSlots).toBe(40);
  });
});
