import { HEROES, RELICS, ROUTES, STAGES } from "../data";
import { CUTSCENE_MANIFEST, STORY_INTERLUDE_MANIFEST } from "../data/cutscenes";
import type { GameSaveV1 } from "../state";
import { markCutscenesSeen } from "./cutsceneFlow";
import { MAX_ASCENSION, MAX_HERO_LEVEL } from "./meta/constants";
import { RAID_KEY_CRAFT_COST } from "./meta/economy";
import {
  STORM_EXTRA_ENTRY_MATERIAL_ID,
  STORM_HARBOR_SUPPLY_MATERIAL_ID,
} from "./meta/endgameLoop";
import {
  completeOnboarding,
  markCrewJoinSeen,
  markRouteStorySeen,
} from "./uxFlow";

export const DEBUG_QUERY_PARAMETER = "catDebug" as const;
export const DEBUG_RESOURCE_AMOUNT = 999_999 as const;

/**
 * Debug mode is deliberately query-only. There is no remembered setting, key
 * chord, or release UI path that can enable it for an ordinary player.
 */
export function isDebugModeRequested(search: string): boolean {
  const normalized = search.startsWith("?") ? search : `?${search}`;
  const value = new URLSearchParams(normalized).get(DEBUG_QUERY_PARAMETER)?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

/** Completes every canon beat and makes every finished episode replayable. */
export function unlockAllDebugStory(save: GameSaveV1): void {
  save.progress.completedStageIds = STAGES.map((stage) => stage.id);
  save.progress.claimedFirstClearStageIds = STAGES.map((stage) => stage.id);
  save.progress.stageStars = Object.fromEntries(STAGES.map((stage) => [stage.id, 3]));
  save.progress.unlockedRouteIds = ROUTES.map((route) => route.id);
  save.progress.activeRouteId = ROUTES.at(-1)?.id ?? ROUTES[0]?.id ?? null;
  save.progress.campaignComplete = true;

  completeOnboarding(save);
  markCutscenesSeen(save, CUTSCENE_MANIFEST.map((cutscene) => cutscene.id));
  for (const route of ROUTES) markRouteStorySeen(save, route.id);
  for (const interlude of STORY_INTERLUDE_MANIFEST) markRouteStorySeen(save, interlude.id);

  const storyHeroIds = HEROES
    .filter((hero) => hero.unlock === "story" || hero.unlock === "starter")
    .map((hero) => hero.id);
  save.roster.ownedHeroIds = unique([...save.roster.ownedHeroIds, ...storyHeroIds]);
  for (const heroId of storyHeroIds) {
    save.roster.heroLevels[heroId] = Math.max(1, save.roster.heroLevels[heroId] ?? 1);
    markCrewJoinSeen(save, heroId);
  }
}

/** Owns and fully grows the complete authored roster without touching a wallet. */
export function unlockAllDebugHeroes(save: GameSaveV1): void {
  const heroIds = HEROES.map((hero) => hero.id);
  save.roster.ownedHeroIds = heroIds;
  save.roster.partyHeroIds = preserveValidParty(save.roster.partyHeroIds, heroIds);
  save.roster.partyPresets = [
    heroIds.slice(0, 3),
    heroIds.slice(3, 6),
    heroIds.slice(6, 9),
  ];
  for (const heroId of heroIds) {
    save.roster.heroXp[heroId] = DEBUG_RESOURCE_AMOUNT;
    save.roster.heroLevels[heroId] = MAX_HERO_LEVEL;
    save.roster.heroShards[heroId] = DEBUG_RESOURCE_AMOUNT;
    save.roster.heroAwakening[heroId] = MAX_ASCENSION;
    markCrewJoinSeen(save, heroId);
  }
}

/** Grants only game-owned resources; diamonds remain exclusively Host-owned. */
export function grantDebugResources(save: GameSaveV1): void {
  save.resources.gold = DEBUG_RESOURCE_AMOUNT;
  save.resources.awakeningMaterials = DEBUG_RESOURCE_AMOUNT;
  save.resources.relicDust = DEBUG_RESOURCE_AMOUNT;
  save.resources.fateDust = DEBUG_RESOURCE_AMOUNT;
  save.resources.vaultSlots = Math.max(save.resources.vaultSlots, RELICS.length + 20);

  for (const materialId of debugMaterialIds()) {
    save.resources.materials[materialId] = DEBUG_RESOURCE_AMOUNT;
  }
  save.inventory.relicIds = RELICS.map((relic) => relic.id);
  for (const relic of RELICS) save.inventory.relicLevels[relic.id] = 5;
}

/** Opens every endgame gate and supplies renewable entries for repeated QA. */
export function unlockAllDebugEndgame(save: GameSaveV1): void {
  unlockAllDebugStory(save);
  unlockAllDebugHeroes(save);
  save.endgame.weeklyStormRuns = 0;
  save.endgame.raidKeys = Math.max(save.endgame.raidKeys, 99);
  save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] = DEBUG_RESOURCE_AMOUNT;
  save.resources.materials[RAID_KEY_CRAFT_COST.materialId] = DEBUG_RESOURCE_AMOUNT;
}

/** Clears only volatile run journals so any campaign/endgame node can be re-entered. */
export function clearDebugRunState(save: GameSaveV1): void {
  save.recovery.pendingBattleRescue = null;
  save.recovery.activeCampaignBattle = null;
  save.recovery.pendingCampaignVictorySettlement = null;
  save.recovery.pendingEndgameVictorySettlement = null;
  save.pendingPurchases = [];
  save.endgame.stormRoute = {
    weekId: 0,
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
  save.endgame.scyllaRaid = {
    active: false,
    phaseIndex: 0,
    squads: [],
    carryForward: [],
  };
}

export function prepareCompleteDebugSave(save: GameSaveV1): void {
  unlockAllDebugEndgame(save);
  grantDebugResources(save);
  clearDebugRunState(save);
}

export interface DebugSaveSummary {
  readonly completedStages: number;
  readonly totalStages: number;
  readonly ownedHeroes: number;
  readonly totalHeroes: number;
  readonly raidKeys: number;
  readonly gold: number;
}

export function summarizeDebugSave(save: GameSaveV1): DebugSaveSummary {
  return {
    completedStages: save.progress.completedStageIds.length,
    totalStages: STAGES.length,
    ownedHeroes: save.roster.ownedHeroIds.length,
    totalHeroes: HEROES.length,
    raidKeys: save.endgame.raidKeys,
    gold: save.resources.gold,
  };
}

function debugMaterialIds(): readonly string[] {
  const ids = new Set<string>([
    STORM_EXTRA_ENTRY_MATERIAL_ID,
    STORM_HARBOR_SUPPLY_MATERIAL_ID,
    RAID_KEY_CRAFT_COST.materialId,
  ]);
  for (const stage of STAGES) {
    Object.keys(stage.rewards.materials).forEach((id) => ids.add(id));
    if (stage.rewards.firstClear.kind === "material" || stage.rewards.firstClear.kind === "fragment") {
      ids.add(stage.rewards.firstClear.id);
    }
  }
  return [...ids];
}

function preserveValidParty(current: readonly string[], heroIds: readonly string[]): string[] {
  const valid = unique(current.filter((heroId) => heroIds.includes(heroId))).slice(0, 3);
  for (const heroId of heroIds) {
    if (valid.length >= 3) break;
    if (!valid.includes(heroId)) valid.push(heroId);
  }
  return valid;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
