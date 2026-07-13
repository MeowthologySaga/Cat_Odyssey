import type { GameSaveV1 } from "../../state/saveSchema";
import { assertNoWalletState, normalizeMetaSave } from "./compat";
import type { MetaFailure } from "./types";

export const RAID_KEY_CRAFT_COST = Object.freeze({
  gold: 1_000,
  materialId: "scylla-scale",
  materialAmount: 36,
});

export interface CraftRaidKeySuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly keysGranted: 1;
  readonly cost: typeof RAID_KEY_CRAFT_COST;
}

export type CraftRaidKeyResult = CraftRaidKeySuccess | MetaFailure;

/** Repeat clears of the campaign Scylla hunt provide a permanent non-wallet key path. */
export function craftRaidKey(input: GameSaveV1): CraftRaidKeyResult {
  const save = normalizeMetaSave(input);
  if (save.resources.gold < RAID_KEY_CRAFT_COST.gold) {
    return failure(save, "insufficient_gold", `Need ${RAID_KEY_CRAFT_COST.gold} gold.`);
  }
  const scales = save.resources.materials[RAID_KEY_CRAFT_COST.materialId] ?? 0;
  if (scales < RAID_KEY_CRAFT_COST.materialAmount) {
    return failure(
      save,
      "insufficient_materials",
      `Need ${RAID_KEY_CRAFT_COST.materialAmount} Scylla scales.`,
    );
  }
  save.resources.gold -= RAID_KEY_CRAFT_COST.gold;
  save.resources.materials[RAID_KEY_CRAFT_COST.materialId] =
    scales - RAID_KEY_CRAFT_COST.materialAmount;
  save.endgame.raidKeys += 1;
  assertNoWalletState(save);
  return { ok: true, save, keysGranted: 1, cost: RAID_KEY_CRAFT_COST };
}

function failure(save: GameSaveV1, code: MetaFailure["code"], message: string): MetaFailure {
  return { ok: false, code, message, save };
}
