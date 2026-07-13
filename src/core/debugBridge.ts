export interface DebugBridgeTarget {
  __CAT_ODYSSEY_DEBUG__?: Record<string, unknown>;
}

/**
 * Keeps the live Phaser/services bridge available to developers without exposing
 * mutable game internals in production builds. The payload is lazy so release
 * builds do not even construct it.
 */
export function configureDebugBridge(
  target: DebugBridgeTarget,
  enabled: boolean,
  createPayload: () => Record<string, unknown>,
): void {
  if (!enabled) {
    delete target.__CAT_ODYSSEY_DEBUG__;
    return;
  }
  target.__CAT_ODYSSEY_DEBUG__ = createPayload();
}
