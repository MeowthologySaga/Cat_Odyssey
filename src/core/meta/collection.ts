import {
  ENEMY_BY_ID,
  HEROES,
  RELICS,
  ROUTES,
  STAGE_BY_ID,
  STAGES,
  type DataEffect,
  type ElementId,
  type RicochetClass,
} from "../../data";
import type { GameSaveV1 } from "../../state";
import { getHeroXpProgress } from "./heroProgression";
import {
  getCampaignStarMilestoneProgress,
  type CampaignStarMilestoneProgress,
} from "./campaignStarMilestones";
import { getRelicProgress } from "./relics";
import { relicEffectLevelSummary } from "./relicEffectResolver";
import { SCYLLA_AFFINITY_MAX, STORM_WEEKLY_SCORE_KEY } from "./endgameLoop";
import {
  getOwnedTitleIds,
  TITLE_BY_ID,
  TITLE_CATALOG,
  titleDescription,
  titleDisplayName,
} from "./titles";

export interface HeroCollectionEntry {
  readonly id: string;
  readonly index: number;
  readonly owned: boolean;
  readonly visualKey: string;
  readonly name: string;
  readonly rarity?: number;
  readonly level?: number;
  readonly awakening?: number;
  readonly role?: string;
  readonly element?: string;
  readonly epithet?: string;
  readonly friendshipName?: string;
  readonly friendshipEffect?: string;
  readonly activeName?: string;
  readonly activeChargeTurns?: number;
  readonly activeEffect?: string;
}

export interface RelicCollectionEntry {
  readonly id: string;
  readonly index: number;
  readonly owned: boolean;
  readonly name: string;
  readonly tier?: number;
  readonly setName?: string;
  readonly level: number;
  readonly equipped: boolean;
  readonly effectSummary?: string;
}

export interface StageCollectionEntry {
  readonly id: string;
  readonly order: number;
  readonly name: string;
  readonly completed: boolean;
  readonly stars: number;
  readonly objective: string;
  readonly boss: boolean;
}

export interface RouteCollectionEntry {
  readonly id: string;
  readonly order: number;
  readonly unlocked: boolean;
  readonly name: string;
  readonly biome?: string;
  readonly signatureMechanic?: string;
  readonly completedStages: number;
  readonly totalStages: number;
  readonly stars: number;
  readonly maxStars: number;
  readonly completionPercent: number;
  readonly bossDefeated: boolean;
  readonly bossName?: string;
  readonly stages: readonly StageCollectionEntry[];
}

export interface VoyageCollectionSummary {
  readonly completedStages: number;
  readonly totalStages: number;
  readonly stars: number;
  readonly maxStars: number;
  readonly unlockedRoutes: number;
  readonly totalRoutes: number;
  readonly defeatedBossNames: readonly string[];
  readonly wins: number;
  readonly losses: number;
  readonly bestRicochetChain: number;
  readonly totalDamage: number;
  readonly lastPlayedAt: number;
  readonly oracleFloor: number;
  readonly weeklyStormRuns: number;
  readonly weeklyStormScore: number;
  readonly scyllaAffinity: number;
  readonly scyllaAffinityMax: number;
  readonly raidActive: boolean;
  readonly raidPhase: number;
  readonly campaignComplete: boolean;
  /** Pure progress view; claiming remains in campaign reward settlement. */
  readonly starMilestones: readonly CampaignStarMilestoneProgress[];
}

export interface TitleCollectionEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly unlockCondition: string;
  readonly owned: boolean;
  readonly selected: boolean;
}

const ROLE_LABELS: Readonly<Record<RicochetClass, string>> = Object.freeze({
  bounce: "반사형 · 벽 연계",
  pierce: "관통형 · 직선 돌파",
  heavy: "중량형 · 강한 충돌",
  burst: "폭발형 · 범위 피해",
  support: "지원형 · 회복과 제어",
});

const ELEMENT_LABELS: Readonly<Record<ElementId, string>> = Object.freeze({
  sea: "바다",
  sun: "태양",
  moon: "달",
  storm: "폭풍",
  earth: "대지",
  spirit: "영혼",
});

const RELIC_SET_LABELS: Readonly<Record<string, string>> = Object.freeze({
  homecoming: "귀향",
  "monster-hunt": "괴수 사냥",
  voyage: "대항해",
  divine: "신성",
});

const BIOME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "sunlit-island-and-storm-coast": "햇살 드는 섬과 폭풍 해안",
  "dreaming-lotus-garden": "꿈꾸는 로토스 정원",
  "cyclops-cave": "외눈박이 동굴",
  "floating-wind-palace-and-giant-harbor": "부유 바람 궁전과 거인 항구",
  "enchanted-aiaia-garden": "마법의 아이아이아 정원",
  "underworld-memory-river": "저승의 기억 강",
  "moonlit-siren-reef": "달빛 사이렌 암초",
  "black-cliff-strait": "검은 절벽 해협",
  "golden-solar-pasture": "황금빛 태양 목장",
  "ithacan-harbor-and-palace": "이타-캣 항구와 궁전",
});

const ROUTE_MECHANIC_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "moving-bumper-and-wave-current": "이동 범퍼 · 파도 해류",
  "slow-field-and-rescue": "감속장 · 선원 구조",
  "breakable-rock-and-rear-weakpoint": "파괴 암석 · 후방 약점",
  "wind-vector-and-moving-gates": "바람 벡터 · 이동 관문",
  "one-way-mirror-and-transformation": "일방 거울벽 · 변신",
  "paired-portals-and-spirit-walls": "쌍둥이 차원문 · 영혼벽",
  "rotating-sound-wave-bumper": "회전 음파 · 범퍼",
  "whirlpool-suction-and-multipart-break": "소용돌이 흡인 · 다중 부위 파괴",
  "forbidden-target-and-lightning-rod": "금지 표적 · 피뢰침",
  "directional-shields-and-twelve-axe-line": "방향 방패 · 열두 도끼선",
});

const SKILL_EFFECT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "nearest-barrage": "가까운 적 화살비",
  "line-pierce": "조준선 관통",
  "projectile-guard": "아군 투사체 방어",
  heal: "아군 회복",
  regeneration: "지속 회복",
  "chain-bounce": "연쇄 반사",
  "push-wave": "밀쳐내기 파동",
  "cross-slash": "교차 베기",
  "temporary-wall": "임시 벽 생성",
  "mark-weakpoint": "약점 표식",
  "wind-vector": "순풍 부여",
  "shrink-enemy": "적 축소",
  "telegraph-extend": "공격 예고 연장",
  "wall-phase": "벽 통과",
  "orbiting-blade": "태양륜",
  "follow-up-shot": "추격타",
  bind: "속박",
  "preview-extend": "예상선 연장",
  "weakpoint-multiplier": "약점 피해 증가",
  "ally-launch": "동료 추가 발사",
  "shield-break": "방패 파괴",
  stun: "기절",
  "reveal-weakpoint": "약점 노출",
  "countdown-delay": "적 공격 지연",
  cleanse: "약화 해제",
  "speed-up": "속도 증가",
  "temporary-bumper": "임시 범퍼",
  "velocity-multiplier": "발사 속도 증가",
  "damage-redirect": "피해 대신 받기",
  "afterimage-strikes": "잔상 연타",
  "mirror-clone": "궤적 분신",
  "radial-launch": "전방위 공격",
  revive: "동료 부활",
  "arena-beam": "표식 광선",
  "portal-pair": "차원문 설치",
  "trajectory-perfect": "완전 예상 궤적",
});

export function getHeroCollection(input: GameSaveV1): readonly HeroCollectionEntry[] {
  const owned = new Set(input.roster.ownedHeroIds);
  return HEROES.map((hero, index) => {
    if (!owned.has(hero.id)) {
      return {
        id: hero.id,
        index: index + 1,
        owned: false,
        visualKey: hero.visualKey,
        name: `미확인 선원 ${String(index + 1).padStart(2, "0")}`,
      };
    }
    const progress = getHeroXpProgress(input, hero.id);
    return {
      id: hero.id,
      index: index + 1,
      owned: true,
      visualKey: hero.visualKey,
      name: hero.name,
      rarity: hero.rarity,
      level: progress?.level ?? 1,
      awakening: progress?.awakening ?? 0,
      role: ROLE_LABELS[hero.ricochetClass],
      element: ELEMENT_LABELS[hero.element],
      epithet: hero.epithet,
      friendshipName: hero.friendshipSkill.name,
      friendshipEffect: formatSkillEffects(hero.friendshipSkill.effects),
      activeName: hero.activeSkill.name,
      activeChargeTurns: hero.activeSkill.chargeTurns,
      activeEffect: formatSkillEffects(hero.activeSkill.effects),
    };
  });
}

export function getRelicCollection(input: GameSaveV1): readonly RelicCollectionEntry[] {
  return RELICS.map((relic, index) => {
    const progress = getRelicProgress(input, relic.id)!;
    if (!progress.owned) {
      return {
        id: relic.id,
        index: index + 1,
        owned: false,
        name: `미확인 유물 ${String(index + 1).padStart(2, "0")}`,
        level: 0,
        equipped: false,
      };
    }
    return {
      id: relic.id,
      index: index + 1,
      owned: true,
      name: relic.name,
      tier: relic.tier,
      setName: RELIC_SET_LABELS[relic.set] ?? relic.set,
      level: progress.level,
      equipped: progress.equipped,
      effectSummary: relicEffectLevelSummary(relic, progress.level),
    };
  });
}

export function getRouteCollection(input: GameSaveV1): readonly RouteCollectionEntry[] {
  const completed = new Set(input.progress.completedStageIds);
  const unlocked = new Set(input.progress.unlockedRouteIds);
  return ROUTES.map((route) => {
    const isUnlocked = unlocked.has(route.id);
    const stages = route.stageIds.map((stageId) => {
      const stage = STAGE_BY_ID[stageId]!;
      const stars = clampInteger(input.progress.stageStars[stageId] ?? 0, 0, 3);
      return {
        id: stage.id,
        order: stage.order,
        name: isUnlocked ? stage.name : "미확인 해역",
        completed: completed.has(stageId),
        stars,
        objective: isUnlocked ? objectiveLabel(stage.objective.type) : "미공개",
        boss: Boolean(stage.boss),
      } satisfies StageCollectionEntry;
    });
    const bossStage = route.stageIds.map((id) => STAGE_BY_ID[id]).find(
      (stage) => stage?.boss?.bossId === route.bossId,
    );
    const bossDefeated = Boolean(bossStage && completed.has(bossStage.id));
    const completedStages = stages.filter((stage) => stage.completed).length;
    const stars = stages.reduce((sum, stage) => sum + stage.stars, 0);
    return {
      id: route.id,
      order: route.order,
      unlocked: isUnlocked,
      name: isUnlocked ? route.name : `미해금 항로 ${String(route.order).padStart(2, "0")}`,
      ...(isUnlocked ? {
        biome: BIOME_LABELS[route.biome] ?? route.biome.replaceAll("-", " "),
        signatureMechanic: ROUTE_MECHANIC_LABELS[route.signatureMechanic] ?? route.signatureMechanic.replaceAll("-", " "),
      } : {}),
      completedStages,
      totalStages: stages.length,
      stars,
      maxStars: stages.length * 3,
      completionPercent: Math.round(completedStages / Math.max(1, stages.length) * 100),
      bossDefeated,
      ...(bossDefeated ? { bossName: ENEMY_BY_ID[route.bossId]?.name ?? "항로 보스" } : {}),
      stages,
    };
  });
}

export function getVoyageCollectionSummary(input: GameSaveV1): VoyageCollectionSummary {
  const routes = getRouteCollection(input);
  return {
    completedStages: routes.reduce((sum, route) => sum + route.completedStages, 0),
    totalStages: STAGES.length,
    stars: routes.reduce((sum, route) => sum + route.stars, 0),
    maxStars: STAGES.length * 3,
    unlockedRoutes: routes.filter((route) => route.unlocked).length,
    totalRoutes: ROUTES.length,
    defeatedBossNames: routes.flatMap((route) => route.bossName ? [route.bossName] : []),
    wins: Math.max(0, Math.floor(input.records.wins)),
    losses: Math.max(0, Math.floor(input.records.losses)),
    bestRicochetChain: Math.max(0, Math.floor(input.records.bestRicochetChain)),
    totalDamage: Math.max(0, Math.floor(input.records.totalDamage)),
    lastPlayedAt: Math.max(0, Math.floor(input.records.lastPlayedAt)),
    oracleFloor: clampInteger(input.endgame.oracleTowerFloor, 0, 30),
    weeklyStormRuns: Math.max(0, Math.floor(input.endgame.weeklyStormRuns)),
    weeklyStormScore: Math.max(0, Math.floor(input.endgame.bossAffinity[STORM_WEEKLY_SCORE_KEY] ?? 0)),
    scyllaAffinity: clampInteger(input.endgame.bossAffinity["scylla-cat"] ?? 0, 0, SCYLLA_AFFINITY_MAX),
    scyllaAffinityMax: SCYLLA_AFFINITY_MAX,
    raidActive: input.endgame.scyllaRaid.active,
    raidPhase: input.endgame.scyllaRaid.active ? clampInteger(input.endgame.scyllaRaid.phaseIndex + 1, 1, 3) : 0,
    campaignComplete: input.progress.campaignComplete,
    starMilestones: getCampaignStarMilestoneProgress(input),
  };
}

export function getTitleCollection(input: GameSaveV1): readonly TitleCollectionEntry[] {
  const owned = new Set(getOwnedTitleIds(input));
  const ids = [...new Set([...TITLE_CATALOG.map((title) => title.id), ...owned])];
  return ids.map((id) => {
    const definition = TITLE_BY_ID[id];
    return {
      id,
      name: titleDisplayName(id) ?? id,
      description: titleDescription(id) ?? "특별한 항해 업적으로 얻은 칭호",
      unlockCondition: definition?.unlockCondition ?? "특별 항해 보상",
      owned: owned.has(id),
      selected: input.inventory.selectedTitleId === id,
    };
  });
}

export function formatCollectionLastPlayed(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "아직 항해 기록 없음";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "아직 항해 기록 없음";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function formatSkillEffects(effects: readonly DataEffect[]): string {
  return effects.map((effect) => {
    const value = effect.value === 0 ? "" : ` ${effect.value}`;
    const duration = effect.durationTurns ? ` · ${effect.durationTurns}턴` : "";
    return `${SKILL_EFFECT_LABELS[effect.kind] ?? effect.kind}${value}${duration}`;
  }).join(" · ");
}

function objectiveLabel(type: string): string {
  return ({
    "defeat-all": "모든 적 격파",
    "break-parts": "부위 파괴",
    assemble: "조립",
    survive: "생존",
    protect: "보호",
    seal: "봉인",
    escape: "탈출",
  } as Readonly<Record<string, string>>)[type] ?? type;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.floor(value) : minimum));
}
