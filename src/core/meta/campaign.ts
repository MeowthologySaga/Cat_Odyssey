import { ROUTES, ROUTE_BY_ID, STAGES, STAGE_BY_ID } from "../../data";
import type { GameSaveV1 } from "../../state/saveSchema";
import {
  assertNoWalletState,
  normalizeMetaSave,
  readStageStars,
  writeStageStars,
} from "./compat";
import type { CampaignRouteView, CampaignStageView, MetaFailure } from "./types";

export interface CompleteStageInput {
  readonly stageId: string;
  readonly stars: number;
}

export interface CompleteStageSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly stageId: string;
  readonly stars: 1 | 2 | 3;
  readonly firstCompletion: boolean;
  readonly newlyUnlockedRouteIds: readonly string[];
  readonly campaignCompletedNow: boolean;
}

export type CompleteStageResult = CompleteStageSuccess | MetaFailure;

export function isStageUnlocked(input: GameSaveV1, stageId: string): boolean {
  const save = normalizeMetaSave(input);
  const stage = STAGE_BY_ID[stageId];
  if (!stage || !save.progress.unlockedRouteIds.includes(stage.routeId)) return false;
  const route = ROUTE_BY_ID[stage.routeId];
  if (!route) return false;
  const stageIndex = route.stageIds.indexOf(stageId);
  if (stageIndex <= 0) return stageIndex === 0;
  const previousStageId = route.stageIds[stageIndex - 1];
  return previousStageId !== undefined && save.progress.completedStageIds.includes(previousStageId);
}

export function getStageView(input: GameSaveV1, stageId: string): CampaignStageView | undefined {
  const save = normalizeMetaSave(input);
  const stage = STAGE_BY_ID[stageId];
  if (!stage) return undefined;
  return {
    stageId,
    routeId: stage.routeId,
    unlocked: isStageUnlocked(save, stageId),
    completed: save.progress.completedStageIds.includes(stageId),
    stars: readStageStars(save, stageId),
  };
}

export function getCampaignStageViews(input: GameSaveV1): readonly CampaignStageView[] {
  return STAGES.map((stage) => getStageView(input, stage.id)).filter(
    (stage): stage is CampaignStageView => Boolean(stage),
  );
}

export function getRouteView(input: GameSaveV1, routeId: string): CampaignRouteView | undefined {
  const save = normalizeMetaSave(input);
  const route = ROUTE_BY_ID[routeId];
  if (!route) return undefined;
  const completedStages = route.stageIds.filter((stageId) =>
    save.progress.completedStageIds.includes(stageId),
  ).length;
  return {
    routeId,
    unlocked: save.progress.unlockedRouteIds.includes(routeId),
    completedStages,
    stageCount: route.stageIds.length,
    stars: route.stageIds.reduce((total, stageId) => total + readStageStars(save, stageId), 0),
    completed: completedStages === route.stageIds.length,
  };
}

export function getCampaignRouteViews(input: GameSaveV1): readonly CampaignRouteView[] {
  return ROUTES.map((route) => getRouteView(input, route.id)).filter(
    (route): route is CampaignRouteView => Boolean(route),
  );
}

export function getTotalCampaignStars(input: GameSaveV1): number {
  const save = normalizeMetaSave(input);
  return STAGES.reduce((total, stage) => total + readStageStars(save, stage.id), 0);
}

export function completeCampaignStage(
  input: GameSaveV1,
  completion: CompleteStageInput,
): CompleteStageResult {
  const save = normalizeMetaSave(input);
  const stage = STAGE_BY_ID[completion.stageId];
  if (!stage) return failure(save, "unknown_stage", `Unknown stage: ${completion.stageId}`);
  if (!isStageUnlocked(save, stage.id)) {
    return failure(save, "stage_locked", `Stage is locked: ${stage.id}`);
  }

  const requestedStars = Number.isFinite(completion.stars) ? Math.floor(completion.stars) : 1;
  const stars = Math.min(3, Math.max(1, requestedStars)) as 1 | 2 | 3;
  const firstCompletion = !save.progress.completedStageIds.includes(stage.id);
  if (firstCompletion) save.progress.completedStageIds.push(stage.id);
  writeStageStars(save, stage.id, Math.max(readStageStars(save, stage.id), stars));
  save.records.wins += 1;

  const newlyUnlockedRouteIds: string[] = [];
  const route = ROUTE_BY_ID[stage.routeId];
  const routeCompleted = route?.stageIds.every((stageId) =>
    save.progress.completedStageIds.includes(stageId),
  );
  if (route && routeCompleted) {
    const routeIndex = ROUTES.findIndex((candidate) => candidate.id === route.id);
    const nextRoute = ROUTES[routeIndex + 1];
    if (nextRoute && !save.progress.unlockedRouteIds.includes(nextRoute.id)) {
      save.progress.unlockedRouteIds.push(nextRoute.id);
      newlyUnlockedRouteIds.push(nextRoute.id);
      save.progress.activeRouteId = nextRoute.id;
    }
  }

  const wasCampaignComplete = save.progress.campaignComplete;
  save.progress.campaignComplete = STAGES.every((candidate) =>
    save.progress.completedStageIds.includes(candidate.id),
  );
  if (!save.progress.campaignComplete && !newlyUnlockedRouteIds.length) {
    save.progress.activeRouteId = stage.routeId;
  }
  assertNoWalletState(save);

  return {
    ok: true,
    save,
    stageId: stage.id,
    stars: readStageStars(save, stage.id) as 1 | 2 | 3,
    firstCompletion,
    newlyUnlockedRouteIds,
    campaignCompletedNow: !wasCampaignComplete && save.progress.campaignComplete,
  };
}

function failure(save: GameSaveV1, code: MetaFailure["code"], message: string): MetaFailure {
  return { ok: false, code, message, save };
}
