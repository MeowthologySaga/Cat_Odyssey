import {
  createMockGameHost,
  createSpendInput
} from "../../src/platform";
import { describe, expect, it, vi } from "vitest";

describe("mock PlayZone Host", () => {
  it("validates manifest parity and replays one successful idempotency key", async () => {
    const confirm = vi.fn(async () => true);
    const host = createMockGameHost({
      initialBalance: 150,
      confirm,
      transactionId: () => "tx-1"
    });
    const input = createSpendInput("oracle-summon-1", "banner-1:pull-1");

    await expect(host.wallet.spend(input)).resolves.toEqual({
      ok: true,
      transactionId: "tx-1",
      balanceAfter: 50
    });
    await expect(host.wallet.spend(input)).resolves.toEqual({
      ok: true,
      transactionId: "tx-1",
      balanceAfter: 50,
      idempotentReplay: true
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(host.__mock.getBalance()).toBe(50);
    expect(host.__mock.getSuccessfulSpendCount()).toBe(1);
  });

  it("rejects a request whose price, reason, or confirmation flag differs", async () => {
    const host = createMockGameHost({ initialBalance: 1_000 });
    const input = createSpendInput("battle-rescue", "run-2:rescue");

    await expect(
      host.wallet.spend({ ...input, reason: "다른 사유" })
    ).resolves.toMatchObject({ ok: false, code: "invalid_action", balance: 1_000 });
    await expect(
      host.wallet.spend({ ...input, amount: 1 })
    ).resolves.toMatchObject({ ok: false, code: "invalid_action", balance: 1_000 });
    await expect(
      host.wallet.spend({ ...input, requiresConfirm: false })
    ).resolves.toMatchObject({ ok: false, code: "invalid_action", balance: 1_000 });
  });

  it("supports cancellation and insufficient balance without charging", async () => {
    const cancelHost = createMockGameHost({
      initialBalance: 200,
      confirm: async () => false
    });
    await expect(
      cancelHost.wallet.spend(createSpendInput("oracle-summon-1", "cancel-1"))
    ).resolves.toMatchObject({ ok: false, code: "cancelled", balance: 200 });
    expect(cancelHost.__mock.getBalance()).toBe(200);

    const confirm = vi.fn(async () => true);
    const poorHost = createMockGameHost({ initialBalance: 99, confirm });
    await expect(
      poorHost.wallet.spend(createSpendInput("oracle-summon-1", "poor-1"))
    ).resolves.toMatchObject({ ok: false, code: "insufficient_balance", balance: 99 });
    expect(confirm).not.toHaveBeenCalled();
    expect(poorHost.__mock.getBalance()).toBe(99);
  });

  it("blocks a second non-repeatable purchase even with a new key", async () => {
    const host = createMockGameHost({ initialBalance: 1_000, confirm: async () => true });
    await expect(
      host.wallet.spend(createSpendInput("vault-expansion", "vault-1"))
    ).resolves.toMatchObject({ ok: true, balanceAfter: 820 });
    await expect(
      host.wallet.spend(createSpendInput("vault-expansion", "vault-2"))
    ).resolves.toMatchObject({ ok: false, code: "invalid_action", balance: 820 });
  });

  it("keeps mock save separate from wallet balance", async () => {
    const host = createMockGameHost({ initialBalance: 555 });
    await host.save.write({ schemaVersion: 1, gold: 12 });
    expect(host.__mock.getSavedValue()).toEqual({ schemaVersion: 1, gold: 12 });
    await expect(host.wallet.getBalance()).resolves.toEqual({ balance: 555 });
  });
});
