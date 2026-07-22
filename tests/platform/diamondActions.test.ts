import manifest from "../../cartridge/manifest.json";
import { describe, expect, it } from "vitest";
import {
  DIAMOND_ACTIONS,
  createSpendInput,
  resolveGameHost
} from "../../src/platform";

describe("PlayZone manifest contract", () => {
  it("keeps all eight runtime protocol actions aligned with the manifest", () => {
    const manifestProtocol = manifest.economy.diamondActions.map((action) => ({
      id: action.id,
      amount: action.amount,
      reason: action.reason,
      requiresConfirm: action.requiresConfirm,
      repeatable: action.repeatable,
    }));
    expect(manifestProtocol).toEqual(DIAMOND_ACTIONS);
    expect(DIAMOND_ACTIONS).toHaveLength(8);
    for (const action of manifest.economy.diamondActions) {
      expect(action.localizedReason).toMatchObject({ ko: action.reason });
      expect(action.localizedReason.en).not.toMatch(/[\u3131-\u318e\uac00-\ud7a3]/u);
    }
  });

  it("uses the current iframe schema and minimum permissions", () => {
    expect(manifest.contentType).toBe("game_pack");
    expect(manifest.lineageId).toBe("adb6ec88-2557-4fb2-857a-76e5c057f998");
    expect(manifest.entry).toEqual({ type: "iframe", path: "game/index.html" });
    expect(manifest.permissions).toMatchObject({
      network: false,
      cardsRead: false,
      cardsCreate: false,
      walletSpend: true
    });
  });

  it("prefers an injected PlayZone Host and otherwise returns a mock", () => {
    const injected = {
      packId: "injected",
      appVersion: "test",
      wallet: {
        async getBalance() {
          return { balance: 1 };
        },
        async spend() {
          return { ok: false as const, code: "test", message: "test" };
        }
      },
      save: {
        async load<T>(fallback: T) {
          return fallback;
        },
        async write() {},
        async clear() {}
      },
      ui: {
        toast() {},
        async confirm() {
          return true;
        }
      }
    } satisfies LemGameHostApi;

    expect(resolveGameHost({ injectedHost: injected })).toEqual({
      host: injected,
      mode: "playzone"
    });
    const fallback = resolveGameHost({ mock: { initialBalance: 77 } });
    expect(fallback.mode).toBe("mock");
    expect(createSpendInput("battle-rescue", "run-1")).toMatchObject({
      id: "battle-rescue",
      amount: 60,
      requiresConfirm: true,
      idempotencyKey: "run-1"
    });
  });
});
