import { describe, expect, it } from "vitest";

import {
  COMBAT_HELP_CARDS,
  completeOnboarding,
  crewJoinMarker,
  FIRST_VOYAGE_STAGE_ID,
  findPendingCrewJoin,
  hasCompletedOnboarding,
  hasSeenRouteStory,
  hasSeenTutorialCoachmark,
  markCrewJoinSeen,
  markRouteStorySeen,
  markTutorialCoachmarkSeen,
  ONBOARDING_PREP_STEPS,
  readTutorialStep,
  resolveCrewJoinDestination,
  resolveOnboardingExitDestination,
  resolveRoutePreludeDestination,
  resolveStoryInterludeDestination,
  resolveTitleVoyageDestination,
  resolveTriggeredStoryInterlude,
  resolveTriggeredStoryInterludes,
  routeStoryContent,
  shouldOfferTutorialCoachmark,
  TUTORIAL_COACHMARK_CONTENT,
  writeTutorialStep,
} from "../../src/core/uxFlow";
import { STORY_INTERLUDE_MANIFEST } from "../../src/data/cutscenes";
import { lockedStageMessage, nextStarReplayTarget, stageStarConditions, stageStarsText } from "../../src/scenes/routePresentation";
import { calculateStageStars } from "../../src/scenes/stageStarRules";
import { STAGE_BY_ID } from "../../src/data";
import { createDefaultSave, normalizeSave } from "../../src/state";

describe("first voyage UX persistence", () => {
  it("persists tutorial progress and completion through save normalization", () => {
    const save = createDefaultSave();
    expect(hasCompletedOnboarding(save)).toBe(false);
    writeTutorialStep(save, 1);
    expect(readTutorialStep(normalizeSave(save))).toBe(1);
    completeOnboarding(save);
    const restored = normalizeSave(JSON.parse(JSON.stringify(save)));
    expect(hasCompletedOnboarding(restored)).toBe(true);
    expect(readTutorialStep(restored)).toBe(0);
  });

  it("uses only two preparation steps and routes the real first stage through its prelude", () => {
    expect(ONBOARDING_PREP_STEPS).toHaveLength(2);
    expect(ONBOARDING_PREP_STEPS.map((step) => step.id)).toEqual(["launch", "cancel"]);
    const copy = ONBOARDING_PREP_STEPS.map((step) => `${step.detail} ${step.inputHint}`).join(" ");
    expect(copy).toContain("검은 여백");
    expect(copy).toContain("우클릭");
    expect(copy).toContain("Esc");
    expect(copy).toContain("터치");
    expect(resolveOnboardingExitDestination()).toEqual({
      sceneKey: "Party",
      data: { stageId: FIRST_VOYAGE_STAGE_ID },
    });
    const freshSave = createDefaultSave();
    completeOnboarding(freshSave);
    expect(resolveOnboardingExitDestination({ save: freshSave })).toEqual({
      sceneKey: "Story",
      data: {
        kind: "route",
        routeId: "route-01-ogygia",
        returnScene: "Party",
        returnData: { stageId: FIRST_VOYAGE_STAGE_ID },
      },
    });
    markRouteStorySeen(freshSave, "route-01-ogygia");
    expect(resolveOnboardingExitDestination({ save: freshSave })).toEqual({
      sceneKey: "Party",
      data: { stageId: FIRST_VOYAGE_STAGE_ID },
    });
    expect(resolveOnboardingExitDestination({
      replay: true,
      returnScene: "Settings",
      returnData: { returnScene: "Harbor" },
    })).toEqual({ sceneKey: "Settings", data: { returnScene: "Harbor" } });
    expect(STAGE_BY_ID[FIRST_VOYAGE_STAGE_ID]?.modifiers).toContain("tutorial:direct-hit");
  });

  it("resumes an unfinished first battle and keeps help replay separate from progress", () => {
    const save = createDefaultSave();
    expect(resolveTitleVoyageDestination(save)).toEqual({
      sceneKey: "Tutorial",
      data: { returnScene: "Harbor" },
    });
    completeOnboarding(save);
    expect(resolveTitleVoyageDestination(save)).toEqual({
      sceneKey: "Story",
      data: {
        kind: "route",
        routeId: "route-01-ogygia",
        returnScene: "Party",
        returnData: { stageId: FIRST_VOYAGE_STAGE_ID },
      },
    });
    markRouteStorySeen(save, "route-01-ogygia");
    expect(resolveTitleVoyageDestination(save)).toEqual({
      sceneKey: "Party",
      data: { stageId: FIRST_VOYAGE_STAGE_ID },
    });
    save.progress.completedStageIds.push(FIRST_VOYAGE_STAGE_ID);
    expect(resolveTitleVoyageDestination(save)).toEqual({ sceneKey: "Harbor" });
  });

  it("uses the same route-prelude resolver for direct and route-map entry", () => {
    const save = createDefaultSave();
    expect(resolveRoutePreludeDestination(save, "route-02-lotus", "Party", { stageId: "r02-s01" })).toEqual({
      sceneKey: "Story",
      data: {
        kind: "route",
        routeId: "route-02-lotus",
        returnScene: "Party",
        returnData: { stageId: "r02-s01" },
      },
    });
    markRouteStorySeen(save, "route-02-lotus");
    expect(resolveRoutePreludeDestination(save, "route-02-lotus", "Party", { stageId: "r02-s01" })).toEqual({
      sceneKey: "Party",
      data: { stageId: "r02-s01" },
    });
  });

  it("claims aim, ricochet, and ally-contact coachmarks only once in eligible play", () => {
    const save = createDefaultSave();
    completeOnboarding(save);
    const soloTutorial = {
      stageId: FIRST_VOYAGE_STAGE_ID,
      modifierIds: ["preview-bounces:1", "tutorial:direct-hit"],
      partySize: 1,
    };
    expect(shouldOfferTutorialCoachmark(save, "first-aim", soloTutorial)).toBe(true);
    expect(markTutorialCoachmarkSeen(save, "first-aim")).toBe(true);
    expect(markTutorialCoachmarkSeen(save, "first-aim")).toBe(false);
    expect(hasSeenTutorialCoachmark(save, "first-aim")).toBe(true);
    expect(shouldOfferTutorialCoachmark(save, "first-aim", soloTutorial)).toBe(false);
    expect(shouldOfferTutorialCoachmark(save, "first-ricochet", {
      ...soloTutorial,
      stageId: "r01-s02",
    })).toBe(false);
    expect(shouldOfferTutorialCoachmark(save, "first-ally-contact", soloTutorial)).toBe(false);
    expect(shouldOfferTutorialCoachmark(save, "first-ally-contact", {
      ...soloTutorial,
      stageId: "r01-s04",
      modifierIds: [],
      partySize: 2,
    })).toBe(true);
    expect(TUTORIAL_COACHMARK_CONTENT["first-aim"].inputHint).toMatch(/우클릭.*Esc.*손가락/);
    expect(COMBAT_HELP_CARDS).toHaveLength(4);
  });

  it("tracks route intros and resolves crew joins in canonical stage order", () => {
    const save = createDefaultSave();
    save.progress.completedStageIds = ["r02-s02", "r01-s03"];
    save.roster.ownedHeroIds.push("nausi-cat", "orange-sailor", "tuxedo-sailor");
    expect(findPendingCrewJoin(save)).toEqual({ stageId: "r02-s02", heroId: "orange-sailor" });
    markCrewJoinSeen(save, "orange-sailor");
    expect(findPendingCrewJoin(save)).toEqual({ stageId: "r02-s02", heroId: "tuxedo-sailor" });
    markCrewJoinSeen(save, "tuxedo-sailor");
    expect(findPendingCrewJoin(save)).toEqual({ stageId: "r02-s02", heroId: "nausi-cat" });
    markCrewJoinSeen(save, "nausi-cat");
    expect(save.inventory.skinIds).toContain(crewJoinMarker("nausi-cat"));
    expect(findPendingCrewJoin(save)).toBeUndefined();
    expect(hasSeenRouteStory(save, "route-01-ogygia")).toBe(false);
    markRouteStorySeen(save, "route-01-ogygia");
    expect(hasSeenRouteStory(save, "route-01-ogygia")).toBe(true);
    expect(routeStoryContent("route-01-ogygia").body.length).toBeGreaterThanOrEqual(2);
    expect(routeStoryContent("route-04-aeolus").body.length).toBeGreaterThanOrEqual(2);
  });

  it("presents Tele-meow-chus after the reunion milestone and Argos only after his encounter", () => {
    const save = createDefaultSave();
    save.progress.completedStageIds = ["r10-s01"];
    save.progress.claimedFirstClearStageIds = ["r10-s01"];
    save.roster.ownedHeroIds.push("eumaeus", "tele-meow-chus");

    expect(findPendingCrewJoin(save)).toEqual({ stageId: "r10-s01", heroId: "eumaeus" });
    expect(resolveCrewJoinDestination(save, "Party", { stageId: "r10-s02" })).toEqual({
      sceneKey: "Story",
      data: {
        kind: "crew",
        heroId: "eumaeus",
        returnScene: "Party",
        returnData: { stageId: "r10-s02" },
      },
    });

    markCrewJoinSeen(save, "eumaeus");
    expect(findPendingCrewJoin(save)).toEqual({ stageId: "r10-s01", heroId: "tele-meow-chus" });
    markCrewJoinSeen(save, "tele-meow-chus");
    expect(resolveCrewJoinDestination(save, "Party", { stageId: "r10-s02" })).toEqual({
      sceneKey: "Party",
      data: { stageId: "r10-s02" },
    });

    save.progress.completedStageIds.push("r10-s02");
    save.roster.ownedHeroIds.push("argos");
    expect(findPendingCrewJoin(save)).toEqual({ stageId: "r10-s02", heroId: "argos" });
    markCrewJoinSeen(save, "argos");
    expect(resolveCrewJoinDestination(save, "Party", { stageId: "r10-s02" })).toEqual({
      sceneKey: "Party",
      data: { stageId: "r10-s02" },
    });
  });

  it("keeps Route 7-10 causality in video-free canon cards and fixes the Thrinacia key", () => {
    expect(STORY_INTERLUDE_MANIFEST.map((interlude) => interlude.id)).toEqual([
      "interlude-route07-circe-warning",
      "interlude-route08-narrow-choice",
      "interlude-route09-taboo-reminder",
      "interlude-r09-wreck-to-ogygia",
      "interlude-route10-phaeacia-return",
      "interlude-r10-beggar-disguise",
      "interlude-r10-homecoming-complete",
    ]);
    for (const routeId of ["route-07-sirens", "route-08-strait", "route-09-thrinacia", "route-10-ithaca"]) {
      const content = routeStoryContent(routeId);
      expect(content.body.length, routeId).toBeGreaterThanOrEqual(2);
      expect(content.body.join(" "), routeId).not.toMatch(/\b(?:The|crew|ship|returns|Odysseus)\b/i);
    }
    expect(routeStoryContent("route-09-thrinacia").title).toBe("태양 목장의 금기");
    expect(routeStoryContent("route-09-sun").body.join(" ")).not.toContain("The crew violates");
  });

  it("resolves stage interludes once through the existing route-card Story scene", () => {
    const save = createDefaultSave();
    const trigger = { kind: "stage" as const, stageId: "r09-s04", timing: "after" as const };
    expect(resolveTriggeredStoryInterludes(save, trigger).map((interlude) => interlude.id))
      .toEqual(["interlude-r09-wreck-to-ogygia"]);
    expect(resolveStoryInterludeDestination(save, trigger, "Route", { routeId: "route-10-ithaca" })).toEqual({
      sceneKey: "Story",
      data: {
        kind: "route",
        routeId: "interlude-r09-wreck-to-ogygia",
        returnScene: "Route",
        returnData: { routeId: "route-10-ithaca" },
      },
    });

    markRouteStorySeen(save, "interlude-r09-wreck-to-ogygia");
    expect(resolveTriggeredStoryInterlude(save, trigger)).toBeUndefined();
    expect(resolveTriggeredStoryInterlude(save, trigger, { replay: true })?.id)
      .toBe("interlude-r09-wreck-to-ogygia");
  });
});

describe("route star readability", () => {
  const stage = STAGE_BY_ID["r01-s01"]!;
  const surviveStage = STAGE_BY_ID["r01-s04"]!;
  const protectStage = STAGE_BY_ID["r02-s02"]!;

  it("shows earned and missing stars consistently", () => {
    expect(stageStarsText(0)).toBe("☆☆☆");
    expect(stageStarsText(2)).toBe("★★☆");
    expect(stageStarsText(9)).toBe("★★★");
  });

  it("explains 2/3-star requirements and the next replay target", () => {
    const conditions = stageStarConditions(stage);
    expect(conditions[1]).toContain(`${Math.ceil(stage.objective.turnLimit * 0.8)}턴`);
    expect(conditions[1]).toContain("목표 파괴");
    expect(conditions[2]).toContain("60%");
    expect(nextStarReplayTarget(2, stage)).toContain("3성");
  });

  it("explains the exact gate when a locked stage is clicked", () => {
    expect(lockedStageMessage(4, false)).toContain("항로 03");
    expect(lockedStageMessage(4, true, "폭풍 주머니")).toContain("폭풍 주머니");
    expect(lockedStageMessage(1, false)).toContain("항로 이야기");
  });

  it("keeps the standard speed star for non-endurance objectives", () => {
    const speedLimit = Math.ceil(stage.objective.turnLimit * 0.8);
    expect(calculateStageStars(stage, {
      turns: speedLimit,
      hpRatio: 0.2,
      bestCombo: 0,
      fallenHeroCount: 1,
    })).toBe(2);
    expect(calculateStageStars(stage, {
      turns: speedLimit + 1,
      hpRatio: 0.2,
      bestCombo: 0,
      fallenHeroCount: 0,
    })).toBe(1);
  });

  it.each([surviveStage, protectStage])(
    "uses full-party survival instead of an impossible speed star for $id",
    (enduranceStage) => {
      const conditions = stageStarConditions(enduranceStage);
      expect(conditions[1]).toContain("전투 불능 없이");
      expect(conditions[1]).not.toContain("턴 이내");
      expect(nextStarReplayTarget(1, enduranceStage)).toContain("전투 불능 없이");

      expect(calculateStageStars(enduranceStage, {
        turns: enduranceStage.objective.turnLimit,
        hpRatio: 0.2,
        bestCombo: 0,
        fallenHeroCount: 0,
      })).toBe(2);
      expect(calculateStageStars(enduranceStage, {
        turns: enduranceStage.objective.turnLimit,
        hpRatio: 0.2,
        bestCombo: 0,
        fallenHeroCount: 1,
      })).toBe(1);
    },
  );
});
