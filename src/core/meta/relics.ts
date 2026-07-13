import { RELIC_BY_ID, type DataEffect, type HeroDefinition, type RelicDefinition } from "../../data";
import type { GameSaveV1 } from "../../state/saveSchema";
import { assertNoWalletState, normalizeMetaSave } from "./compat";
import { relicEffectValue, scaleRelicEffectValue } from "./relicEffectResolver";
import type { MetaFailure } from "./types";

export const RELIC_LOADOUT_LIMIT = 3 as const;
export const MAX_RELIC_LEVEL = 5 as const;
export const RELIC_MATERIAL_LOCK_PREFIX = "__meta:relic-material-lock:" as const;

export interface RelicProgressView {
  readonly relicId: string;
  readonly owned: boolean;
  readonly equipped: boolean;
  readonly level: number;
  readonly maxLevel: boolean;
}

export interface RelicUpgradeCost {
  readonly gold: number;
  readonly relicDust: number;
  readonly materialUnits: number;
}

export interface RelicUpgradeSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly relic: RelicProgressView;
  readonly cost: RelicUpgradeCost;
  readonly consumedMaterials: Readonly<Record<string, number>>;
}

export type RelicUpgradeResult = RelicUpgradeSuccess | MetaFailure;

export interface RelicMaterialConsumptionPlan {
  readonly requestedUnits: number;
  readonly availableUnits: number;
  readonly sufficient: boolean;
  readonly lockedMaterialIds: readonly string[];
  readonly consumedMaterials: Readonly<Record<string, number>>;
}

export interface RefineMaterialSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly materialId: string;
  readonly amount: number;
  readonly relicDustGranted: number;
}

export type RefineMaterialResult = RefineMaterialSuccess | MetaFailure;

export interface BattleRelicEffect extends DataEffect {
  readonly relicId: string;
  readonly relicLevel: number;
  readonly authoredValue: number;
}

export interface BattleRelicModifiers {
  readonly equippedRelicIds: readonly string[];
  readonly effects: readonly BattleRelicEffect[];
  readonly stats: {
    readonly hp: number;
    readonly attack: number;
    readonly speed: number;
  };
}

export interface RelicRewardModifiers {
  readonly goldMultiplier: number;
  readonly firstClearMaterialMultiplier: number;
}

export type RelicVaultGrantReason = "granted" | "duplicate" | "vault_full";

export interface RelicVaultGrantReceipt {
  readonly relicId: string;
  readonly granted: boolean;
  readonly reason: RelicVaultGrantReason;
  readonly relicDustGranted: number;
  readonly occupied: number;
  readonly capacity: number;
}

export interface RelicVaultGrantSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly receipt: RelicVaultGrantReceipt;
}

export type RelicVaultGrantResult = RelicVaultGrantSuccess | MetaFailure;

/** Authoritative capacity-aware path for every newly awarded relic. */
export function grantRelicToVault(
  input: GameSaveV1,
  relicId: string,
): RelicVaultGrantResult {
  const save = normalizeMetaSave(input);
  const relic = RELIC_BY_ID[relicId];
  if (!relic) return failure(save, "unknown_relic", `Unknown relic: ${relicId}`);
  const capacity = Math.max(0, Math.floor(save.resources.vaultSlots));
  const occupied = save.inventory.relicIds.length;
  const duplicate = save.inventory.relicIds.includes(relicId);
  if (!duplicate && occupied < capacity) {
    save.inventory.relicIds.push(relicId);
    save.inventory.relicLevels[relicId] = 1;
    assertNoWalletState(save);
    return {
      ok: true,
      save,
      receipt: {
        relicId,
        granted: true,
        reason: "granted",
        relicDustGranted: 0,
        occupied: occupied + 1,
        capacity,
      },
    };
  }
  const relicDustGranted = Math.max(25, relic.tier * 25);
  save.resources.relicDust += relicDustGranted;
  assertNoWalletState(save);
  return {
    ok: true,
    save,
    receipt: {
      relicId,
      granted: false,
      reason: duplicate ? "duplicate" : "vault_full",
      relicDustGranted,
      occupied,
      capacity,
    },
  };
}

export function getRelicProgress(input: GameSaveV1, relicId: string): RelicProgressView | undefined {
  if (!RELIC_BY_ID[relicId]) return undefined;
  const save = normalizeMetaSave(input);
  const owned = save.inventory.relicIds.includes(relicId);
  const level = owned ? clampLevel(save.inventory.relicLevels[relicId] ?? 1) : 0;
  return {
    relicId,
    owned,
    equipped: owned && save.inventory.equippedRelicIds.includes(relicId),
    level,
    maxLevel: level >= MAX_RELIC_LEVEL,
  };
}

export function equipRelic(input: GameSaveV1, relicId: string): GameSaveV1 | MetaFailure {
  const save = normalizeMetaSave(input);
  if (!RELIC_BY_ID[relicId]) return failure(save, "unknown_relic", `Unknown relic: ${relicId}`);
  if (!save.inventory.relicIds.includes(relicId)) {
    return failure(save, "relic_not_owned", `Relic is not owned: ${relicId}`);
  }
  if (save.inventory.equippedRelicIds.includes(relicId)) {
    return failure(save, "relic_already_equipped", `Relic is already equipped: ${relicId}`);
  }
  if (save.inventory.equippedRelicIds.length >= RELIC_LOADOUT_LIMIT) {
    return failure(save, "relic_loadout_full", `Relic loadout is full (${RELIC_LOADOUT_LIMIT}).`);
  }
  save.inventory.equippedRelicIds.push(relicId);
  save.inventory.relicLevels[relicId] = clampLevel(save.inventory.relicLevels[relicId] ?? 1);
  assertNoWalletState(save);
  return save;
}

export function unequipRelic(input: GameSaveV1, relicId: string): GameSaveV1 | MetaFailure {
  const save = normalizeMetaSave(input);
  if (!RELIC_BY_ID[relicId]) return failure(save, "unknown_relic", `Unknown relic: ${relicId}`);
  if (!save.inventory.equippedRelicIds.includes(relicId)) {
    return failure(save, "relic_not_equipped", `Relic is not equipped: ${relicId}`);
  }
  save.inventory.equippedRelicIds = save.inventory.equippedRelicIds.filter((id) => id !== relicId);
  assertNoWalletState(save);
  return save;
}

export function quoteRelicUpgrade(
  input: GameSaveV1,
  relicId: string,
): RelicUpgradeCost | MetaFailure {
  const save = normalizeMetaSave(input);
  const relic = RELIC_BY_ID[relicId];
  if (!relic) return failure(save, "unknown_relic", `Unknown relic: ${relicId}`);
  if (!save.inventory.relicIds.includes(relicId)) {
    return failure(save, "relic_not_owned", `Relic is not owned: ${relicId}`);
  }
  const currentLevel = clampLevel(save.inventory.relicLevels[relicId] ?? 1);
  if (currentLevel >= MAX_RELIC_LEVEL) {
    return failure(save, "max_relic_level", `${relic.name} is fully refined.`);
  }
  return {
    gold: 180 * relic.tier * currentLevel,
    relicDust: 20 * relic.tier * currentLevel,
    materialUnits: relic.tier + currentLevel,
  };
}

export function upgradeRelic(input: GameSaveV1, relicId: string): RelicUpgradeResult {
  const save = normalizeMetaSave(input);
  const quote = quoteRelicUpgrade(save, relicId);
  if (isFailure(quote)) return quote;
  if (save.resources.gold < quote.gold) {
    return failure(save, "insufficient_gold", `Need ${quote.gold} gold.`);
  }
  if (save.resources.relicDust < quote.relicDust) {
    return failure(save, "insufficient_relic_dust", `Need ${quote.relicDust} relic dust.`);
  }
  const materialPlan = planRelicMaterialConsumption(save, quote.materialUnits);
  if (!materialPlan.sufficient) {
    return failure(save, "insufficient_materials", `Need ${quote.materialUnits} voyage materials.`);
  }
  consumeMaterialPlan(save, materialPlan.consumedMaterials);
  save.resources.gold -= quote.gold;
  save.resources.relicDust -= quote.relicDust;
  save.inventory.relicLevels[relicId] = clampLevel((save.inventory.relicLevels[relicId] ?? 1) + 1);
  const relic = getRelicProgress(save, relicId)!;
  assertNoWalletState(save);
  return { ok: true, save, relic, cost: quote, consumedMaterials: materialPlan.consumedMaterials };
}

/** Converts any authored voyage material into the universal relic-refining currency. */
export function refineMaterial(
  input: GameSaveV1,
  materialId: string,
  amount = 5,
): RefineMaterialResult {
  const save = normalizeMetaSave(input);
  const normalizedId = materialId.trim();
  if (!normalizedId || !Number.isInteger(amount) || amount <= 0) {
    return failure(save, "invalid_amount", "Material amount must be a positive integer.");
  }
  if ((save.resources.materials[normalizedId] ?? 0) < amount) {
    return failure(save, "insufficient_materials", `Need ${amount} ${normalizedId}.`);
  }
  const remainder = (save.resources.materials[normalizedId] ?? 0) - amount;
  if (remainder > 0) save.resources.materials[normalizedId] = remainder;
  else delete save.resources.materials[normalizedId];
  const relicDustGranted = amount * 5;
  save.resources.relicDust += relicDustGranted;
  assertNoWalletState(save);
  return { ok: true, save, materialId: normalizedId, amount, relicDustGranted };
}

/**
 * Authoritative integration contract for battle code. All authored effects from the
 * equipped three-relic loadout are returned with level scaling already applied.
 * A small tag-based stat bonus is also applied by createBattleHeroDefinition today,
 * so every equipped relic has an immediate, testable effect even before a specialist
 * runtime handler consumes effects such as weakpoint-damage or countdown delay.
 */
export function getBattleRelicModifiers(input: GameSaveV1): BattleRelicModifiers {
  const save = normalizeMetaSave(input);
  const relics = save.inventory.equippedRelicIds
    .map((id) => RELIC_BY_ID[id])
    .filter((relic): relic is RelicDefinition => Boolean(relic && save.inventory.relicIds.includes(relic.id)))
    .slice(0, RELIC_LOADOUT_LIMIT);
  const stats = { hp: 1, attack: 1, speed: 1 };
  const effects: BattleRelicEffect[] = [];
  for (const relic of relics) {
    const level = clampLevel(save.inventory.relicLevels[relic.id] ?? 1);
    const passive = relic.tier * level * 0.006;
    const tags = new Set(relic.tags);
    if (["guard", "heal", "survival", "regeneration", "revive"].some((tag) => tags.has(tag))) {
      stats.hp += passive;
    } else if (["speed", "wind", "aim", "preview", "pierce"].some((tag) => tags.has(tag))) {
      stats.speed += passive;
    } else {
      stats.attack += passive;
    }
    for (const effect of relic.effects) {
      effects.push({
        ...effect,
        relicId: relic.id,
        relicLevel: level,
        authoredValue: effect.value,
        value: scaleRelicEffectValue(effect.value, level),
      });
    }
  }
  return {
    equippedRelicIds: relics.map((relic) => relic.id),
    effects,
    stats,
  };
}

export function applyRelicStatsToHero(
  input: GameSaveV1,
  hero: HeroDefinition,
): HeroDefinition {
  const modifiers = getBattleRelicModifiers(input);
  return {
    ...hero,
    stats: {
      hp: Math.round(hero.stats.hp * modifiers.stats.hp),
      attack: Math.round(hero.stats.attack * modifiers.stats.attack),
      speed: Math.round(hero.stats.speed * modifiers.stats.speed),
    },
  };
}

/** Authoritative reward-side resolver for equipped relic passives. */
export function getRelicRewardModifiers(input: GameSaveV1): RelicRewardModifiers {
  const effects = getBattleRelicModifiers(input).effects;
  return {
    goldMultiplier: 1 + Math.max(0, relicEffectValue(effects, "route-gold")) / 100,
    firstClearMaterialMultiplier:
      1 + Math.max(0, relicEffectValue(effects, "first-clear-material")) / 100,
  };
}

export function totalMaterials(input: GameSaveV1): number {
  return Object.values(input.resources.materials).reduce(
    (sum, amount) => sum + Math.max(0, Math.floor(amount)),
    0,
  );
}

export function getLockedRelicMaterialIds(input: GameSaveV1): readonly string[] {
  return [...new Set(input.inventory.skinIds
    .filter((id) => id.startsWith(RELIC_MATERIAL_LOCK_PREFIX))
    .map((id) => id.slice(RELIC_MATERIAL_LOCK_PREFIX.length))
    .filter(Boolean))].sort();
}

export function setRelicMaterialLocked(
  input: GameSaveV1,
  materialId: string,
  locked: boolean,
): GameSaveV1 {
  const save = normalizeMetaSave(input);
  const normalizedId = materialId.trim();
  if (!normalizedId) return save;
  const marker = `${RELIC_MATERIAL_LOCK_PREFIX}${normalizedId}`;
  save.inventory.skinIds = save.inventory.skinIds.filter((id) => id !== marker);
  if (locked) save.inventory.skinIds.push(marker);
  assertNoWalletState(save);
  return save;
}

/** Exact, deterministic preview used by both the refinement UI and commit path. */
export function planRelicMaterialConsumption(
  input: GameSaveV1,
  units: number,
): RelicMaterialConsumptionPlan {
  const requestedUnits = Math.max(0, Math.floor(Number.isFinite(units) ? units : 0));
  const lockedMaterialIds = getLockedRelicMaterialIds(input);
  const locked = new Set(lockedMaterialIds);
  let remaining = requestedUnits;
  const consumed: Record<string, number> = {};
  const entries = Object.entries(input.resources.materials)
    .filter(([id, amount]) => amount > 0 && !locked.has(id))
    .sort(([idA, amountA], [idB, amountB]) => amountB - amountA || idA.localeCompare(idB));
  const availableUnits = entries.reduce((sum, [, amount]) => sum + Math.max(0, Math.floor(amount)), 0);
  for (const [materialId, amount] of entries) {
    if (remaining <= 0) break;
    const take = Math.min(Math.floor(amount), remaining);
    if (take <= 0) continue;
    consumed[materialId] = take;
    remaining -= take;
  }
  return {
    requestedUnits,
    availableUnits,
    sufficient: remaining <= 0,
    lockedMaterialIds,
    consumedMaterials: consumed,
  };
}

function consumeMaterialPlan(save: GameSaveV1, consumed: Readonly<Record<string, number>>): void {
  for (const [materialId, amount] of Object.entries(consumed)) {
    const remainder = Math.max(0, Math.floor(save.resources.materials[materialId] ?? 0) - Math.max(0, Math.floor(amount)));
    if (remainder > 0) save.resources.materials[materialId] = remainder;
    else delete save.resources.materials[materialId];
  }
}

function clampLevel(level: number): number {
  return Math.min(MAX_RELIC_LEVEL, Math.max(1, Math.floor(level)));
}

function isFailure(value: RelicUpgradeCost | MetaFailure): value is MetaFailure {
  return "ok" in value && value.ok === false;
}

function failure(save: GameSaveV1, code: MetaFailure["code"], message: string): MetaFailure {
  return { ok: false, code, message, save };
}
