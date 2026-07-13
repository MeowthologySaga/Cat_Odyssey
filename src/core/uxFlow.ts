import { HERO_BY_ID, ROUTE_BY_ID, STAGES } from "../data";
import {
  STORY_INTERLUDE_BY_ID,
  STORY_INTERLUDE_MANIFEST,
  type StoryInterludeDefinition,
  type StoryInterludeTrigger,
} from "../data/cutscenes";
import type { GameSaveV1 } from "../state";
import { readRestorableCampaignBattle } from "./meta/campaignBattleResume";
import { readPendingCampaignVictorySettlement } from "./meta/campaignVictorySettlement";
import { readPendingEndgameVictorySettlement } from "./meta/endgameVictorySettlement";
import {
  battleRescueEndgameMode,
  readRestorableBattleRescue,
} from "./meta/battleRescue";
import { STORY_HERO_UNLOCKS_BY_STAGE } from "./meta/rewards";

const UX_PREFIX = "__ux:";
export const ONBOARDING_COMPLETE_MARKER = `${UX_PREFIX}onboarding-complete`;
export const FIRST_VOYAGE_STAGE_ID = "r01-s01";
const TUTORIAL_STEP_PREFIX = `${UX_PREFIX}tutorial-step:`;
const TUTORIAL_COACHMARK_PREFIX = `${UX_PREFIX}tutorial-coach:`;

export type OnboardingPrepStepId = "launch" | "cancel";
export type TutorialCoachmarkId = "first-aim" | "first-ricochet" | "first-ally-contact";

export interface OnboardingPrepStep {
  readonly id: OnboardingPrepStepId;
  readonly title: string;
  readonly summary: string;
  readonly detail: string;
  readonly inputHint: string;
}

export interface TutorialCoachmarkContent {
  readonly title: string;
  readonly body: string;
  readonly inputHint?: string;
}

export interface CombatHelpCard {
  readonly title: string;
  readonly body: string;
}

export const ONBOARDING_PREP_STEPS: readonly OnboardingPrepStep[] = Object.freeze([
  {
    id: "launch",
    title: "뒤로 당겨 발사",
    summary: "고양이를 발사 반대 방향으로 당긴 뒤 놓으세요.",
    detail: "잡은 채 좌우 검은 여백이나 게임 창 밖으로 나가도 조준은 계속 이어집니다.",
    inputHint: "마우스·터치 · 누른 채 당기고 놓기",
  },
  {
    id: "cancel",
    title: "조준은 바로 취소",
    summary: "잘못 당겼다면 발사하기 전에 취소하고 다시 잡으세요.",
    detail: "마우스는 드래그 중 우클릭, 키보드는 Esc, 터치는 다른 손가락으로 한 번 탭합니다.",
    inputHint: "우클릭 · Esc · 두 번째 손가락 탭",
  },
]);

export const TUTORIAL_COACHMARK_CONTENT: Readonly<Record<TutorialCoachmarkId, TutorialCoachmarkContent>> = Object.freeze({
  "first-aim": {
    title: "첫 조준",
    body: "뒤로 당긴 만큼 힘이 커집니다. 예상선은 정답 전체가 아니라 첫 반사까지만 보여 줍니다.",
    inputHint: "창 밖까지 당겨도 유지 · 우클릭 / Esc / 두 번째 손가락 탭으로 취소",
  },
  "first-ricochet": {
    title: "첫 반사",
    body: "벽에 닿은 각도만큼 반사됩니다. 정면이 막혔다면 벽을 경유해 옆이나 뒤를 노리세요.",
  },
  "first-ally-contact": {
    title: "첫 우정 연계",
    body: "날아가는 고양이가 동료에게 닿으면 그 동료의 우정 스킬이 한 번 발동합니다.",
  },
});

export const COMBAT_HELP_CARDS: readonly CombatHelpCard[] = Object.freeze([
  { title: "우정 스킬", body: "아군을 경유하면 접촉한 동료의 회복·연쇄탄·관통 등 고유 효과가 발동합니다." },
  { title: "적 예고와 방패", body: "카운트다운과 붉은 범위를 먼저 읽고, 방패 적은 벽 반사로 옆이나 뒤를 노리세요." },
  { title: "해역 기믹", body: "지형마다 작동 대상이 다릅니다. 일부 장애물은 적도 막거나 피해를 주며, 위험 표식은 선원에게 적용됩니다." },
  { title: "스테이지 목표", body: "격파 외에도 부위 파괴·생존·보호·봉인·탈출이 있으니 하단 목표를 확인하세요." },
]);

export interface StoryCardContent {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: readonly string[];
  readonly accent: number;
}

export interface PendingCrewJoin {
  readonly stageId: string;
  readonly heroId: string;
}

export interface SceneDestination {
  readonly sceneKey: string;
  readonly data?: Record<string, unknown>;
}

export function hasCompletedOnboarding(save: GameSaveV1): boolean {
  return save.inventory.skinIds.includes(ONBOARDING_COMPLETE_MARKER);
}

export function readTutorialStep(save: GameSaveV1): number {
  const marker = save.inventory.skinIds.find((id) => id.startsWith(TUTORIAL_STEP_PREFIX));
  const parsed = Number(marker?.slice(TUTORIAL_STEP_PREFIX.length) ?? 0);
  return Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
}

export function writeTutorialStep(save: GameSaveV1, step: number): void {
  save.inventory.skinIds = save.inventory.skinIds.filter((id) => !id.startsWith(TUTORIAL_STEP_PREFIX));
  save.inventory.skinIds.push(`${TUTORIAL_STEP_PREFIX}${Math.max(0, Math.floor(step))}`);
}

export function completeOnboarding(save: GameSaveV1): void {
  save.inventory.skinIds = save.inventory.skinIds.filter((id) => !id.startsWith(TUTORIAL_STEP_PREFIX));
  if (!save.inventory.skinIds.includes(ONBOARDING_COMPLETE_MARKER)) {
    save.inventory.skinIds.push(ONBOARDING_COMPLETE_MARKER);
  }
}

export function tutorialCoachmarkMarker(id: TutorialCoachmarkId): string {
  return `${TUTORIAL_COACHMARK_PREFIX}${id}`;
}

export function hasSeenTutorialCoachmark(save: GameSaveV1, id: TutorialCoachmarkId): boolean {
  return save.inventory.skinIds.includes(tutorialCoachmarkMarker(id));
}

/** Returns true only for the first successful claim, so Scene overlays cannot repeat. */
export function markTutorialCoachmarkSeen(save: GameSaveV1, id: TutorialCoachmarkId): boolean {
  const marker = tutorialCoachmarkMarker(id);
  if (save.inventory.skinIds.includes(marker)) return false;
  save.inventory.skinIds.push(marker);
  return true;
}

export interface TutorialCoachmarkContext {
  readonly stageId: string;
  readonly modifierIds: readonly string[];
  readonly partySize: number;
}

export function shouldOfferTutorialCoachmark(
  save: GameSaveV1,
  id: TutorialCoachmarkId,
  context: TutorialCoachmarkContext,
): boolean {
  if (!hasCompletedOnboarding(save) || hasSeenTutorialCoachmark(save, id)) return false;
  if (id === "first-ally-contact") return context.partySize >= 2;
  return context.stageId === FIRST_VOYAGE_STAGE_ID && context.modifierIds.includes("tutorial:direct-hit");
}

export function resolveOnboardingExitDestination(options: {
  readonly replay?: boolean;
  readonly returnScene?: string;
  readonly returnData?: Record<string, unknown>;
  readonly save?: GameSaveV1;
} = {}): SceneDestination {
  if (options.replay) {
    return {
      sceneKey: options.returnScene ?? "Harbor",
      ...(options.returnData ? { data: options.returnData } : {}),
    };
  }
  return options.save
    ? resolveRoutePreludeDestination(
      options.save,
      "route-01-ogygia",
      "Party",
      { stageId: FIRST_VOYAGE_STAGE_ID },
    )
    : { sceneKey: "Party", data: { stageId: FIRST_VOYAGE_STAGE_ID } };
}

/** Victory, then paid rescue, then an ordinary checkpoint: no recoverable run is hidden. */
export function resolvePendingVoyageRecoveryDestination(
  save: GameSaveV1,
): SceneDestination | undefined {
  const pendingEndgameVictory = readPendingEndgameVictorySettlement(save);
  if (pendingEndgameVictory) {
    return {
      sceneKey: "Reward",
      data: {
        stageId: pendingEndgameVictory.stageId,
        turns: pendingEndgameVictory.turns,
        bestCombo: pendingEndgameVictory.bestCombo,
        totalDamage: pendingEndgameVictory.totalDamage,
        hpRatio: pendingEndgameVictory.hpRatio,
        partyHeroIds: [...pendingEndgameVictory.partyHeroIds],
        fallenHeroIds: [...pendingEndgameVictory.fallenHeroIds],
        weeklyScoreEnabled: pendingEndgameVictory.weeklyScoreEnabled,
        endgameMode: pendingEndgameVictory.mode,
      },
    };
  }
  const pendingVictory = readPendingCampaignVictorySettlement(save);
  if (pendingVictory) {
    return {
      sceneKey: "Reward",
      data: {
        stageId: pendingVictory.stageId,
        turns: pendingVictory.turns,
        bestCombo: pendingVictory.bestCombo,
        totalDamage: pendingVictory.totalDamage,
        hpRatio: pendingVictory.hpRatio,
        partyHeroIds: [...pendingVictory.partyHeroIds],
        fallenHeroIds: [...pendingVictory.fallenHeroIds],
      },
    };
  }
  const pendingRescue = readRestorableBattleRescue(save);
  if (pendingRescue) {
    const endgameMode = battleRescueEndgameMode(pendingRescue.rescue.mode);
    return {
      sceneKey: "Battle",
      data: {
        stageId: pendingRescue.rescue.stageId,
        resumeRescue: true,
        ...(endgameMode ? { endgameMode } : {}),
      },
    };
  }
  const activeBattle = readRestorableCampaignBattle(save);
  if (activeBattle) {
    return {
      sceneKey: "Battle",
      data: { stageId: activeBattle.checkpoint.stageId, resumeCampaign: true },
    };
  }
  return undefined;
}

/** Title settles or resumes recoverable battles before normal navigation. */
export function resolveTitleVoyageDestination(save: GameSaveV1): SceneDestination {
  const recovery = resolvePendingVoyageRecoveryDestination(save);
  if (recovery) return recovery;
  if (!hasCompletedOnboarding(save)) {
    return { sceneKey: "Tutorial", data: { returnScene: "Harbor" } };
  }
  if (!save.progress.completedStageIds.includes(FIRST_VOYAGE_STAGE_ID)) {
    return resolveRoutePreludeDestination(
      save,
      "route-01-ogygia",
      "Party",
      { stageId: FIRST_VOYAGE_STAGE_ID },
    );
  }
  return resolveRoutePreludeDestination(save, "route-01-ogygia", "Harbor");
}

export function routeStoryMarker(routeId: string): string {
  return `${UX_PREFIX}story-route:${routeId}`;
}

export function crewJoinMarker(heroId: string): string {
  return `${UX_PREFIX}crew-join:${heroId}`;
}

export function hasSeenRouteStory(save: GameSaveV1, routeId: string): boolean {
  return save.inventory.skinIds.includes(routeStoryMarker(routeId));
}

export function markRouteStorySeen(save: GameSaveV1, routeId: string): void {
  const marker = routeStoryMarker(routeId);
  if (!save.inventory.skinIds.includes(marker)) save.inventory.skinIds.push(marker);
}

/**
 * One route-prelude gate is shared by Title, Tutorial and the route map. This
 * prevents direct-entry paths from silently bypassing the canon card.
 */
export function resolveRoutePreludeDestination(
  save: GameSaveV1,
  routeId: string,
  sceneKey: string,
  data?: Record<string, unknown>,
): SceneDestination {
  if (hasSeenRouteStory(save, routeId)) {
    return { sceneKey, ...(data ? { data } : {}) };
  }
  return {
    sceneKey: "Story",
    data: {
      kind: "route",
      routeId,
      returnScene: sceneKey,
      ...(data ? { returnData: data } : {}),
    },
  };
}

export function markCrewJoinSeen(save: GameSaveV1, heroId: string): void {
  const marker = crewJoinMarker(heroId);
  if (!save.inventory.skinIds.includes(marker)) save.inventory.skinIds.push(marker);
}

function storyInterludeTriggerMatches(
  authored: StoryInterludeTrigger,
  requested: StoryInterludeTrigger,
): boolean {
  if (authored.kind !== requested.kind || authored.timing !== requested.timing) return false;
  if (authored.kind === "stage" && requested.kind === "stage") return authored.stageId === requested.stageId;
  if (authored.kind === "route" && requested.kind === "route") return authored.routeId === requested.routeId;
  return false;
}

/** Resolve every unseen canon card for a transition, in authored order. */
export function resolveTriggeredStoryInterludes(
  save: GameSaveV1,
  trigger: StoryInterludeTrigger,
  options: { readonly replay?: boolean } = {},
): readonly StoryInterludeDefinition[] {
  return STORY_INTERLUDE_MANIFEST.filter((interlude) => (
    storyInterludeTriggerMatches(interlude.trigger, trigger)
    && (options.replay || !hasSeenRouteStory(save, interlude.id))
  ));
}

export function resolveTriggeredStoryInterlude(
  save: GameSaveV1,
  trigger: StoryInterludeTrigger,
  options: { readonly replay?: boolean } = {},
): StoryInterludeDefinition | undefined {
  return resolveTriggeredStoryInterludes(save, trigger, options)[0];
}

/**
 * Existing StoryScene can render an interlude without a new scene kind: its
 * stable interlude id is used as the route-card key and therefore as the seen
 * marker. Reward/Party callers only need to route through this helper.
 */
export function resolveStoryInterludeDestination(
  save: GameSaveV1,
  trigger: StoryInterludeTrigger,
  sceneKey: string,
  data?: Record<string, unknown>,
): SceneDestination {
  const interlude = resolveTriggeredStoryInterlude(save, trigger);
  if (!interlude) return { sceneKey, ...(data ? { data } : {}) };
  return {
    sceneKey: "Story",
    data: {
      kind: "route",
      routeId: interlude.id,
      returnScene: sceneKey,
      ...(data ? { returnData: data } : {}),
    },
  };
}

export function findPendingCrewJoin(save: GameSaveV1): PendingCrewJoin | undefined {
  for (const stage of STAGES) {
    if (!save.progress.completedStageIds.includes(stage.id)) continue;
    const firstClearHeroId = stage.rewards.firstClear.kind === "hero"
      ? stage.rewards.firstClear.id
      : undefined;
    const canonicalHeroIds = [...new Set([
      ...(firstClearHeroId ? [firstClearHeroId] : []),
      ...(STORY_HERO_UNLOCKS_BY_STAGE[stage.id] ?? []),
    ])];
    for (const heroId of canonicalHeroIds) {
      if (save.roster.ownedHeroIds.includes(heroId) && !save.inventory.skinIds.includes(crewJoinMarker(heroId))) {
        return { stageId: stage.id, heroId };
      }
    }
  }
  return undefined;
}

/**
 * Route a campaign continuation through the earliest unseen crew card. The
 * Story scene keeps the supplied destination so several joins from one stage
 * can be presented in canonical order before play continues.
 */
export function resolveCrewJoinDestination(
  save: GameSaveV1,
  sceneKey: string,
  data?: Record<string, unknown>,
): SceneDestination {
  const pending = findPendingCrewJoin(save);
  if (!pending) return { sceneKey, ...(data ? { data } : {}) };
  return {
    sceneKey: "Story",
    data: {
      kind: "crew",
      heroId: pending.heroId,
      returnScene: sceneKey,
      ...(data ? { returnData: data } : {}),
    },
  };
}

export function routeStoryContent(routeId: string): StoryCardContent {
  const route = ROUTE_BY_ID[routeId];
  const directInterlude = STORY_INTERLUDE_BY_ID[routeId];
  const routePrelude = STORY_INTERLUDE_MANIFEST.find((interlude) => (
    interlude.trigger.kind === "route"
    && interlude.trigger.timing === "prelude"
    && interlude.trigger.routeId === routeId
  ));
  const interlude = directInterlude ?? routePrelude;
  if (interlude) {
    return {
      eyebrow: interlude.eyebrow,
      title: interlude.title,
      body: interlude.body,
      accent: interlude.accent,
    };
  }
  const authored: Readonly<Record<string, readonly string[]>> = {
    "route-01-ogygia": ["폭풍 뒤의 섬, 오기기아에서 귀향의 돛이 다시 오른다.", "먀디세우스는 홀로 이타카로 향할 첫 별을 찾는다."],
    "route-02-lotus": ["파이아키아에서 시작된 회상은 과거 선원들과 연꽃 해역으로 돌아간다.", "잠든 선원을 깨우면 옛 동료들이 다시 승선하고, 그 뒤 나우시-캣과의 인연도 이어진다."],
    "route-03-cyclops": ["외눈 거인의 동굴은 정면 공격을 비웃는다.", "벽을 타고 후방으로 돌아가 눈과 갑옷의 틈을 노려라."],
    "route-04-aeolus": ["뮤-올로스의 바람은 매 턴 궤적을 새로 쓴다.", "힘보다 방향을 읽는 선장만이 바람 주머니를 지킬 수 있다."],
    "route-05-circe": ["퍼-씨의 궁전에서는 벽도, 몸집도, 편도 계속 바뀐다.", "상태 효과와 일방 반사벽을 이용해 변신의 덫을 역이용하라."],
    "route-06-underworld": ["저승의 벽은 산 자의 눈에 완전히 보이지 않는다.", "기억의 불꽃을 지키며 영체의 길을 따라 예언을 만나야 한다."],
    "route-07-sirens": ["노래는 파동이 되어 동굴 전체를 덮친다.", "울림의 순서를 끊고 커지는 위험 반경을 피해 나아가라."],
    "route-08-strait": ["스킬라의 여섯 머리와 카리브디스의 소용돌이가 길을 가른다.", "부위를 차례로 파괴해 안전 항로를 직접 만들어야 한다."],
    "route-09-thrinacia": ["태양의 섬에는 번개와 금지된 소가 기다린다.", "욕심을 억누르고 청동 벽으로 낙뢰를 흘려보내라."],
    "route-10-ithaca": ["마침내 이타카. 그러나 귀향의 마지막 벽은 왕궁 안에 있다.", "모든 동료와 쌓은 연계를 한 발의 완벽한 궤적으로 증명하라."],
  };
  return {
    eyebrow: `항로 ${String(route?.order ?? 1).padStart(2, "0")} · 항해 서장`,
    title: route?.name ?? "새로운 항로",
    body: authored[routeId] ?? [route?.originalBeat ?? "새로운 바다가 귀향선을 부른다."],
    accent: route?.coreRoute ? 0xd8a94a : 0x73d7cf,
  };
}

export function crewJoinContent(heroId: string): StoryCardContent {
  const hero = HERO_BY_ID[heroId];
  return {
    eyebrow: "새로운 동료 · 승선",
    title: hero?.name ?? heroId,
    body: [
      hero ? `${hero.epithet}, ${hero.name}이(가) 아르고냥의 항해에 합류했다.` : "새로운 동료가 합류했다.",
      hero ? `${hero.friendshipSkill.name} · 아군이 이 동료와 접촉하면 즉시 발동한다.` : "편성 화면에서 능력을 확인할 수 있다.",
    ],
    accent: 0xe0b85d,
  };
}
