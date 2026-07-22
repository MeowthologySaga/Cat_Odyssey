import { configureDebugBridge, type DebugBridgeTarget } from "../../src/core/debugBridge";
import { describe, expect, it, vi } from "vitest";

describe("production debug bridge", () => {
  it("exposes the bridge only when development mode is enabled", () => {
    const target: DebugBridgeTarget = {};
    configureDebugBridge(target, true, () => ({ version: "dev" }));
    expect(target.__CAT_ODYSSEY_DEBUG__).toEqual({ version: "dev" });
  });

  it("removes stale debug state and does not construct a release payload", () => {
    const target: DebugBridgeTarget = { __CAT_ODYSSEY_DEBUG__: { stale: true } };
    const createPayload = vi.fn(() => ({ internalMarker: "mutable internals" }));
    configureDebugBridge(target, false, createPayload);
    expect(target.__CAT_ODYSSEY_DEBUG__).toBeUndefined();
    expect(createPayload).not.toHaveBeenCalled();
  });
});
