import { createMockGameHost } from "../../src/platform";
import { GameSaveStore, PurchaseService } from "../../src/state";
import { commitPurchaseReward } from "../../src/core/services";
import {
  createOraclePurchaseReward,
  resolveOracleSummons,
} from "../../src/core/meta";
import { describe, expect, it, vi } from "vitest";

describe("recoverable purchase service", () => {
  it("never reaches the wallet while a developer sandbox is active", async () => {
    const host = createMockGameHost({ initialBalance: 2_000 });
    const spend = vi.spyOn(host.wallet, "spend");
    const store = new GameSaveStore(host);
    await store.load();
    store.beginVolatileSession();
    const service = new PurchaseService(host, store, () => undefined, {
      walletSpendingDisabled: true,
    });

    const result = await service.purchase({ actionId: "oracle-summon-1" });

    expect(result).toMatchObject({
      ok: false,
      status: "rejected",
      code: "debug_mode_wallet_disabled",
    });
    expect(spend).not.toHaveBeenCalled();
    expect(host.__mock.getBalance()).toBe(2_000);
    expect(store.getSnapshot().pendingPurchases).toEqual([]);
  });

  it("persists intent before charge and commits reward with a receipt", async () => {
    const host = createMockGameHost({
      initialBalance: 200,
      confirm: async () => true,
      transactionId: () => "tx-summon-1"
    });
    const store = new GameSaveStore(host);
    await store.load();

    const originalSpend = host.wallet.spend.bind(host.wallet);
    host.wallet.spend = vi.fn(async (input) => {
      const persisted = host.__mock.getSavedValue() as {
        pendingPurchases?: Array<{ phase?: string }>;
      };
      expect(persisted.pendingPurchases?.[0]?.phase).toBe("spending");
      return originalSpend(input);
    });

    const service = new PurchaseService(host, store, (purchase, draft) => {
      expect(purchase.reward).toEqual({ pulls: 1 });
      draft.summons.oraclePulls += 1;
      draft.summons.pityCount += 1;
    });
    const result = await service.purchase({
      actionId: "oracle-summon-1",
      purchaseId: "banner-1-pull-1",
      reward: { pulls: 1 }
    });

    expect(result).toEqual({
      ok: true,
      status: "committed",
      purchaseId: "banner-1-pull-1",
      actionId: "oracle-summon-1",
      transactionId: "tx-summon-1",
      balanceAfter: 100
    });
    const saved = store.getSnapshot();
    expect(saved.pendingPurchases).toEqual([]);
    expect(saved.summons.oraclePulls).toBe(1);
    expect(saved.purchaseReceipts).toEqual([
      {
        purchaseId: "banner-1-pull-1",
        actionId: "oracle-summon-1",
        transactionId: "tx-summon-1",
        committedAt: expect.any(Number)
      }
    ]);
    expect(JSON.stringify(saved)).not.toMatch(/walletBalance|diamonds/i);
  });

  it("recovers a charged purchase without charging or granting twice", async () => {
    const host = createMockGameHost({
      initialBalance: 200,
      confirm: async () => true,
      transactionId: () => "tx-recovery"
    });
    const store = new GameSaveStore(host);
    await store.load();
    let shouldFail = true;
    const rewardCommit = vi.fn((_purchase, draft) => {
      if (shouldFail) {
        throw new Error("simulated crash before reward save");
      }
      draft.resources.awakeningMaterials += 1;
    });
    const service = new PurchaseService(host, store, rewardCommit);

    const first = await service.purchase({
      actionId: "awakening-materials",
      purchaseId: "hero-a:awakening-pack-1",
      reward: { heroId: "hero-a", bundle: 1 }
    });
    expect(first).toMatchObject({
      ok: false,
      status: "recoverable",
      code: "reward_commit_failed"
    });
    expect(host.__mock.getBalance()).toBe(80);
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(store.getSnapshot().pendingPurchases[0]).toMatchObject({
      phase: "spent",
      transactionId: "tx-recovery"
    });

    shouldFail = false;
    const recovered = await service.recoverPendingPurchases();
    expect(recovered).toEqual([
      {
        ok: true,
        status: "committed",
        purchaseId: "hero-a:awakening-pack-1",
        actionId: "awakening-materials",
        transactionId: "tx-recovery"
      }
    ]);
    expect(host.__mock.getBalance()).toBe(80);
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(store.getSnapshot().resources.awakeningMaterials).toBe(1);
    expect(store.getSnapshot().pendingPurchases).toEqual([]);

    const duplicate = await service.purchase({
      actionId: "awakening-materials",
      purchaseId: "hero-a:awakening-pack-1"
    });
    expect(duplicate).toMatchObject({ ok: true, status: "already_committed" });
    expect(store.getSnapshot().resources.awakeningMaterials).toBe(1);
  });

  it("keeps ambiguous Host failures pending and retries with the same key", async () => {
    const host = createMockGameHost({ initialBalance: 100, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const realSpend = host.wallet.spend.bind(host.wallet);
    let failOnce = true;
    host.wallet.spend = vi.fn(async (input) => {
      if (failOnce) {
        failOnce = false;
        return { ok: false as const, code: "timeout", message: "timeout", balance: 100 };
      }
      return realSpend(input);
    });
    const service = new PurchaseService(host, store, (_purchase, draft) => {
      draft.endgame.weeklyStormRuns += 1;
    });

    const first = await service.purchase({
      actionId: "storm-extra-run",
      purchaseId: "week-27-extra-1"
    });
    expect(first).toMatchObject({ ok: false, status: "recoverable", code: "timeout" });
    const keyBefore = store.getSnapshot().pendingPurchases[0]?.idempotencyKey;

    const recovered = await service.recoverPendingPurchases();
    expect(recovered[0]).toMatchObject({ ok: true, status: "committed" });
    expect(host.wallet.spend).toHaveBeenCalledTimes(2);
    expect((host.wallet.spend as ReturnType<typeof vi.fn>).mock.calls[1]?.[0].idempotencyKey).toBe(
      keyBefore
    );
    expect(store.getSnapshot().endgame.weeklyStormRuns).toBe(1);
  });

  it("reuses the original summon id and reward when a recoverable purchase is retried", async () => {
    const host = createMockGameHost({ initialBalance: 200, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const realSpend = host.wallet.spend.bind(host.wallet);
    let failOnce = true;
    host.wallet.spend = vi.fn(async (input) => {
      if (failOnce) {
        failOnce = false;
        return { ok: false as const, code: "timeout", message: "timeout", balance: 200 };
      }
      return realSpend(input);
    });
    const committedRewards: unknown[] = [];
    const service = new PurchaseService(host, store, (purchase, draft) => {
      committedRewards.push(purchase.reward);
      draft.summons.oraclePulls += 1;
    });
    const originalReward = { pulls: [{ heroId: "heli-paws", rarity: 5 }] };
    const first = await service.purchase({
      actionId: "oracle-summon-1",
      purchaseId: "oracle-stable-retry",
      reward: originalReward,
    });
    expect(first).toMatchObject({ ok: false, status: "recoverable" });
    const persisted = store.getSnapshot().pendingPurchases[0];

    const retried = await service.purchase({
      actionId: "oracle-summon-1",
      purchaseId: "oracle-stable-retry",
      reward: { pulls: [{ heroId: "different-result", rarity: 3 }] },
    });

    expect(retried).toMatchObject({
      ok: true,
      purchaseId: "oracle-stable-retry",
      balanceAfter: 100,
    });
    expect(host.wallet.spend).toHaveBeenCalledTimes(2);
    expect((host.wallet.spend as ReturnType<typeof vi.fn>).mock.calls[1]?.[0].idempotencyKey)
      .toBe(persisted?.idempotencyKey);
    expect(committedRewards).toEqual([originalReward]);
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(store.getSnapshot().pendingPurchases).toEqual([]);
  });

  it("quarantines a charged malformed summon journal without partial or repeated rewards", async () => {
    const host = createMockGameHost({
      initialBalance: 1_000,
      confirm: async () => true,
      transactionId: () => "tx-malformed-summon",
    });
    const store = new GameSaveStore(host);
    await store.load();
    const resolved = resolveOracleSummons(store.getSnapshot(), {
      seed: "malformed-summon",
      count: 10,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const malformed = structuredClone(createOraclePurchaseReward(resolved));
    const malformedPulls = malformed.pulls;
    if (!Array.isArray(malformedPulls)) throw new Error("missing generated summon pulls");
    malformed.pulls = malformedPulls.slice(0, 9);
    const service = new PurchaseService(host, store, commitPurchaseReward);
    const before = store.getSnapshot();

    const first = await service.purchase({
      actionId: "oracle-summon-10",
      purchaseId: "malformed-summon",
      reward: malformed,
    });
    expect(first).toMatchObject({
      ok: false,
      status: "recoverable",
      code: "reward_commit_failed",
    });
    expect(host.__mock.getBalance()).toBe(100);
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(store.getSnapshot()).toMatchObject({
      roster: before.roster,
      resources: before.resources,
      summons: before.summons,
      purchaseReceipts: [],
      pendingPurchases: [expect.objectContaining({
        purchaseId: "malformed-summon",
        phase: "spent",
        transactionId: "tx-malformed-summon",
      })],
    });

    const retried = await service.recoverPendingPurchases();
    expect(retried).toEqual([expect.objectContaining({
      ok: false,
      status: "recoverable",
      code: "reward_commit_failed",
    })]);
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(store.getSnapshot().roster).toEqual(before.roster);
    expect(store.getSnapshot().summons).toEqual(before.summons);
    expect(store.getSnapshot().purchaseReceipts).toEqual([]);
    expect(store.getSnapshot().pendingPurchases).toHaveLength(1);
  });

  it("removes terminal cancellation and insufficient-balance intents", async () => {
    const cancelHost = createMockGameHost({
      initialBalance: 100,
      confirm: async () => false
    });
    const cancelStore = new GameSaveStore(cancelHost);
    await cancelStore.load();
    const cancelService = new PurchaseService(cancelHost, cancelStore, () => undefined);
    await expect(
      cancelService.purchase({ actionId: "oracle-summon-1", purchaseId: "cancel" })
    ).resolves.toMatchObject({ ok: false, status: "rejected", code: "cancelled" });
    expect(cancelStore.getSnapshot().pendingPurchases).toEqual([]);

    const poorHost = createMockGameHost({ initialBalance: 10, confirm: async () => true });
    const poorStore = new GameSaveStore(poorHost);
    await poorStore.load();
    const poorService = new PurchaseService(poorHost, poorStore, () => undefined);
    await expect(
      poorService.purchase({ actionId: "battle-rescue", purchaseId: "poor" })
    ).resolves.toMatchObject({
      ok: false,
      status: "rejected",
      code: "insufficient_balance",
      balance: 10
    });
    expect(poorStore.getSnapshot().pendingPurchases).toEqual([]);
  });

  it("coalesces rapid duplicate clicks and resumes the same anonymous pending intent", async () => {
    const host = createMockGameHost({ initialBalance: 200, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const commit = vi.fn((_purchase, draft) => { draft.endgame.raidKeys += 1; });
    const service = new PurchaseService(host, store, commit);
    const [first, second] = await Promise.all([
      service.purchase({ actionId: "raid-extra-key" }),
      service.purchase({ actionId: "raid-extra-key" }),
    ]);
    expect(first).toEqual(second);
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().endgame.raidKeys).toBe(1);
  });

  it("returns a recoverable result without charging when the initial journal write fails", async () => {
    const host = createMockGameHost({ initialBalance: 200, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const durableWrite = host.save.write.bind(host.save);
    let writesAvailable = false;
    host.save.write = async <T>(value: T): Promise<void> => {
      if (!writesAvailable) throw new Error("storage offline");
      await durableWrite(value);
    };
    const realSpend = host.wallet.spend.bind(host.wallet);
    host.wallet.spend = vi.fn(realSpend);
    const service = new PurchaseService(host, store, (_purchase, draft) => {
      draft.endgame.raidKeys += 1;
    });

    const first = await service.purchase({
      actionId: "raid-extra-key",
      purchaseId: "journal-write-retry",
    });
    expect(first).toMatchObject({
      ok: false,
      status: "recoverable",
      code: "purchase_journal_unavailable",
    });
    expect(host.wallet.spend).not.toHaveBeenCalled();
    expect(host.__mock.getBalance()).toBe(200);
    expect(store.getSnapshot().pendingPurchases).toEqual([
      expect.objectContaining({ purchaseId: "journal-write-retry", phase: "spending" }),
    ]);

    writesAvailable = true;
    const recovered = await service.recoverPendingPurchases();
    expect(recovered).toEqual([
      expect.objectContaining({ ok: true, status: "committed" }),
    ]);
    expect(host.wallet.spend).toHaveBeenCalledTimes(1);
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(store.getSnapshot().endgame.raidKeys).toBe(1);
  });

  it("rechecks journal durability before replaying an already pending wallet intent", async () => {
    const host = createMockGameHost({ initialBalance: 200, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const durableWrite = host.save.write.bind(host.save);
    const realSpend = host.wallet.spend.bind(host.wallet);
    let timeoutOnce = true;
    host.wallet.spend = vi.fn(async (input) => {
      if (timeoutOnce) {
        timeoutOnce = false;
        return { ok: false as const, code: "timeout", message: "timeout", balance: 200 };
      }
      return realSpend(input);
    });
    const service = new PurchaseService(host, store, (_purchase, draft) => {
      draft.endgame.raidKeys += 1;
    });
    await expect(service.purchase({
      actionId: "raid-extra-key",
      purchaseId: "persist-before-replay",
    })).resolves.toMatchObject({ ok: false, code: "timeout" });
    expect(host.wallet.spend).toHaveBeenCalledTimes(1);

    let writesAvailable = false;
    host.save.write = async <T>(value: T): Promise<void> => {
      if (!writesAvailable) throw new Error("storage offline during recovery");
      await durableWrite(value);
    };
    const blocked = await service.recoverPendingPurchases();
    expect(blocked).toEqual([
      expect.objectContaining({
        ok: false,
        status: "recoverable",
        code: "purchase_journal_unavailable",
      }),
    ]);
    expect(host.wallet.spend).toHaveBeenCalledTimes(1);
    expect(host.__mock.getBalance()).toBe(200);

    writesAvailable = true;
    const recovered = await service.recoverPendingPurchases();
    expect(recovered).toEqual([
      expect.objectContaining({ ok: true, status: "committed" }),
    ]);
    expect(host.wallet.spend).toHaveBeenCalledTimes(2);
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
    expect(host.__mock.getBalance()).toBe(150);
    expect(store.getSnapshot().endgame.raidKeys).toBe(1);
  });

  it("allows every declared product with a committed reward path", async () => {
    const host = createMockGameHost({ initialBalance: 1_000, confirm: async () => true });
    const store = new GameSaveStore(host);
    await store.load();
    const service = new PurchaseService(host, store, () => undefined);
    await expect(service.purchase({ actionId: "vault-expansion" })).resolves.toMatchObject({
      ok: true,
      actionId: "vault-expansion",
    });
    await expect(service.purchase({ actionId: "blessing-reroll" })).resolves.toMatchObject({
      ok: true,
      actionId: "blessing-reroll",
    });
    expect(host.__mock.getSuccessfulSpendCount()).toBe(2);
    expect(store.getSnapshot().pendingPurchases).toEqual([]);
  });
});
