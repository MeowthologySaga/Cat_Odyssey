import type { GameSaveV1 } from "./saveSchema";

export const VAULT_EXPANSION_MIN_SLOTS = 40 as const;

export function hasVaultExpansionReceipt(input: GameSaveV1): boolean {
  return input.purchaseReceipts.some((receipt) => receipt.actionId === "vault-expansion");
}

/** Receipt and capacity are both durable evidence that the one-time upgrade is owned. */
export function hasVaultExpansionEntitlement(input: GameSaveV1): boolean {
  return input.resources.vaultSlots >= VAULT_EXPANSION_MIN_SLOTS
    || hasVaultExpansionReceipt(input);
}

/** A retained one-time receipt is authoritative and repairs damaged legacy capacity. */
export function repairVaultExpansionEntitlement(input: GameSaveV1): boolean {
  if (!hasVaultExpansionReceipt(input) || input.resources.vaultSlots >= VAULT_EXPANSION_MIN_SLOTS) {
    return false;
  }
  input.resources.vaultSlots = VAULT_EXPANSION_MIN_SLOTS;
  return true;
}
