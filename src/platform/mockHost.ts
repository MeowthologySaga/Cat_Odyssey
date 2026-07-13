import {
  DIAMOND_ACTIONS,
  matchesDiamondAction,
  type DiamondActionDefinition
} from "./diamondActions";

export type MockStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type MockConfirm = (input: {
  title: string;
  message: string;
}) => boolean | Promise<boolean>;

export type MockHostOptions = {
  packId?: string;
  appVersion?: string;
  initialBalance?: number;
  actions?: readonly DiamondActionDefinition[];
  storage?: MockStorage;
  saveKey?: string;
  confirm?: MockConfirm;
  toast?: (message: string) => void;
  transactionId?: () => string;
};

export type MockHostInspection = {
  getBalance(): number;
  setBalance(balance: number): void;
  getSuccessfulSpendCount(): number;
  getSavedValue(): unknown;
};

export type MockGameHostApi = LemGameHostApi & {
  readonly __mock: MockHostInspection;
};

type IdempotentSpend = {
  fingerprint: string;
  result: Extract<LemSpendResult, { ok: true }>;
};

export function createMemoryStorage(): MockStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

export function createMockGameHost(options: MockHostOptions = {}): MockGameHostApi {
  const actions = options.actions ?? DIAMOND_ACTIONS;
  const actionMap = new Map(actions.map((action) => [action.id, action]));
  const storage = options.storage ?? readBrowserStorage() ?? createMemoryStorage();
  const saveKey = options.saveKey ?? "mock:cat-odyssey:save-v1";
  const idempotency = new Map<string, IdempotentSpend>();
  const completedNonRepeatableActions = new Set<string>();
  let balance = normalizeBalance(options.initialBalance ?? 2_000);
  let transactionSequence = 0;

  const confirm: MockConfirm = options.confirm ?? defaultConfirm;

  const api: MockGameHostApi = {
    packId: options.packId ?? "meowthology.cat-odyssey",
    appVersion: options.appVersion ?? "mock-preview",
    wallet: {
      async getBalance() {
        return { balance };
      },
      async spend(input) {
        const declared = actionMap.get(input.id);
        if (!declared || !matchesDiamondAction(input, declared)) {
          return failedSpend(
            "invalid_action",
            "manifest에 선언된 액션과 일치하지 않는 요청입니다.",
            balance
          );
        }
        if (!input.idempotencyKey || !input.idempotencyKey.trim()) {
          return failedSpend(
            "invalid_idempotency_key",
            "idempotencyKey가 필요합니다.",
            balance
          );
        }

        const fingerprint = createSpendFingerprint(input);
        const previous = idempotency.get(input.idempotencyKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint) {
            return failedSpend(
              "invalid_idempotency_key",
              "같은 idempotencyKey가 다른 구매 요청에 사용되었습니다.",
              balance
            );
          }
          return { ...previous.result, idempotentReplay: true };
        }

        if (!declared.repeatable && completedNonRepeatableActions.has(declared.id)) {
          return failedSpend(
            "invalid_action",
            "이미 완료한 영구 구매입니다.",
            balance
          );
        }
        if (balance < declared.amount) {
          return failedSpend(
            "insufficient_balance",
            "다이아 잔액이 부족합니다.",
            balance
          );
        }
        if (declared.requiresConfirm) {
          const approved = await confirm({
            title: "다이아 사용 확인",
            message: `${declared.reason}\n\n필요 다이아: ${declared.amount}\n현재 잔액: ${balance}`
          });
          if (!approved) {
            return failedSpend("cancelled", "사용자가 취소했습니다.", balance);
          }
        }

        balance -= declared.amount;
        const result: Extract<LemSpendResult, { ok: true }> = {
          ok: true,
          transactionId:
            options.transactionId?.() ?? `mock-${Date.now()}-${++transactionSequence}`,
          balanceAfter: balance
        };
        idempotency.set(input.idempotencyKey, { fingerprint, result });
        if (!declared.repeatable) {
          completedNonRepeatableActions.add(declared.id);
        }
        return result;
      }
    },
    save: {
      async load<T>(fallback: T): Promise<T> {
        const raw = storage.getItem(saveKey);
        if (!raw) {
          return cloneValue(fallback);
        }
        try {
          return JSON.parse(raw) as T;
        } catch {
          return cloneValue(fallback);
        }
      },
      async write<T>(value: T): Promise<void> {
        storage.setItem(saveKey, JSON.stringify(value));
      },
      async clear(): Promise<void> {
        storage.removeItem(saveKey);
      }
    },
    ui: {
      toast(message) {
        options.toast?.(message);
      },
      async confirm(input) {
        return confirm(input);
      }
    },
    __mock: {
      getBalance() {
        return balance;
      },
      setBalance(nextBalance) {
        balance = normalizeBalance(nextBalance);
      },
      getSuccessfulSpendCount() {
        return idempotency.size;
      },
      getSavedValue() {
        const raw = storage.getItem(saveKey);
        if (!raw) {
          return undefined;
        }
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return undefined;
        }
      }
    }
  };

  return api;
}

function failedSpend(code: string, message: string, balance: number): LemSpendResult {
  return { ok: false, code, message, balance };
}

function createSpendFingerprint(input: LemSpendInput): string {
  return JSON.stringify([
    input.id,
    input.amount,
    input.reason,
    input.requiresConfirm ?? null
  ]);
}

function normalizeBalance(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function readBrowserStorage(): MockStorage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const storage = window.localStorage;
    const probeKey = "__cat_odyssey_storage_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return undefined;
  }
}

async function defaultConfirm(input: { title: string; message: string }): Promise<boolean> {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }
  return window.confirm([input.title, input.message].filter(Boolean).join("\n\n"));
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
