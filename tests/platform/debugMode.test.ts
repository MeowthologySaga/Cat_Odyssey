import { HEROES, RELICS, ROUTES, STAGES } from "../../src/data";
import { CUTSCENE_MANIFEST } from "../../src/data/cutscenes";
import { hasSeenCutscene } from "../../src/core/cutsceneFlow";
import {
  isDebugModeRequested,
  prepareCompleteDebugSave,
  unlockAllDebugEndgame,
  unlockAllDebugStory,
} from "../../src/core/debugMode";
import { getEndgameGates } from "../../src/core/meta";
import { createDefaultSave } from "../../src/state";
import { describe, expect, it } from "vitest";

describe("explicit developer voyage mode", () => {
  it("activates only through the dedicated query flag", () => {
    expect(isDebugModeRequested("")).toBe(false);
    expect(isDebugModeRequested("?debug=1")).toBe(false);
    expect(isDebugModeRequested("?catDebug=0")).toBe(false);
    expect(isDebugModeRequested("?catDebug=1")).toBe(true);
    expect(isDebugModeRequested("catDebug=true")).toBe(true);
    expect(isDebugModeRequested("?catDebug=on&route=10")).toBe(true);
  });

  it("unlocks every campaign stage and finished cutscene replay", () => {
    const save = createDefaultSave();
    unlockAllDebugStory(save);

    expect(save.progress.completedStageIds).toEqual(STAGES.map((stage) => stage.id));
    expect(save.progress.unlockedRouteIds).toEqual(ROUTES.map((route) => route.id));
    expect(save.progress.campaignComplete).toBe(true);
    expect(Object.values(save.progress.stageStars).every((stars) => stars === 3)).toBe(true);
    expect(CUTSCENE_MANIFEST.every((cutscene) => hasSeenCutscene(save, cutscene.id))).toBe(true);
    expect(getEndgameGates(save).oracleTower.unlocked).toBe(true);
  });

  it("opens every endgame gate and supplies repeatable entries", () => {
    const save = createDefaultSave();
    unlockAllDebugEndgame(save);
    const gates = getEndgameGates(save);

    expect(gates.oracleTower.unlocked).toBe(true);
    expect(gates.stormRoute.unlocked).toBe(true);
    expect(gates.scyllaRaid.unlocked).toBe(true);
    expect(save.endgame.raidKeys).toBeGreaterThanOrEqual(99);
    expect(save.roster.ownedHeroIds).toHaveLength(HEROES.length);
  });

  it("prepares a complete QA save without introducing wallet state", () => {
    const save = createDefaultSave();
    prepareCompleteDebugSave(save);

    expect(save.resources.gold).toBe(999_999);
    expect(save.inventory.relicIds).toHaveLength(RELICS.length);
    expect(save.roster.ownedHeroIds).toHaveLength(HEROES.length);
    expect(save.recovery.activeCampaignBattle).toBeNull();
    expect(save.endgame.stormRoute.active).toBe(false);
    expect(JSON.stringify(save)).not.toMatch(/walletBalance|diamondBalance|diamonds/i);
  });
});
