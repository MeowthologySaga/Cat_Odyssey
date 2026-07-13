import type { StageDefinition } from "../data";

export interface StageStarPerformance {
  readonly turns: number;
  readonly hpRatio: number;
  readonly bestCombo: number;
  readonly fallenHeroCount: number;
}

export interface StageStarConditionSpec {
  readonly id: "clear" | "secondary" | "mastery";
  readonly label: string;
  readonly description: string;
  readonly isSatisfied: (performance: StageStarPerformance) => boolean;
}

type StageWithObjective = Pick<StageDefinition, "objective">;
type PerformanceCondition = Pick<StageStarConditionSpec, "description" | "isSatisfied">;

function declaredWorkFloor(stage: StageWithObjective): number {
  return Math.max(
    1,
    Math.round(stage.objective.requiredCount ?? stage.objective.targetIds.length),
  );
}

/** Never advertises fewer turns than the objective's declared target count. */
function speedTurnLimit(stage: StageWithObjective, ratio: number): number {
  return Math.min(
    stage.objective.turnLimit,
    Math.max(declaredWorkFloor(stage), Math.ceil(stage.objective.turnLimit * ratio)),
  );
}

function objectiveStarConditions(stage: StageWithObjective): {
  readonly secondary: PerformanceCondition;
  readonly mastery: PerformanceCondition;
} {
  const secondaryTurns = speedTurnLimit(stage, 0.8);
  const masteryTurns = speedTurnLimit(stage, 0.65);

  switch (stage.objective.type) {
    case "defeat-all":
      return {
        secondary: {
          description: `${secondaryTurns}턴 이내 승리`,
          isSatisfied: (performance) => performance.turns <= secondaryTurns,
        },
        mastery: {
          description: `${masteryTurns}턴 이내 · 최고 연쇄 4 HIT`,
          isSatisfied: (performance) => performance.turns <= masteryTurns && performance.bestCombo >= 4,
        },
      };
    case "survive":
      return {
        secondary: {
          description: "전투 불능 없이 생존",
          isSatisfied: (performance) => performance.fallenHeroCount === 0,
        },
        mastery: {
          description: "전투 불능 없이 · 남은 HP 65% 이상",
          isSatisfied: (performance) => performance.fallenHeroCount === 0 && performance.hpRatio >= 0.65,
        },
      };
    case "protect":
      return {
        secondary: {
          description: "전투 불능 없이 보호 완료",
          isSatisfied: (performance) => performance.fallenHeroCount === 0,
        },
        mastery: {
          description: "전투 불능 없이 · 남은 HP 75% 이상",
          isSatisfied: (performance) => performance.fallenHeroCount === 0 && performance.hpRatio >= 0.75,
        },
      };
    case "escape":
      return {
        secondary: {
          description: `${secondaryTurns}턴 이내 · 전원 생존 탈출`,
          isSatisfied: (performance) => performance.turns <= secondaryTurns && performance.fallenHeroCount === 0,
        },
        mastery: {
          description: `${masteryTurns}턴 이내 · 전원 생존 · 남은 HP 55% 이상`,
          isSatisfied: (performance) => performance.turns <= masteryTurns
            && performance.fallenHeroCount === 0
            && performance.hpRatio >= 0.55,
        },
      };
    case "seal":
      return {
        secondary: {
          description: "최고 연쇄 3 HIT 이상으로 봉인",
          isSatisfied: (performance) => performance.bestCombo >= 3,
        },
        mastery: {
          description: "최고 연쇄 5 HIT · 남은 HP 60% 이상",
          isSatisfied: (performance) => performance.bestCombo >= 5 && performance.hpRatio >= 0.6,
        },
      };
    case "break-parts":
      return {
        secondary: {
          description: `${secondaryTurns}턴 이내 목표 파괴`,
          isSatisfied: (performance) => performance.turns <= secondaryTurns,
        },
        mastery: {
          description: `${masteryTurns}턴 이내 · 남은 HP 60% 이상`,
          isSatisfied: (performance) => performance.turns <= masteryTurns && performance.hpRatio >= 0.6,
        },
      };
    case "assemble":
      return {
        secondary: {
          description: `${secondaryTurns}턴 이내 조립 완료`,
          isSatisfied: (performance) => performance.turns <= secondaryTurns,
        },
        mastery: {
          description: `${masteryTurns}턴 이내 · 전원 생존 · 남은 HP 70% 이상`,
          isSatisfied: (performance) => performance.turns <= masteryTurns
            && performance.fallenHeroCount === 0
            && performance.hpRatio >= 0.7,
        },
      };
  }
}

/** Single source used by both Route guidance and Reward settlement. */
export function stageStarConditionSpecs(stage: StageWithObjective): readonly StageStarConditionSpec[] {
  const conditions = objectiveStarConditions(stage);
  return [
    {
      id: "clear",
      label: "1성 · 스테이지 클리어",
      description: "스테이지 클리어",
      isSatisfied: () => true,
    },
    {
      id: "secondary",
      label: `2성 · ${conditions.secondary.description}`,
      ...conditions.secondary,
    },
    {
      id: "mastery",
      label: `3성 · ${conditions.mastery.description}`,
      ...conditions.mastery,
    },
  ];
}

export function calculateStageStars(
  stage: StageWithObjective,
  performance: StageStarPerformance,
): 1 | 2 | 3 {
  const [, secondary, mastery] = stageStarConditionSpecs(stage);
  // Stars are deliberately hierarchical. A mastery-looking statistic cannot
  // silently award the second star when its stated condition was missed.
  if (!secondary!.isSatisfied(performance)) return 1;
  return mastery!.isSatisfied(performance) ? 3 : 2;
}
