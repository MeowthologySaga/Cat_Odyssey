import { BLESSINGS, BLESSING_BY_ID, ENDGAME, HERO_BY_ID, STAGE_BY_ID } from "../../data";
import type { GameSaveV1, JsonObject } from "../../state";
import { assertNoWalletState, normalizeMetaSave } from "./compat";
import {
  grantRepeatableStageRewards,
  type EndgameBonusRewardReceipt,
  type GrantRepeatableStageRewardsResult,
  type StageRewardReceipt,
} from "./rewards";
import { grantHero } from "./roster";
import { grantRelicToVault } from "./relics";
import { validateScyllaRaidSquads } from "./endgame";

export type PlayableEndgameMode = "oracleTower" | "stormRoute" | "scyllaRaid";

export const STORM_WEEKLY_BATTLE_LIMIT = 6 as const;
export const STORM_EXTRA_ENTRY_MATERIAL_ID = "storm-extra-entry" as const;
export const STORM_WEEK_MARKER_KEY = "__meta:storm-week-id" as const;
export const STORM_WEEKLY_SCORE_KEY = "__meta:storm-weekly-score" as const;
export const SCYLLA_AFFINITY_MAX = 99 as const;
export const SCYLLA_RAID_CLEAR_COUNT_KEY = "__meta:scylla-raid-clear-count" as const;
export const STORM_HARBOR_SUPPLY_OPTION_ID = "harbor-supplies" as const;
export const STORM_HARBOR_SUPPLY_MATERIAL_ID = "storm-glass" as const;
export const STORM_HARBOR_SUPPLY_AMOUNT = 3 as const;
const STORM_SCORE_CLAIM_PREFIX = "__meta:storm-score-tier:" as const;

export type StormScoreRewardKind = "gold" | "awakeningMaterials" | "relicDust" | "stormExtraEntry";
export interface StormScoreTier {
  readonly score: number;
  readonly rewardKind: StormScoreRewardKind;
  readonly amount: number;
  readonly label: string;
}

export const STORM_SCORE_TIERS: readonly StormScoreTier[] = Object.freeze([
  { score: 2_500, rewardKind: "gold", amount: 500, label: "골드 500" },
  { score: 7_500, rewardKind: "awakeningMaterials", amount: 1, label: "각성석 1" },
  { score: 15_000, rewardKind: "stormExtraEntry", amount: 1, label: "폭풍 추가 출항권 1" },
  { score: 30_000, rewardKind: "relicDust", amount: 100, label: "유물 가루 100" },
]);

export interface ScyllaAffinityMilestone {
  readonly level: number;
  readonly kind: "material" | "skin" | "title";
  readonly id: string;
  readonly amount: number;
  readonly label: string;
}

export const SCYLLA_AFFINITY_MILESTONES: readonly ScyllaAffinityMilestone[] = Object.freeze([
  { level: 1, kind: "material", id: "scylla-scale", amount: 3, label: "스킬라 비늘 3" },
  { level: 5, kind: "skin", id: "skin:scylla-wake", amount: 1, label: "선체 문양 · 스킬라의 물결" },
  { level: 10, kind: "material", id: "scylla-scale", amount: 10, label: "스킬라 비늘 10" },
  { level: 20, kind: "title", id: "title:strait-bond", amount: 1, label: "칭호 · 해협의 인연" },
  { level: 35, kind: "skin", id: "skin:scylla-figurehead", amount: 1, label: "선수상 · 여섯 머리" },
  { level: 50, kind: "material", id: "scylla-scale", amount: 30, label: "스킬라 비늘 30" },
  { level: 75, kind: "title", id: "title:scylla-confidant", amount: 1, label: "칭호 · 스킬라의 벗" },
  { level: 99, kind: "skin", id: "skin:scylla-mythic-voyage", amount: 1, label: "신화 선체 · 스킬라 항해" },
]);

/** Blessings whose runtime combat modifiers are currently authoritative. */
export const STORM_REROLL_BLESSING_IDS = Object.freeze([
  ...new Set(BLESSINGS.map((blessing) => blessing.id)),
]) as readonly string[];

export interface StormBlessingRerollPlan {
  readonly ok: true;
  readonly purchaseId: string;
  readonly weekId: number;
  readonly runNumber: number;
  readonly nodeIndex: number;
  readonly rerollNumber: number;
  readonly candidateIds: readonly string[];
  readonly reward: JsonObject;
}

export interface StormBlessingRerollFailure {
  readonly ok: false;
  readonly message: string;
}

export type StormBlessingRerollPlanResult =
  | StormBlessingRerollPlan
  | StormBlessingRerollFailure;

export interface EndgameBonusDefinition {
  readonly kind: "material" | "fragment" | "hero" | "relic" | "title";
  readonly id: string;
  readonly amount: number;
}

export interface EndgameRewardPlan {
  readonly mode: PlayableEndgameMode;
  readonly label: string;
  readonly goldMultiplier: number;
  readonly heroXpMultiplier: number;
  readonly materialMultiplier: number;
  readonly bonuses: readonly EndgameBonusDefinition[];
}

export interface EndgameRewardSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly stageId: string;
  readonly rewards: StageRewardReceipt;
  readonly plan: EndgameRewardPlan;
}

export type EndgameRewardResult = EndgameRewardSuccess | Exclude<GrantRepeatableStageRewardsResult, { ok: true }>;

export interface EndgameEntryCostSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly consumed: "none" | "raidKey" | "stormExtraEntry";
}

export interface EndgameEntryCostFailure {
  readonly ok: false;
  readonly code: "raid_key_required" | "storm_entry_required";
  readonly message: string;
  readonly save: GameSaveV1;
}

export type EndgameEntryCostResult = EndgameEntryCostSuccess | EndgameEntryCostFailure;

export function currentIsoWeekId(now = new Date()): number {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return date.getUTCFullYear() * 100 + week;
}

export function prepareWeeklyStormState(
  input: GameSaveV1,
  now = new Date(),
): { readonly save: GameSaveV1; readonly reset: boolean; readonly weekId: number } {
  const save = normalizeMetaSave(input);
  const weekId = currentIsoWeekId(now);
  const previous = save.endgame.bossAffinity[STORM_WEEK_MARKER_KEY] ?? 0;
  const reset = previous !== weekId;
  if (reset) {
    save.endgame.weeklyStormRuns = 0;
    save.endgame.bossAffinity[STORM_WEEKLY_SCORE_KEY] = 0;
    save.endgame.stormRoute = {
      weekId,
      nodeIndex: 0,
      active: false,
      entryPaid: false,
      blessingIds: [],
      blessingOfferIds: [],
      blessingRerollCount: 0,
      curseIds: [],
      fallenHeroIds: [],
      partyHeroIds: [],
      swapCharges: 0,
      selectedStageId: null,
    };
  } else {
    save.endgame.stormRoute.weekId = weekId;
  }
  save.endgame.bossAffinity[STORM_WEEK_MARKER_KEY] = weekId;
  return { save, reset, weekId };
}

export function getStormCombatNodes(): readonly (typeof ENDGAME.stormRoute.nodes)[number][] {
  return ENDGAME.stormRoute.nodes.filter(
    (node) => node.rewardScale > 0 && node.pool.some((id) => Boolean(STAGE_BY_ID[id])),
  );
}

export function getCurrentStormCombatNode(input: GameSaveV1): (typeof ENDGAME.stormRoute.nodes)[number] {
  const current = getCurrentStormNode(input);
  if (current.rewardScale > 0) return current;
  return ENDGAME.stormRoute.nodes.slice(current.index).find((node) => node.rewardScale > 0)
    ?? getStormCombatNodes()[0]!;
}

export function getCurrentStormNode(input: GameSaveV1): (typeof ENDGAME.stormRoute.nodes)[number] {
  return ENDGAME.stormRoute.nodes[Math.min(11, Math.max(0, input.endgame.stormRoute.nodeIndex))]!;
}

export function getStormNodeOptions(input: GameSaveV1): readonly string[] {
  const node = getCurrentStormNode(input);
  const rerolledBlessings = input.endgame.stormRoute.blessingOfferIds;
  if (
    node.type === "blessing"
    && rerolledBlessings.length === 3
    && rerolledBlessings.every((id) => STORM_REROLL_BLESSING_IDS.includes(id))
  ) {
    return rerolledBlessings;
  }
  if (node.type === "harbor") {
    const effective = node.pool.filter((optionId) => isStormHarborOptionEffective(input, optionId));
    return effective.length > 0 ? effective : [STORM_HARBOR_SUPPLY_OPTION_ID];
  }
  if (node.type !== "curse" || !node.rules.includes("choose-one-of-two-curses") || node.pool.length <= 2) {
    return node.pool;
  }
  const weekId = input.endgame.stormRoute.weekId || currentIsoWeekId();
  const start = (weekId + node.index * 31) % node.pool.length;
  return [node.pool[start]!, node.pool[(start + 1) % node.pool.length]!];
}

/** Harbor options are exposed only when choosing them changes persistent run state. */
export function isStormHarborOptionEffective(input: GameSaveV1, optionId: string): boolean {
  if (optionId === "repair" || optionId === "revive-one-hero") {
    return input.endgame.stormRoute.fallenHeroIds.length > 0;
  }
  if (optionId === "remove-one-curse") {
    return input.endgame.stormRoute.curseIds.length > 0;
  }
  if (optionId === "swap-one-hero") return true;
  return optionId === STORM_HARBOR_SUPPLY_OPTION_ID;
}

/**
 * Plans a paid reroll without mutating the save. The stable purchase id and reward
 * payload let PurchaseService replay the exact same intent after an interrupted save.
 */
export function planStormBlessingReroll(input: GameSaveV1): StormBlessingRerollPlanResult {
  const node = getCurrentStormNode(input);
  if (node.type !== "blessing" || node.rewardScale > 0) {
    return { ok: false, message: "가호 선택 노드에서만 후보를 다시 고를 수 있습니다." };
  }
  const current = new Set(getStormNodeOptions(input));
  const alternatives = STORM_REROLL_BLESSING_IDS.filter((id) => !current.has(id));
  if (alternatives.length < 3) {
    return { ok: false, message: "새로 제시할 가호 후보가 부족합니다." };
  }
  const weekId = input.endgame.stormRoute.weekId || currentIsoWeekId();
  const runNumber = Math.max(0, Math.floor(input.endgame.weeklyStormRuns));
  const nodeIndex = input.endgame.stormRoute.nodeIndex;
  const rerollNumber = Math.max(0, Math.floor(input.endgame.stormRoute.blessingRerollCount)) + 1;
  const start = stableHash(`${weekId}:${runNumber}:${nodeIndex}:${rerollNumber}`) % alternatives.length;
  const candidateIds = Array.from(
    { length: 3 },
    (_, index) => alternatives[(start + index) % alternatives.length]!,
  );
  const purchaseId = `storm-blessing:${weekId}:${runNumber}:${nodeIndex}:${rerollNumber}`;
  return {
    ok: true,
    purchaseId,
    weekId,
    runNumber,
    nodeIndex,
    rerollNumber,
    candidateIds,
    reward: {
      weekId,
      runNumber,
      nodeIndex,
      rerollNumber,
      candidateIds,
    },
  };
}

/** Applies a previously planned reroll only after PurchaseService confirms spend. */
export function commitStormBlessingReroll(
  input: GameSaveV1,
  reward: {
    readonly weekId: number;
    readonly runNumber: number;
    readonly nodeIndex: number;
    readonly rerollNumber: number;
    readonly candidateIds: readonly string[];
  },
): StormChoiceResult {
  const save = normalizeMetaSave(input);
  const plan = planStormBlessingReroll(save);
  const sameCandidates = plan.ok
    && plan.candidateIds.length === reward.candidateIds.length
    && plan.candidateIds.every((id, index) => id === reward.candidateIds[index]);
  if (
    !plan.ok
    || plan.weekId !== reward.weekId
    || plan.runNumber !== reward.runNumber
    || plan.nodeIndex !== reward.nodeIndex
    || plan.rerollNumber !== reward.rerollNumber
    || !sameCandidates
  ) {
    return { ok: false, save, message: "가호 재선택 구매 정보가 현재 항로와 일치하지 않습니다." };
  }
  save.endgame.stormRoute.blessingOfferIds = [...plan.candidateIds];
  save.endgame.stormRoute.blessingRerollCount = plan.rerollNumber;
  return { ok: true, save, message: "새로운 가호 후보 세 개가 나타났습니다." };
}

export function setStormRouteParty(
  input: GameSaveV1,
  heroIds: readonly string[],
): { readonly ok: boolean; readonly save: GameSaveV1; readonly message: string } {
  const save = normalizeMetaSave(input);
  const selected = [...new Set(heroIds)].filter((heroId) => HERO_BY_ID[heroId] && save.roster.ownedHeroIds.includes(heroId));
  if (selected.length !== 3 || selected.some((heroId) => save.endgame.stormRoute.fallenHeroIds.includes(heroId))) {
    return { ok: false, save, message: "쓰러지지 않은 영웅 세 명을 편성하세요." };
  }
  const current = save.endgame.stormRoute.partyHeroIds;
  if (!save.endgame.stormRoute.active || current.length !== 3) {
    save.endgame.stormRoute.partyHeroIds = selected;
    save.roster.partyHeroIds = selected;
    return { ok: true, save, message: "폭풍 항로 선단을 편성했습니다." };
  }
  const fallenCurrent = current.filter((heroId) => save.endgame.stormRoute.fallenHeroIds.includes(heroId));
  const newcomers = selected.filter((heroId) => !current.includes(heroId));
  const voluntaryChanges = Math.max(0, newcomers.length - fallenCurrent.length);
  if (voluntaryChanges > save.endgame.stormRoute.swapCharges) {
    return { ok: false, save, message: "자유 교대는 표류 항구의 선원 교대 서비스가 필요합니다." };
  }
  save.endgame.stormRoute.swapCharges -= voluntaryChanges;
  save.endgame.stormRoute.partyHeroIds = selected;
  save.roster.partyHeroIds = selected;
  return { ok: true, save, message: voluntaryChanges > 0 ? "교대권을 사용했습니다." : "항로 편성을 유지합니다." };
}

export function getStormNodeStageId(input: GameSaveV1): string | undefined {
  const node = getCurrentStormNode(input);
  if (node.rewardScale <= 0) return undefined;
  const existing = input.endgame.stormRoute.selectedStageId;
  if (existing && node.pool.includes(existing) && STAGE_BY_ID[existing]) return existing;
  const weekId = input.endgame.stormRoute.weekId || currentIsoWeekId();
  const pool = node.pool.filter((id) => Boolean(STAGE_BY_ID[id]));
  return pool.length ? pool[(weekId + node.index * 17) % pool.length] : undefined;
}

export function activateStormRoute(input: GameSaveV1): GameSaveV1 {
  const save = normalizeMetaSave(input);
  save.endgame.stormRoute.active = true;
  save.endgame.stormRoute.entryPaid = true;
  save.endgame.stormRoute.partyHeroIds = [...save.roster.partyHeroIds.slice(0, 3)];
  const stageId = getStormNodeStageId(save);
  save.endgame.stormRoute.selectedStageId = stageId ?? null;
  return save;
}

export interface StormChoiceResult {
  readonly ok: boolean;
  readonly save: GameSaveV1;
  readonly message: string;
}

export function chooseStormNodeOption(input: GameSaveV1, optionId: string): StormChoiceResult {
  const save = normalizeMetaSave(input);
  const node = getCurrentStormNode(save);
  if (node.rewardScale > 0 || !getStormNodeOptions(save).includes(optionId)) {
    return { ok: false, save, message: "현재 폭풍 노드에서 선택할 수 없는 항목입니다." };
  }
  if (node.type === "blessing" && !save.endgame.stormRoute.blessingIds.includes(optionId)) {
    save.endgame.stormRoute.blessingIds.push(optionId);
  } else if (node.type === "curse" && !save.endgame.stormRoute.curseIds.includes(optionId)) {
    save.endgame.stormRoute.curseIds.push(optionId);
  } else if (node.type === "harbor") {
    if (optionId === "repair" || optionId === "revive-one-hero") {
      save.endgame.stormRoute.fallenHeroIds.shift();
    } else if (optionId === "remove-one-curse") {
      save.endgame.stormRoute.curseIds.shift();
    } else if (optionId === "swap-one-hero") {
      save.endgame.stormRoute.swapCharges += 1;
    } else if (optionId === STORM_HARBOR_SUPPLY_OPTION_ID) {
      save.resources.materials[STORM_HARBOR_SUPPLY_MATERIAL_ID] =
        (save.resources.materials[STORM_HARBOR_SUPPLY_MATERIAL_ID] ?? 0)
        + STORM_HARBOR_SUPPLY_AMOUNT;
    }
  }
  advanceStormNode(save);
  return { ok: true, save, message: stormChoiceLabel(optionId) };
}

export function settleStormBattleVictory(
  input: GameSaveV1,
  fallenHeroIds: readonly string[] = [],
  battleScore = 0,
): {
  readonly save: GameSaveV1;
  readonly routeCompleted: boolean;
  readonly weeklyScore: number;
  readonly scoreRewards: readonly StormScoreTier[];
} {
  const save = normalizeMetaSave(input);
  const node = getCurrentStormNode(save);
  if (node.rewardScale <= 0) return {
    save,
    routeCompleted: false,
    weeklyScore: save.endgame.bossAffinity[STORM_WEEKLY_SCORE_KEY] ?? 0,
    scoreRewards: [],
  };
  if (ENDGAME.stormRoute.fallenHeroLock) {
    save.endgame.stormRoute.fallenHeroIds = [...new Set([
      ...save.endgame.stormRoute.fallenHeroIds,
      ...fallenHeroIds.filter((heroId) => HERO_BY_ID[heroId]),
    ])];
  }
  if (node.rules.includes("weekly-score-enabled")) {
    save.endgame.bossAffinity[STORM_WEEKLY_SCORE_KEY] = Math.max(
      save.endgame.bossAffinity[STORM_WEEKLY_SCORE_KEY] ?? 0,
      Math.max(0, Math.floor(battleScore)),
    );
  }
  const weeklyScore = save.endgame.bossAffinity[STORM_WEEKLY_SCORE_KEY] ?? 0;
  const scoreRewards = grantStormScoreTierRewards(save, weeklyScore);
  const routeCompleted = node.index === ENDGAME.stormRoute.nodeCount;
  advanceStormNode(save);
  return { save, routeCompleted, weeklyScore, scoreRewards };
}

export function getStormScoreTierProgress(input: GameSaveV1): {
  readonly score: number;
  readonly claimed: readonly StormScoreTier[];
  readonly next?: StormScoreTier;
} {
  const weekId = input.endgame.stormRoute.weekId || currentIsoWeekId();
  const score = Math.max(0, Math.floor(input.endgame.bossAffinity[STORM_WEEKLY_SCORE_KEY] ?? 0));
  const claimed = STORM_SCORE_TIERS.filter(
    (tier) => input.endgame.bossAffinity[`${STORM_SCORE_CLAIM_PREFIX}${tier.score}`] === weekId,
  );
  return { score, claimed, next: STORM_SCORE_TIERS.find((tier) => !claimed.includes(tier)) };
}

function grantStormScoreTierRewards(save: GameSaveV1, score: number): readonly StormScoreTier[] {
  const weekId = save.endgame.stormRoute.weekId || currentIsoWeekId();
  const granted: StormScoreTier[] = [];
  for (const tier of STORM_SCORE_TIERS) {
    const marker = `${STORM_SCORE_CLAIM_PREFIX}${tier.score}`;
    if (score < tier.score || save.endgame.bossAffinity[marker] === weekId) continue;
    save.endgame.bossAffinity[marker] = weekId;
    if (tier.rewardKind === "gold") save.resources.gold += tier.amount;
    else if (tier.rewardKind === "awakeningMaterials") save.resources.awakeningMaterials += tier.amount;
    else if (tier.rewardKind === "relicDust") save.resources.relicDust += tier.amount;
    else save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] = (save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] ?? 0) + tier.amount;
    granted.push(tier);
  }
  return granted;
}

export function lockOraclePartyAfterVictory(input: GameSaveV1, heroIds: readonly string[]): GameSaveV1 {
  const save = normalizeMetaSave(input);
  const floorIndex = Math.min(29, save.endgame.oracleTowerFloor);
  if (save.endgame.oracleTowerFloor >= 29) {
    save.endgame.oracleHeroLockUntilFloor = {};
    return save;
  }
  const floor = ENDGAME.oracleTower.floors[floorIndex]!;
  const currentFloor = floorIndex + 1;
  for (const heroId of heroIds) {
    if (HERO_BY_ID[heroId]) {
      save.endgame.oracleHeroLockUntilFloor[heroId] = currentFloor + floor.lockoutFloors;
    }
  }
  return save;
}

export function getScyllaRaidRewardHeroIds(input: GameSaveV1): readonly string[] {
  const save = normalizeMetaSave(input);
  return [...new Set(save.endgame.scyllaRaid.squads.flat())].filter(
    (heroId) => Boolean(HERO_BY_ID[heroId]) && save.roster.ownedHeroIds.includes(heroId),
  );
}

export function saveScyllaRaidSquads(
  input: GameSaveV1,
  parties: readonly (readonly string[])[],
): { readonly ok: boolean; readonly save: GameSaveV1; readonly message: string } {
  const validation = validateRaidSquads(input, parties);
  if (!validation.valid) return { ok: false, save: normalizeMetaSave(input), message: validation.message };
  const save = normalizeMetaSave(input);
  save.endgame.scyllaRaid.squads = parties.map((party) => [...party]);
  return { ok: true, save, message: "토벌 분대 편성이 저장되었습니다." };
}

export function getCurrentScyllaSquad(input: GameSaveV1): readonly string[] {
  return input.endgame.scyllaRaid.squads[Math.min(2, input.endgame.scyllaRaid.phaseIndex)] ?? [];
}

export function settleScyllaRaidPhase(input: GameSaveV1): {
  readonly save: GameSaveV1;
  readonly raidCompleted: boolean;
  readonly nextPhaseIndex: number;
} {
  const save = normalizeMetaSave(input);
  const phaseIndex = Math.min(2, save.endgame.scyllaRaid.phaseIndex);
  const phase = ENDGAME.raid.phases[phaseIndex]!;
  save.endgame.scyllaRaid.carryForward = [...new Set([
    ...save.endgame.scyllaRaid.carryForward,
    ...phase.carryForward,
  ])];
  if (phaseIndex < 2) {
    save.endgame.scyllaRaid.active = true;
    save.endgame.scyllaRaid.phaseIndex = phaseIndex + 1;
    return { save, raidCompleted: false, nextPhaseIndex: phaseIndex + 1 };
  }
  save.endgame.scyllaRaid.active = false;
  save.endgame.scyllaRaid.phaseIndex = 0;
  save.endgame.scyllaRaid.carryForward = [];
  return { save, raidCompleted: true, nextPhaseIndex: 0 };
}

export function getScyllaAffinityProgress(input: GameSaveV1): {
  readonly level: number;
  readonly next?: ScyllaAffinityMilestone;
} {
  const level = readNonNegativeInteger(
    input.endgame.bossAffinity["scylla-cat"],
    SCYLLA_AFFINITY_MAX,
  );
  return { level, next: SCYLLA_AFFINITY_MILESTONES.find((milestone) => milestone.level > level) };
}

/**
 * Returns the unbounded number of completed Scylla raids.
 *
 * Older saves used the capped affinity value as their only clear counter. When the
 * dedicated marker is absent (or damaged below the visible affinity), affinity is
 * the safest monotonic migration floor available.
 */
export function getScyllaRaidClearCount(input: GameSaveV1): number {
  const affinity = readNonNegativeInteger(
    input.endgame.bossAffinity["scylla-cat"],
    SCYLLA_AFFINITY_MAX,
  );
  const stored = readNonNegativeInteger(
    input.endgame.bossAffinity[SCYLLA_RAID_CLEAR_COUNT_KEY],
  );
  return Math.max(affinity, stored);
}

export function advanceScyllaAffinity(input: GameSaveV1): {
  readonly save: GameSaveV1;
  readonly previousLevel: number;
  readonly level: number;
  readonly previousClearCount: number;
  readonly clearCount: number;
  readonly milestones: readonly ScyllaAffinityMilestone[];
} {
  const save = normalizeMetaSave(input);
  const previousClearCount = getScyllaRaidClearCount(save);
  const clearCount = previousClearCount + 1;
  const previousLevel = readNonNegativeInteger(
    save.endgame.bossAffinity["scylla-cat"],
    SCYLLA_AFFINITY_MAX,
  );
  const level = Math.min(SCYLLA_AFFINITY_MAX, previousLevel + 1);
  save.endgame.bossAffinity["scylla-cat"] = level;
  save.endgame.bossAffinity[SCYLLA_RAID_CLEAR_COUNT_KEY] = clearCount;
  const milestones = SCYLLA_AFFINITY_MILESTONES.filter(
    (milestone) => milestone.level > previousLevel && milestone.level <= level,
  );
  for (const milestone of milestones) {
    if (milestone.kind === "material") {
      save.resources.materials[milestone.id] = (save.resources.materials[milestone.id] ?? 0) + milestone.amount;
    } else if (!save.inventory.skinIds.includes(milestone.id)) {
      save.inventory.skinIds.push(milestone.id);
      if (milestone.kind === "title") save.inventory.selectedTitleId ??= milestone.id;
    }
  }
  assertNoWalletState(save);
  return { save, previousLevel, level, previousClearCount, clearCount, milestones };
}

export function getEndgameRewardPlan(
  input: GameSaveV1,
  mode: PlayableEndgameMode,
  stageId: string,
): EndgameRewardPlan {
  const save = normalizeMetaSave(input);
  const stage = STAGE_BY_ID[stageId];
  if (mode === "oracleTower") {
    const floorIndex = Math.min(29, save.endgame.oracleTowerFloor);
    const floor = ENDGAME.oracleTower.floors[floorIndex]!;
    return {
      mode,
      label: save.endgame.oracleTowerFloor >= 30
        ? "신탁탑 30층 반복 보상"
        : `신탁탑 ${floor.floor}층 보상`,
      goldMultiplier: 1.15 + floorIndex * 0.025,
      heroXpMultiplier: 1.15 + floorIndex * 0.025,
      materialMultiplier: 1,
      bonuses: save.endgame.oracleTowerFloor >= 30 ? [] : [{ ...floor.reward }],
    };
  }
  if (mode === "stormRoute") {
    const node = getCurrentStormCombatNode(save);
    return {
      mode,
      label: `폭풍 항로 ${node.index}/12 · 보상 ×${node.rewardScale}`,
      goldMultiplier: node.rewardScale,
      heroXpMultiplier: node.rewardScale,
      materialMultiplier: node.rewardScale,
      bonuses: [],
    };
  }

  const clearCount = getScyllaRaidClearCount(save);
  const tier = clearCount % ENDGAME.raid.weeklyRewards.length;
  const weeklyReward = ENDGAME.raid.weeklyRewards[tier]!;
  const goldMultiplier = weeklyReward && stage?.rewards.gold
    ? weeklyReward.gold / stage.rewards.gold
    : 1.25;
  const heroXpMultiplier = weeklyReward && stage?.rewards.heroXp
    ? weeklyReward.heroXp / stage.rewards.heroXp
    : 1.25;
  const bonuses: EndgameBonusDefinition[] = weeklyReward
    ? [
        ...Object.entries(weeklyReward.materials).map(([id, amount]) => ({
          kind: "material" as const,
          id,
          amount,
        })),
        { ...weeklyReward.firstClear },
      ]
    : [];
  return {
    mode,
    label: `스킬라 토벌 순환 ${tier + 1}/3 · ${weeklyReward.firstClear.kind === "fragment" ? "퍼-씨 조각" : "유물"}`,
    goldMultiplier,
    heroXpMultiplier,
    materialMultiplier: weeklyReward ? 0 : 1.25,
    bonuses,
  };
}

export function grantEndgameStageRewards(
  input: GameSaveV1,
  options: {
    readonly mode: PlayableEndgameMode;
    readonly stageId: string;
    readonly partyHeroIds?: readonly string[];
  },
): EndgameRewardResult {
  const plan = getEndgameRewardPlan(input, options.mode, options.stageId);
  const repeatable = grantRepeatableStageRewards(input, {
    stageId: options.stageId,
    partyHeroIds: options.partyHeroIds,
    goldMultiplier: plan.goldMultiplier,
    heroXpMultiplier: plan.heroXpMultiplier,
    materialMultiplier: plan.materialMultiplier,
  });
  if (!repeatable.ok) return repeatable;
  const save = repeatable.save;
  const receipts = plan.bonuses.map((bonus) => grantEndgameBonus(save, bonus));
  assertNoWalletState(save);
  return {
    ok: true,
    save,
    stageId: options.stageId,
    plan,
    rewards: {
      ...repeatable.rewards,
      endgameLabel: plan.label,
      endgameBonuses: receipts,
    },
  };
}

export function canEnterStormBattle(input: GameSaveV1): boolean {
  return input.endgame.stormRoute.active
    || input.endgame.weeklyStormRuns < STORM_WEEKLY_BATTLE_LIMIT
    || (input.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] ?? 0) > 0;
}

export function consumeEndgameEntryCost(
  input: GameSaveV1,
  mode: PlayableEndgameMode,
): EndgameEntryCostResult {
  const save = normalizeMetaSave(input);
  if (mode === "scyllaRaid") {
    if (save.endgame.scyllaRaid.active) {
      return { ok: true, save, consumed: "none" };
    }
    if (save.endgame.raidKeys <= 0) {
      return { ok: false, code: "raid_key_required", message: "토벌 열쇠가 필요합니다.", save };
    }
    save.endgame.raidKeys -= 1;
    save.endgame.scyllaRaid.active = true;
    save.endgame.scyllaRaid.phaseIndex = 0;
    save.endgame.scyllaRaid.carryForward = [];
    return { ok: true, save, consumed: "raidKey" };
  }
  if (mode === "stormRoute" && save.endgame.stormRoute.active) {
    return { ok: true, save, consumed: "none" };
  }
  if (mode === "stormRoute" && save.endgame.weeklyStormRuns >= STORM_WEEKLY_BATTLE_LIMIT) {
    const tokens = save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] ?? 0;
    if (tokens <= 0) {
      return {
        ok: false,
        code: "storm_entry_required",
        message: "이번 주 기본 폭풍 전투를 모두 완료했습니다. 추가 출항권이 필요합니다.",
        save,
      };
    }
    save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] = tokens - 1;
    return { ok: true, save: activateStormRoute(save), consumed: "stormExtraEntry" };
  }
  return { ok: true, save: mode === "stormRoute" ? activateStormRoute(save) : save, consumed: "none" };
}

function advanceStormNode(save: GameSaveV1): void {
  const nextIndex = save.endgame.stormRoute.nodeIndex + 1;
  if (nextIndex >= ENDGAME.stormRoute.nodeCount) {
    save.endgame.weeklyStormRuns += 1;
    save.endgame.stormRoute.nodeIndex = 0;
    save.endgame.stormRoute.active = false;
    save.endgame.stormRoute.entryPaid = false;
    save.endgame.stormRoute.blessingIds = [];
    save.endgame.stormRoute.blessingOfferIds = [];
    save.endgame.stormRoute.blessingRerollCount = 0;
    save.endgame.stormRoute.curseIds = [];
    save.endgame.stormRoute.fallenHeroIds = [];
    save.endgame.stormRoute.partyHeroIds = [];
    save.endgame.stormRoute.swapCharges = 0;
    save.endgame.stormRoute.selectedStageId = null;
    return;
  }
  save.endgame.stormRoute.nodeIndex = nextIndex;
  save.endgame.stormRoute.selectedStageId = null;
  save.endgame.stormRoute.blessingOfferIds = [];
  save.endgame.stormRoute.blessingRerollCount = 0;
  const nextStage = getStormNodeStageId(save);
  save.endgame.stormRoute.selectedStageId = nextStage ?? null;
}

function stormChoiceLabel(optionId: string): string {
  const blessingName = BLESSING_BY_ID[optionId]?.name;
  if (blessingName) return blessingName;
  const labels: Readonly<Record<string, string>> = {
    "short-preview": "짧아진 예측선",
    "rising-current": "솟구치는 해류",
    "fragile-walls": "부서지기 쉬운 벽",
    repair: "선체와 선원 응급 수리",
    "swap-one-hero": "선원 한 명 교대",
    "revive-one-hero": "쓰러진 영웅 한 명 복귀",
    "remove-one-curse": "저주 하나 정화",
    [STORM_HARBOR_SUPPLY_OPTION_ID]: "항구 보급품 수령",
  };
  return labels[optionId] ?? optionId;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function readNonNegativeInteger(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(maximum, Math.max(0, Math.floor(numeric)));
}

function validateRaidSquads(input: GameSaveV1, parties: readonly (readonly string[])[]): { valid: boolean; message: string } {
  const result = validateScyllaRaidSquads(input, parties);
  return { valid: result.valid, message: result.issues[0]?.message ?? "올바른 토벌 분대를 편성하세요." };
}

function grantEndgameBonus(
  save: GameSaveV1,
  bonus: EndgameBonusDefinition,
): EndgameBonusRewardReceipt {
  const amount = Math.max(0, Math.floor(bonus.amount));
  if (bonus.kind === "material" && amount > 0) {
    save.resources.materials[bonus.id] = (save.resources.materials[bonus.id] ?? 0) + amount;
    return { kind: "material", id: bonus.id, amount, granted: true };
  }
  if (bonus.kind === "fragment" && amount > 0) {
    save.roster.heroShards[bonus.id] = (save.roster.heroShards[bonus.id] ?? 0) + amount;
    return { kind: "fragment", id: bonus.id, amount, granted: true };
  }
  if (bonus.kind === "hero" && HERO_BY_ID[bonus.id]) {
    const result = grantHero(save, bonus.id, Math.max(20, HERO_BY_ID[bonus.id]!.rarity * 10));
    if (result.ok) {
      Object.assign(save, result.save);
      return {
        kind: "hero",
        id: bonus.id,
        amount: result.newlyOwned ? 1 : result.shardsGranted,
        granted: true,
      };
    }
  }
  if (bonus.kind === "relic") {
    const relicGrant = grantRelicToVault(save, bonus.id);
    if (relicGrant.ok) {
      Object.assign(save, relicGrant.save);
      if (relicGrant.receipt.granted) {
        return { kind: "relic", id: bonus.id, amount: 1, granted: true };
      }
      return {
        kind: "relicDust",
        id: "relic-dust",
        amount: relicGrant.receipt.relicDustGranted,
        granted: true,
        reason: relicGrant.receipt.reason === "vault_full" ? "vault_full" : "duplicate",
        sourceRelicId: bonus.id,
      };
    }
  }
  if (bonus.kind === "title" && amount > 0) {
    const titleId = `title:${bonus.id}`;
    const granted = !save.inventory.skinIds.includes(titleId);
    if (granted) {
      save.inventory.skinIds.push(titleId);
      save.inventory.selectedTitleId ??= titleId;
    }
    return { kind: "title", id: bonus.id, amount: 1, granted };
  }
  return { kind: bonus.kind, id: bonus.id, amount, granted: false };
}
