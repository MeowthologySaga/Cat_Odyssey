import type { StageDefinition } from "../data";
import { stageStarConditionSpecs } from "./stageStarRules";

export function stageStarsText(stars: number): string {
  const count = Math.max(0, Math.min(3, Math.floor(stars)));
  return `${"★".repeat(count)}${"☆".repeat(3 - count)}`;
}

export function stageStarConditions(stage: Pick<StageDefinition, "objective">): readonly string[] {
  return stageStarConditionSpecs(stage).map((condition) => condition.label);
}

export function nextStarReplayTarget(stars: number, stage: Pick<StageDefinition, "objective">): string {
  const conditions = stageStarConditionSpecs(stage);
  const earned = Math.max(0, Math.min(3, Math.floor(stars)));
  if (earned === 0) return "첫 클리어로 1성을 획득하세요";
  if (earned === 1) return `${conditions[1]!.description} 조건으로 2성에 도전하세요`;
  if (earned === 2) return `${conditions[2]!.description} 조건으로 3성에 도전하세요`;
  return "3성 달성 · 기록 단축과 연쇄 갱신에 도전하세요";
}

export function lockedStageMessage(
  routeOrder: number,
  routeUnlocked: boolean,
  previousStageName?: string,
): string {
  if (!routeUnlocked) {
    return routeOrder <= 1
      ? "항로 이야기를 먼저 확인하세요."
      : `먼저 항로 ${String(routeOrder - 1).padStart(2, "0")}의 마지막 스테이지를 클리어하세요.`;
  }
  return previousStageName
    ? `먼저 ‘${previousStageName}’ 스테이지를 클리어하세요.`
    : "앞 스테이지를 먼저 클리어하세요.";
}
