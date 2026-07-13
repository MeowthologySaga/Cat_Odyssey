import {
  createSpendInput,
  getDiamondAction,
  isDiamondActionAvailable,
  isDiamondActionId,
  type DiamondActionId
} from "../platform/diamondActions";
import { GameSaveStore } from "./gameSaveStore";
import {
  type GameSaveV1,
  type JsonObject,
  type PendingPurchase,
  type PurchaseReceipt
} from "./saveSchema";
import {
  hasVaultExpansionEntitlement,
  repairVaultExpansionEntitlement,
} from "./entitlements";

export type PurchaseIntent = {
  actionId: DiamondActionId;
  /** A stable gameplay intent id, for example `banner-3:pull-17` or `run-42:revive`. */
  purchaseId?: string;
  reward?: JsonObject;
};

export type PurchaseSuccess = {
  ok: true;
  status: "committed" | "already_committed";
  purchaseId: string;
  actionId: DiamondActionId;
  transactionId: string;
  /** Returned to the UI only. It is never copied into GameSaveV1. */
  balanceAfter?: number;
};

export type PurchaseFailure = {
  ok: false;
  status: "rejected" | "recoverable";
  purchaseId: string;
  actionId: DiamondActionId;
  code: string;
  message: string;
  balance?: number;
};

export type PurchaseResult = PurchaseSuccess | PurchaseFailure;

export type PurchaseRewardCommitter = (
  purchase: Readonly<PendingPurchase>,
  draft: GameSaveV1
) => void | Promise<void>;

export type PurchaseServiceOptions = {
  now?: () => number;
  createPurchaseId?: () => string;
  maxReceipts?: number;
  /** Developer sandboxes must never reach the real wallet. */
  walletSpendingDisabled?: boolean;
};

const TERMINAL_SPEND_FAILURES = new Set([
  "cancelled",
  "insufficient_balance",
  "invalid_action",
  "invalid_amount",
  "invalid_idempotency_key"
]);

export class PurchaseService {
  private operationTail: Promise<void> = Promise.resolve();
  private readonly inFlightByIntent = new Map<string, Promise<PurchaseResult>>();
  private generatedIdSequence = 0;
  private readonly now: () => number;
  private readonly createPurchaseId: () => string;
  private readonly maxReceipts: number;
  private readonly walletSpendingDisabled: boolean;

  constructor(
    private readonly host: LemGameHostApi,
    private readonly store: GameSaveStore,
    private readonly commitReward: PurchaseRewardCommitter,
    options: PurchaseServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.createPurchaseId = options.createPurchaseId ?? (() => this.defaultPurchaseId());
    this.maxReceipts = Math.max(20, Math.floor(options.maxReceipts ?? 200));
    this.walletSpendingDisabled = options.walletSpendingDisabled ?? false;
  }

  purchase(intent: PurchaseIntent): Promise<PurchaseResult> {
    if (this.walletSpendingDisabled) {
      if (!isDiamondActionId(intent.actionId)) {
        return Promise.reject(new Error(`Unknown diamond action: ${String(intent.actionId)}`));
      }
      const purchaseId = normalizePurchaseId(
        intent.purchaseId ?? `debug-blocked-${intent.actionId}`,
      );
      return Promise.resolve(this.failure(
        "rejected",
        purchaseId,
        intent.actionId,
        "debug_mode_wallet_disabled",
        "개발 항해에서는 실제 다이아를 사용하지 않습니다. 테스트 재화는 개발 항해실에서 보급하세요.",
      ));
    }
    const key = `${intent.actionId}:${intent.purchaseId?.trim() || "active"}`;
    const existing = this.inFlightByIntent.get(key);
    if (existing) return existing;
    const operation = this.runExclusive(() => this.purchaseInternal(intent));
    this.inFlightByIntent.set(key, operation);
    const cleanup = () => {
      if (this.inFlightByIntent.get(key) === operation) this.inFlightByIntent.delete(key);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }

  recoverPendingPurchases(): Promise<PurchaseResult[]> {
    if (this.walletSpendingDisabled) return Promise.resolve([]);
    return this.runExclusive(async () => {
      const pendingIds = this.store.getSnapshot().pendingPurchases.map(({ purchaseId }) => purchaseId);
      const results: PurchaseResult[] = [];
      for (const purchaseId of pendingIds) {
        const pending = this.findPending(purchaseId);
        if (pending) {
          results.push(await this.resumePending(pending));
        }
      }
      return results;
    });
  }

  private async purchaseInternal(intent: PurchaseIntent): Promise<PurchaseResult> {
    if (!isDiamondActionId(intent.actionId)) {
      throw new Error(`Unknown diamond action: ${String(intent.actionId)}`);
    }
    const action = getDiamondAction(intent.actionId);
    if (!action) {
      throw new Error(`Unknown diamond action: ${intent.actionId}`);
    }

    const snapshot = this.store.getSnapshot();
    const resumable = intent.purchaseId
      ? undefined
      : snapshot.pendingPurchases.find((entry) => entry.actionId === intent.actionId);
    const purchaseId = normalizePurchaseId(
      intent.purchaseId ?? resumable?.purchaseId ?? this.createPurchaseId()
    );
    if (!isDiamondActionAvailable(intent.actionId)) {
      return this.failure(
        "rejected",
        purchaseId,
        intent.actionId,
        "action_unavailable",
        "아직 실제 보상을 사용할 수 없는 상품입니다. 결제하지 않았습니다."
      );
    }

    const receipt = snapshot.purchaseReceipts.find(
      (entry) =>
        entry.purchaseId === purchaseId || (!action.repeatable && entry.actionId === intent.actionId)
    );
    if (receipt) {
      if (receipt.actionId !== intent.actionId) {
        return this.failure(
          "rejected",
          purchaseId,
          intent.actionId,
          "purchase_id_conflict",
          "purchaseId가 다른 구매에 이미 사용되었습니다."
        );
      }
      if (receipt.actionId === "vault-expansion") {
        await this.store.update((draft) => {
          repairVaultExpansionEntitlement(draft);
        });
      }
      return {
        ok: true,
        status: "already_committed",
        purchaseId: receipt.purchaseId,
        actionId: receipt.actionId,
        transactionId: receipt.transactionId
      };
    }

    const matchingPending = snapshot.pendingPurchases.some(
      (entry) => entry.purchaseId === purchaseId,
    );
    if (
      intent.actionId === "battle-rescue"
      && snapshot.recovery.pendingBattleRescue
      && !matchingPending
    ) {
      return this.failure(
        "rejected",
        purchaseId,
        intent.actionId,
        "pending_rescue_exists",
        "사용하지 않은 전투 구조가 있습니다. 먼저 기존 전투를 이어가세요.",
      );
    }
    if (
      intent.actionId === "vault-expansion"
      && hasVaultExpansionEntitlement(snapshot)
      && !matchingPending
    ) {
      return this.failure(
        "rejected",
        purchaseId,
        intent.actionId,
        "entitlement_already_owned",
        "보물고 확장은 이미 적용되었습니다.",
      );
    }

    const existing = snapshot.pendingPurchases.find((entry) => entry.purchaseId === purchaseId);
    if (existing) {
      if (existing.actionId !== intent.actionId) {
        return this.failure(
          "rejected",
          purchaseId,
          intent.actionId,
          "purchase_id_conflict",
          "purchaseId가 다른 pending 구매에 사용되었습니다."
        );
      }
      return this.resumePending(existing);
    }

    const timestamp = this.now();
    const pending: PendingPurchase = {
      purchaseId,
      actionId: intent.actionId,
      idempotencyKey: `${this.host.packId}:${intent.actionId}:${purchaseId}`,
      phase: "spending",
      createdAt: timestamp,
      updatedAt: timestamp,
      reward: cloneJsonObject(intent.reward ?? {})
    };

    // Persist the intent before the Host is allowed to charge the wallet. GameSaveStore keeps
    // the failed snapshot installed in memory so this exact journal can be retried, but a failed
    // write is a recoverable result rather than permission to continue to wallet.spend.
    try {
      await this.store.update((draft) => {
        draft.pendingPurchases.push(pending);
      });
    } catch (error) {
      return this.persistenceFailure(pending, error);
    }
    return this.resumePending(pending);
  }

  private async resumePending(pendingInput: PendingPurchase): Promise<PurchaseResult> {
    const pending = this.findPending(pendingInput.purchaseId);
    if (!pending) {
      const receipt = this.findReceipt(pendingInput.purchaseId);
      if (receipt) {
        return {
          ok: true,
          status: "already_committed",
          purchaseId: receipt.purchaseId,
          actionId: receipt.actionId,
          transactionId: receipt.transactionId
        };
      }
      return this.failure(
        "recoverable",
        pendingInput.purchaseId,
        pendingInput.actionId,
        "pending_purchase_missing",
        "pending 구매를 찾지 못했습니다."
      );
    }

    const existingRescue = this.store.getSnapshot().recovery.pendingBattleRescue;
    if (
      pending.actionId === "battle-rescue"
      && existingRescue
      && existingRescue.purchaseId !== pending.purchaseId
    ) {
      if (pending.phase === "spending") {
        // This intent is known not to have reached the wallet yet. Remove it so
        // launch recovery cannot charge a second rescue behind the player's back.
        await this.removePending(pending.purchaseId);
        return this.failure(
          "rejected",
          pending.purchaseId,
          pending.actionId,
          "pending_rescue_exists",
          "사용하지 않은 전투 구조가 있어 추가 결제를 취소했습니다.",
        );
      }
      // A pre-existing spent journal needs support/retry, but must never replace
      // the authoritative paid rescue already waiting in recovery.
      return this.failure(
        "recoverable",
        pending.purchaseId,
        pending.actionId,
        "pending_rescue_conflict",
        "이미 차감된 구조 기록이 다른 구조와 충돌합니다. 어느 쪽도 덮어쓰지 않았습니다.",
      );
    }

    if (
      pending.actionId === "vault-expansion"
      && pending.phase === "spending"
      && hasVaultExpansionEntitlement(this.store.getSnapshot())
    ) {
      await this.removePending(pending.purchaseId);
      return this.failure(
        "rejected",
        pending.purchaseId,
        pending.actionId,
        "entitlement_already_owned",
        "보물고 확장은 이미 적용되었습니다.",
      );
    }

    if (pending.phase === "spent") {
      return this.commitSpentPurchase(pending);
    }

    // Even an in-memory `spending` entry may come from a failed earlier write. Re-persist the
    // complete current snapshot immediately before every wallet attempt. This also protects
    // launch recovery when canonical save write-back was temporarily unavailable.
    try {
      await this.store.saveNow();
    } catch (error) {
      return this.persistenceFailure(pending, error);
    }

    let spendResult: LemSpendResult;
    try {
      spendResult = await this.host.wallet.spend(
        createSpendInput(pending.actionId, pending.idempotencyKey)
      );
    } catch (error) {
      return this.failure(
        "recoverable",
        pending.purchaseId,
        pending.actionId,
        "host_error",
        error instanceof Error ? error.message : String(error)
      );
    }

    if (!spendResult.ok) {
      if (TERMINAL_SPEND_FAILURES.has(spendResult.code)) {
        await this.removePending(pending.purchaseId);
      }
      return this.failure(
        TERMINAL_SPEND_FAILURES.has(spendResult.code) ? "rejected" : "recoverable",
        pending.purchaseId,
        pending.actionId,
        spendResult.code,
        spendResult.message,
        spendResult.balance
      );
    }

    const spentAt = this.now();
    try {
      await this.store.update((draft) => {
        const target = draft.pendingPurchases.find(
          (entry) => entry.purchaseId === pending.purchaseId
        );
        if (!target) {
          return;
        }
        target.phase = "spent";
        target.transactionId = spendResult.transactionId;
        target.updatedAt = spentAt;
      });
    } catch (error) {
      // The previous persisted state still contains the same idempotency key. On the next
      // launch it can safely replay wallet.spend and receive the original Host result.
      return this.failure(
        "recoverable",
        pending.purchaseId,
        pending.actionId,
        "spend_state_save_failed",
        error instanceof Error ? error.message : String(error)
      );
    }

    const spentPending = this.findPending(pending.purchaseId);
    if (!spentPending || spentPending.phase !== "spent") {
      return this.failure(
        "recoverable",
        pending.purchaseId,
        pending.actionId,
        "spend_state_not_persisted",
        "차감 결과를 저장하지 못했습니다. 같은 구매 키로 복구할 수 있습니다."
      );
    }
    const committed = await this.commitSpentPurchase(spentPending);
    return committed.ok
      ? { ...committed, balanceAfter: spendResult.balanceAfter }
      : committed;
  }

  private async commitSpentPurchase(pending: PendingPurchase): Promise<PurchaseResult> {
    if (!pending.transactionId) {
      return this.failure(
        "recoverable",
        pending.purchaseId,
        pending.actionId,
        "missing_transaction_id",
        "차감 거래 번호가 없어 보상을 복구할 수 없습니다."
      );
    }

    const existingReceipt = this.findReceipt(pending.purchaseId);
    if (existingReceipt) {
      await this.removePending(pending.purchaseId);
      return {
        ok: true,
        status: "already_committed",
        purchaseId: existingReceipt.purchaseId,
        actionId: existingReceipt.actionId,
        transactionId: existingReceipt.transactionId
      };
    }

    const draft = this.store.getSnapshot();
    const draftPending = draft.pendingPurchases.find(
      (entry) => entry.purchaseId === pending.purchaseId
    );
    if (!draftPending) {
      return this.failure(
        "recoverable",
        pending.purchaseId,
        pending.actionId,
        "pending_purchase_missing",
        "보상 커밋용 pending 구매를 찾지 못했습니다."
      );
    }

    try {
      // The callback must only mutate this draft. External side effects would not be replay-safe.
      await this.commitReward(Object.freeze(clonePending(draftPending)), draft);
    } catch (error) {
      return this.failure(
        "recoverable",
        pending.purchaseId,
        pending.actionId,
        "reward_commit_failed",
        error instanceof Error ? error.message : String(error)
      );
    }

    const receipt: PurchaseReceipt = {
      purchaseId: pending.purchaseId,
      actionId: pending.actionId,
      transactionId: pending.transactionId,
      committedAt: this.now()
    };
    draft.pendingPurchases = draft.pendingPurchases.filter(
      (entry) => entry.purchaseId !== pending.purchaseId
    );
    draft.purchaseReceipts = retainPurchaseReceipts(
      [...draft.purchaseReceipts, receipt],
      this.maxReceipts,
    );

    try {
      await this.store.replace(draft);
    } catch (error) {
      return this.failure(
        "recoverable",
        pending.purchaseId,
        pending.actionId,
        "reward_save_failed",
        error instanceof Error ? error.message : String(error)
      );
    }

    return {
      ok: true,
      status: "committed",
      purchaseId: pending.purchaseId,
      actionId: pending.actionId,
      transactionId: pending.transactionId
    };
  }

  private async removePending(purchaseId: string): Promise<void> {
    await this.store.update((draft) => {
      draft.pendingPurchases = draft.pendingPurchases.filter(
        (entry) => entry.purchaseId !== purchaseId
      );
    });
  }

  private findPending(purchaseId: string): PendingPurchase | undefined {
    return this.store
      .getSnapshot()
      .pendingPurchases.find((entry) => entry.purchaseId === purchaseId);
  }

  private findReceipt(purchaseId: string): PurchaseReceipt | undefined {
    return this.store
      .getSnapshot()
      .purchaseReceipts.find((entry) => entry.purchaseId === purchaseId);
  }

  private failure(
    status: PurchaseFailure["status"],
    purchaseId: string,
    actionId: DiamondActionId,
    code: string,
    message: string,
    balance?: number
  ): PurchaseFailure {
    return {
      ok: false,
      status,
      purchaseId,
      actionId,
      code,
      message,
      ...(balance === undefined ? {} : { balance })
    };
  }

  private persistenceFailure(
    purchase: Pick<PendingPurchase, "purchaseId" | "actionId">,
    error: unknown,
  ): PurchaseFailure {
    const detail = error instanceof Error ? error.message : String(error);
    return this.failure(
      "recoverable",
      purchase.purchaseId,
      purchase.actionId,
      "purchase_journal_unavailable",
      `구매 기록을 안전하게 저장할 수 없어 결제를 시작하지 않았습니다. 저장이 복구되면 다시 시도하세요. (${detail})`,
    );
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.catch(() => undefined).then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private defaultPurchaseId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `purchase-${this.now()}-${++this.generatedIdSequence}`;
  }
}

function normalizePurchaseId(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 160);
  if (!normalized) {
    throw new Error("purchaseId must not be empty.");
  }
  return normalized;
}

function clonePending(pending: PendingPurchase): PendingPurchase {
  return {
    ...pending,
    reward: cloneJsonObject(pending.reward)
  };
}

function cloneJsonObject(value: JsonObject): JsonObject {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/** Keep non-repeatable entitlements even after the rolling transaction log fills up. */
function retainPurchaseReceipts(
  receipts: readonly PurchaseReceipt[],
  maximum: number,
): PurchaseReceipt[] {
  const permanent = receipts.filter(
    (receipt) => getDiamondAction(receipt.actionId)?.repeatable === false,
  );
  const remaining = Math.max(0, maximum - permanent.length);
  const recentRepeatable = remaining > 0
    ? receipts
        .filter((receipt) => getDiamondAction(receipt.actionId)?.repeatable !== false)
        .slice(-remaining)
    : [];
  const retainedIds = new Set(
    [...permanent, ...recentRepeatable].map((receipt) => receipt.purchaseId),
  );
  return receipts.filter((receipt) => retainedIds.has(receipt.purchaseId));
}
