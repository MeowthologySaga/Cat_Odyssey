import { describe, expect, it, vi } from "vitest";

import {
  announceRecoveredPurchases,
  reconcileWalletAfterPurchase,
} from "../../src/core/services";

describe("purchase UI safety", () => {
  it("applies balanceAfter immediately and swallows a failed background refresh", async () => {
    const wallet = {
      walletBalance: 900,
      refreshWallet: vi.fn(async () => {
        throw new Error("balance endpoint unavailable");
      }),
    };

    reconcileWalletAfterPurchase(wallet, { balanceAfter: 320 });

    expect(wallet.walletBalance).toBe(320);
    expect(wallet.refreshWallet).toHaveBeenCalledOnce();
    await Promise.resolve();
    await Promise.resolve();
    expect(wallet.walletBalance).toBe(320);
  });

  it("announces both recovered rewards and still-unresolved purchases", () => {
    const toast = vi.fn();
    announceRecoveredPurchases({
      ui: { toast, confirm: vi.fn(async () => true) },
    }, [
      {
        ok: true,
        status: "committed",
        purchaseId: "recovered-1",
        actionId: "oracle-summon-1",
        transactionId: "tx-1",
      },
      {
        ok: false,
        status: "recoverable",
        purchaseId: "pending-1",
        actionId: "raid-extra-key",
        code: "host_error",
        message: "offline",
      },
    ]);

    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast.mock.calls[0]?.[0]).toContain("보상을 안전하게 복구");
    expect(toast.mock.calls[1]?.[0]).toContain("확인 중인 결제");
  });
});
