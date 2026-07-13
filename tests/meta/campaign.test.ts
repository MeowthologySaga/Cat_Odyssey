import { describe, expect, it } from "vitest";

import { ROUTES, STAGES } from "../../src/data";
import {
  completeCampaignStage,
  getCampaignRouteViews,
  getStageView,
  getTotalCampaignStars,
  initializeStarterRoster,
  normalizeMetaSave,
} from "../../src/core/meta";
import { createDefaultSave, normalizeSave } from "../../src/state";

describe("campaign meta reducer", () => {
  it("migrates the legacy default route id to the canonical route catalog", () => {
    const save = normalizeMetaSave(createDefaultSave());
    expect(save.progress.unlockedRouteIds).toEqual(["route-01-ogygia"]);
    expect(save.progress.activeRouteId).toBe("route-01-ogygia");
  });

  it("rebuilds route unlocks and campaign completion from durable stage history", () => {
    const partial = createDefaultSave();
    partial.progress.completedStageIds = [...ROUTES[0]!.stageIds];
    partial.progress.unlockedRouteIds = [ROUTES[0]!.id];
    partial.progress.campaignComplete = true;
    const repairedPartial = normalizeMetaSave(partial);
    expect(repairedPartial.progress.unlockedRouteIds).toEqual([ROUTES[0]!.id, ROUTES[1]!.id]);
    expect(repairedPartial.progress.campaignComplete).toBe(false);

    const complete = createDefaultSave();
    complete.progress.completedStageIds = STAGES.map((stage) => stage.id);
    complete.progress.unlockedRouteIds = [ROUTES[0]!.id];
    complete.progress.campaignComplete = false;
    const repairedComplete = normalizeMetaSave(complete);
    expect(repairedComplete.progress.unlockedRouteIds).toEqual(ROUTES.map((route) => route.id));
    expect(repairedComplete.progress.campaignComplete).toBe(true);
  });

  it("treats a legacy first-clear claim as completion proof", () => {
    const save = createDefaultSave();
    save.progress.claimedFirstClearStageIds = ["r10-s01"];
    save.progress.completedStageIds = [];
    const repaired = normalizeMetaSave(save);
    expect(repaired.progress.completedStageIds).toContain("r10-s01");
    expect(repaired.progress.unlockedRouteIds).toEqual(ROUTES.map((route) => route.id));
  });

  it("tracks completion, stars, and all ten route unlocks across 43 stages", () => {
    let save = initializeStarterRoster(createDefaultSave());
    const unlocked = new Set(save.progress.unlockedRouteIds);

    for (const stage of STAGES) {
      const result = completeCampaignStage(save, { stageId: stage.id, stars: 1 });
      expect(result.ok, stage.id).toBe(true);
      if (!result.ok) throw new Error(result.message);
      save = result.save;
      result.newlyUnlockedRouteIds.forEach((routeId) => unlocked.add(routeId));
    }

    expect(save.progress.completedStageIds).toHaveLength(43);
    expect(save.progress.unlockedRouteIds).toEqual(ROUTES.map((route) => route.id));
    expect(unlocked.size).toBe(10);
    expect(save.progress.campaignComplete).toBe(true);
    expect(getTotalCampaignStars(save)).toBe(43);
    expect(getCampaignRouteViews(save).every((route) => route.completed)).toBe(true);

    const replay = completeCampaignStage(save, { stageId: "r03-s05", stars: 3 });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.message);
    expect(replay.firstCompletion).toBe(false);
    expect(getStageView(replay.save, "r03-s05")?.stars).toBe(3);
    expect(getTotalCampaignStars(replay.save)).toBe(45);
  });

  it("rejects locked stages without mutating the input", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const before = JSON.stringify(save);
    const result = completeCampaignStage(save, { stageId: "r10-s05", stars: 3 });
    expect(result).toMatchObject({ ok: false, code: "stage_locked" });
    expect(JSON.stringify(save)).toBe(before);
  });

  it("round-trips star and level compatibility keys through the current save schema", () => {
    let save = initializeStarterRoster(createDefaultSave());
    const result = completeCampaignStage(save, { stageId: "r01-s01", stars: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    save = normalizeSave(JSON.parse(JSON.stringify(result.save)) as unknown);
    expect(getStageView(save, "r01-s01")?.stars).toBe(3);
    expect(JSON.stringify(save)).not.toMatch(/walletBalance|diamondBalance|diamonds/i);
  });
});
