import { describe, expect, it } from "vitest";
import { STAGES, STAGE_BY_ID, type StageDefinition } from "../../src/data";
import { nextStarReplayTarget, stageStarConditions } from "../../src/scenes/routePresentation";
import {
  calculateStageStars,
  stageStarConditionSpecs,
  type StageStarPerformance,
} from "../../src/scenes/stageStarRules";

const OBJECTIVE_STAGE_IDS = {
  "defeat-all": "r02-s01",
  survive: "r01-s04",
  protect: "r02-s02",
  escape: "r03-s03",
  seal: "r04-s04",
  "break-parts": "r01-s01",
  assemble: "r01-s02",
} as const satisfies Record<StageDefinition["objective"]["type"], string>;

function stage(id: string): StageDefinition {
  return STAGE_BY_ID[id]!;
}

function performance(overrides: Partial<StageStarPerformance> = {}): StageStarPerformance {
  return { turns: 999, hpRatio: 0, bestCombo: 0, fallenHeroCount: 1, ...overrides };
}

function speedLimit(value: StageDefinition, ratio: number): number {
  const workFloor = Math.max(
    1,
    Math.round(value.objective.requiredCount ?? value.objective.targetIds.length),
  );
  return Math.min(value.objective.turnLimit, Math.max(workFloor, Math.ceil(value.objective.turnLimit * ratio)));
}

describe("objective-specific stage star rules", () => {
  it("covers every authored objective type with reachable one- and three-star results", () => {
    const authoredTypes = [...new Set(STAGES.map((entry) => entry.objective.type))].sort();
    expect(authoredTypes).toEqual(Object.keys(OBJECTIVE_STAGE_IDS).sort());

    for (const authoredStage of STAGES) {
      expect(calculateStageStars(authoredStage, performance()), authoredStage.id).toBe(1);
      const reachableTurns = ["survive", "protect", "seal"].includes(authoredStage.objective.type)
        ? authoredStage.objective.turnLimit
        : speedLimit(authoredStage, 0.65);
      expect(calculateStageStars(authoredStage, performance({
        turns: reachableTurns,
        hpRatio: 1,
        bestCombo: 99,
        fallenHeroCount: 0,
      })), authoredStage.id).toBe(3);
      expect(stageStarConditionSpecs(authoredStage).every((condition) => !condition.description.includes("또는")), authoredStage.id).toBe(true);
    }
  });

  it("keeps Route guidance and Reward calculation on the same condition specs", () => {
    for (const stageId of Object.values(OBJECTIVE_STAGE_IDS)) {
      const value = stage(stageId);
      const specs = stageStarConditionSpecs(value);
      expect(stageStarConditions(value)).toEqual(specs.map((condition) => condition.label));
      expect(nextStarReplayTarget(1, value)).toContain(specs[1]!.description);
      expect(nextStarReplayTarget(2, value)).toContain(specs[2]!.description);
    }
  });

  it("uses speed plus a real combo for defeat-all mastery", () => {
    const value = stage(OBJECTIVE_STAGE_IDS["defeat-all"]);
    const secondary = speedLimit(value, 0.8);
    const mastery = speedLimit(value, 0.65);
    expect(calculateStageStars(value, performance({ turns: secondary, bestCombo: 0 }))).toBe(2);
    expect(calculateStageStars(value, performance({ turns: secondary + 1, bestCombo: 99 }))).toBe(1);
    expect(calculateStageStars(value, performance({ turns: mastery, bestCombo: 4 }))).toBe(3);
    expect(calculateStageStars(value, performance({ turns: mastery, bestCombo: 3 }))).toBe(2);
    expect(calculateStageStars(value, performance({ turns: mastery + 1, bestCombo: 99 }))).toBe(2);
  });

  it("uses no incapacitations and remaining HP for survive mastery", () => {
    const value = stage(OBJECTIVE_STAGE_IDS.survive);
    expect(calculateStageStars(value, performance({ fallenHeroCount: 0, hpRatio: 0.649 }))).toBe(2);
    expect(calculateStageStars(value, performance({ fallenHeroCount: 0, hpRatio: 0.65 }))).toBe(3);
    expect(calculateStageStars(value, performance({ fallenHeroCount: 1, hpRatio: 1 }))).toBe(1);
  });

  it("sets a stricter HP boundary for protect mastery", () => {
    const value = stage(OBJECTIVE_STAGE_IDS.protect);
    expect(calculateStageStars(value, performance({ fallenHeroCount: 0, hpRatio: 0.749 }))).toBe(2);
    expect(calculateStageStars(value, performance({ fallenHeroCount: 0, hpRatio: 0.75 }))).toBe(3);
    expect(calculateStageStars(value, performance({ fallenHeroCount: 1, hpRatio: 1 }))).toBe(1);
  });

  it("requires quick turns and full-party survival for escape stars", () => {
    const value = stage(OBJECTIVE_STAGE_IDS.escape);
    const secondary = speedLimit(value, 0.8);
    const mastery = speedLimit(value, 0.65);
    expect(calculateStageStars(value, performance({ turns: secondary, fallenHeroCount: 0 }))).toBe(2);
    expect(calculateStageStars(value, performance({ turns: secondary, fallenHeroCount: 1, hpRatio: 1 }))).toBe(1);
    expect(calculateStageStars(value, performance({ turns: mastery, fallenHeroCount: 0, hpRatio: 0.55 }))).toBe(3);
    expect(calculateStageStars(value, performance({ turns: mastery, fallenHeroCount: 0, hpRatio: 0.549 }))).toBe(2);
    expect(calculateStageStars(value, performance({ turns: mastery + 1, fallenHeroCount: 0, hpRatio: 1 }))).toBe(2);
  });

  it("uses uninterrupted HIT thresholds and HP for seal stars", () => {
    const value = stage(OBJECTIVE_STAGE_IDS.seal);
    expect(calculateStageStars(value, performance({ bestCombo: 2, hpRatio: 1 }))).toBe(1);
    expect(calculateStageStars(value, performance({ bestCombo: 3, hpRatio: 0 }))).toBe(2);
    expect(calculateStageStars(value, performance({ bestCombo: 5, hpRatio: 0.599 }))).toBe(2);
    expect(calculateStageStars(value, performance({ bestCombo: 5, hpRatio: 0.6 }))).toBe(3);
  });

  it("keeps prop-only break-parts stars reachable through turns and HP", () => {
    const value = stage(OBJECTIVE_STAGE_IDS["break-parts"]);
    const secondary = speedLimit(value, 0.8);
    const mastery = speedLimit(value, 0.65);
    expect(calculateStageStars(value, performance({ turns: secondary, hpRatio: 0 }))).toBe(2);
    expect(calculateStageStars(value, performance({ turns: secondary + 1, hpRatio: 1 }))).toBe(1);
    expect(calculateStageStars(value, performance({ turns: mastery, hpRatio: 0.599 }))).toBe(2);
    expect(calculateStageStars(value, performance({ turns: mastery, hpRatio: 0.6 }))).toBe(3);
  });

  it("uses assembly speed, survival and HP without requiring nonexistent combat hits", () => {
    const value = stage(OBJECTIVE_STAGE_IDS.assemble);
    const secondary = speedLimit(value, 0.8);
    const mastery = speedLimit(value, 0.65);
    expect(calculateStageStars(value, performance({ turns: secondary }))).toBe(2);
    expect(calculateStageStars(value, performance({ turns: mastery, fallenHeroCount: 0, hpRatio: 0.699 }))).toBe(2);
    expect(calculateStageStars(value, performance({ turns: mastery, fallenHeroCount: 1, hpRatio: 1 }))).toBe(2);
    expect(calculateStageStars(value, performance({ turns: mastery, fallenHeroCount: 0, hpRatio: 0.7 }))).toBe(3);
  });
});
