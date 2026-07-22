export {};

declare global {
  interface LemSpendInput {
    id: string;
    amount: number;
    reason: string;
    requiresConfirm?: boolean;
    idempotencyKey: string;
  }

  type LemSpendResult =
    | {
        ok: true;
        transactionId: string;
        balanceAfter: number;
        idempotentReplay?: boolean;
      }
    | {
        ok: false;
        code: string;
        message: string;
        balance?: number;
      };

  interface LemGameHostApi {
    packId: string;
    appVersion: string;
    /** Optional forward-compatible locale hint. Current PlayZone hosts may omit it. */
    locale?: string;
    wallet: {
      getBalance(): Promise<{ balance: number }>;
      spend(input: LemSpendInput): Promise<LemSpendResult>;
    };
    save: {
      load<T>(fallback: T): Promise<T>;
      write<T>(value: T): Promise<void>;
      clear(): Promise<void>;
    };
    ui: {
      toast(message: string): void;
      confirm(input: { title: string; message: string }): Promise<boolean>;
    };
  }

  interface Window {
    LEM_GAME_HOST_API?: LemGameHostApi;
    __CAT_ODYSSEY_DEBUG__?: Record<string, unknown>;
  }
}
