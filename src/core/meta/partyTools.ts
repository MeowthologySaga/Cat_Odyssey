import {
  ENEMY_BY_ID,
  HEROES,
  HERO_BY_ID,
  type ElementId,
  type HeroDefinition,
  type RicochetClass,
  type StageDefinition,
} from "../../data";
import type { GameSaveV1 } from "../../state/saveSchema";
import { assertNoWalletState, normalizeMetaSave, readHeroLevel } from "./compat";
import { CAMPAIGN_PARTY_MAX_SIZE } from "./constants";
import { getPartyCombatPower } from "./heroProgression";

export type PartyRoleFilter = "all" | RicochetClass;
export type PartyElementFilter = "all" | ElementId;
export type PartyLevelFilter = "all" | "1-10" | "11-30" | "31-60";
export type PartySortMode = "power" | "level" | "rarity" | "name";
export type PartyRecommendationSize = 1 | 2 | 3;

export interface PartyRestrictions {
  readonly lockedHeroIds?: readonly string[];
  readonly forbiddenClasses?: readonly RicochetClass[];
}

export interface PartyRosterQuery {
  readonly role: PartyRoleFilter;
  readonly element: PartyElementFilter;
  readonly level: PartyLevelFilter;
  readonly sort: PartySortMode;
}

export interface PartyPowerAssessment {
  readonly currentPower: number;
  readonly recommendedPower?: number;
  readonly deficit: number;
  readonly ratio?: number;
  readonly level: "unrated" | "ready" | "caution" | "danger";
  readonly label: string;
}

export interface PartyRecommendation {
  readonly heroIds: readonly string[];
  readonly requestedSize: PartyRecommendationSize;
  readonly score: number;
  readonly assessment: PartyPowerAssessment;
  readonly reasons: readonly string[];
}

/**
 * Authored stage power is the three-hero benchmark. The party screen scales
 * that benchmark for an intentionally smaller sortie without changing enemy
 * HP, damage, rewards, or any other combat rule.
 */
export function recommendedPowerForPartySize(
  authoredRecommendedPower: number | undefined,
  partySize: number,
): number | undefined {
  if (!authoredRecommendedPower || authoredRecommendedPower <= 0) return undefined;
  const safePartySize = Math.min(
    CAMPAIGN_PARTY_MAX_SIZE,
    Math.max(1, Math.floor(Number.isFinite(partySize) ? partySize : 1)),
  );
  return Math.max(1, Math.round(authoredRecommendedPower * safePartySize / CAMPAIGN_PARTY_MAX_SIZE));
}

interface ScoredParty {
  readonly heroIds: readonly string[];
  readonly score: number;
  readonly roleScore: number;
  readonly riskScore: number;
  readonly diversityScore: number;
}

const OBJECTIVE_ROLE_WEIGHT: Readonly<Record<StageDefinition["objective"]["type"], Readonly<Record<RicochetClass, number>>>> = {
  "defeat-all": { bounce: 11, pierce: 7, heavy: 5, burst: 13, support: 6 },
  "break-parts": { bounce: 5, pierce: 17, heavy: 12, burst: 15, support: 5 },
  assemble: { bounce: 13, pierce: 9, heavy: 5, burst: 4, support: 9 },
  survive: { bounce: 5, pierce: 5, heavy: 15, burst: 4, support: 18 },
  protect: { bounce: 5, pierce: 6, heavy: 16, burst: 4, support: 20 },
  seal: { bounce: 7, pierce: 15, heavy: 8, burst: 13, support: 10 },
  escape: { bounce: 15, pierce: 12, heavy: 4, burst: 6, support: 9 },
};

const OBJECTIVE_REASON: Readonly<Record<StageDefinition["objective"]["type"], string>> = {
  "defeat-all": "적 전멸에 유리한 연쇄·광역 역할을 우선했습니다.",
  "break-parts": "부위 파괴에 맞춰 관통·폭발 역할을 우선했습니다.",
  assemble: "조립 목표에 맞춰 기동·반사 역할을 우선했습니다.",
  survive: "생존 목표에 맞춰 방어·지원 역할을 우선했습니다.",
  protect: "보호 목표에 맞춰 방어·회복 역할을 우선했습니다.",
  seal: "봉인 목표에 맞춰 관통·집중 공격 역할을 우선했습니다.",
  escape: "탈출 목표에 맞춰 속도·기동 역할을 우선했습니다.",
};

/** Owned roster filtering/sorting. Restrictions stay visible in the roster and are enforced at selection time. */
export function queryOwnedHeroes(
  input: GameSaveV1,
  query: PartyRosterQuery,
): readonly HeroDefinition[] {
  const save = normalizeMetaSave(input);
  const powerById = new Map<string, number>();
  const heroes = HEROES.filter((hero) => save.roster.ownedHeroIds.includes(hero.id))
    .filter((hero) => query.role === "all" || hero.ricochetClass === query.role)
    .filter((hero) => query.element === "all" || hero.element === query.element)
    .filter((hero) => matchesLevelFilter(readHeroLevel(save, hero.id), query.level));

  return [...heroes].sort((a, b) => {
    let difference = 0;
    if (query.sort === "power") {
      const aPower = powerById.get(a.id) ?? getPartyCombatPower(save, [a.id]);
      const bPower = powerById.get(b.id) ?? getPartyCombatPower(save, [b.id]);
      powerById.set(a.id, aPower);
      powerById.set(b.id, bPower);
      difference = bPower - aPower;
    } else if (query.sort === "level") {
      difference = readHeroLevel(save, b.id) - readHeroLevel(save, a.id);
    } else if (query.sort === "rarity") {
      difference = b.rarity - a.rarity;
    } else {
      difference = a.name.localeCompare(b.name, "ko");
    }
    return difference || b.rarity - a.rarity || a.name.localeCompare(b.name, "ko");
  });
}

export function assessPartyPower(
  input: GameSaveV1,
  heroIds: readonly string[],
  recommendedPower?: number,
): PartyPowerAssessment {
  const currentPower = getPartyCombatPower(input, heroIds);
  if (!recommendedPower || recommendedPower <= 0) {
    return { currentPower, deficit: 0, level: "unrated", label: "권장 전투력 정보 없음" };
  }
  const ratio = currentPower / recommendedPower;
  const deficit = Math.max(0, recommendedPower - currentPower);
  if (ratio >= 1) {
    return {
      currentPower,
      recommendedPower,
      deficit,
      ratio,
      level: "ready",
      label: `권장 전투력 충족 · +${(currentPower - recommendedPower).toLocaleString()}`,
    };
  }
  const level = ratio >= 0.8 ? "caution" : "danger";
  return {
    currentPower,
    recommendedPower,
    deficit,
    ratio,
    level,
    label: `${level === "danger" ? "고위험" : "주의"} · 권장보다 ${deficit.toLocaleString()} 부족`,
  };
}

/** Exhaustively scores at most 560 three-hero combinations, keeping recommendation deterministic. */
export function recommendParty(
  input: GameSaveV1,
  stage: StageDefinition,
  requestedSize: PartyRecommendationSize,
  restrictions: PartyRestrictions = {},
  recommendedPower = stage.recommendedPower,
): PartyRecommendation {
  const save = normalizeMetaSave(input);
  const locked = new Set(restrictions.lockedHeroIds ?? []);
  const forbidden = new Set(restrictions.forbiddenClasses ?? []);
  const eligible = HEROES.filter((hero) => save.roster.ownedHeroIds.includes(hero.id))
    .filter((hero) => !locked.has(hero.id) && !forbidden.has(hero.ricochetClass));
  const size = Math.min(requestedSize, eligible.length);
  const partySizeRecommendedPower = recommendedPowerForPartySize(recommendedPower, Math.max(1, size))
    ?? recommendedPower;
  if (size === 0) {
    return {
      heroIds: [], requestedSize, score: 0,
      assessment: assessPartyPower(save, [], partySizeRecommendedPower),
      reasons: ["현재 도전 규칙에 맞는 보유 영웅이 없습니다.", "잠금·금지 역할을 확인하세요."],
    };
  }

  const enemyProfile = buildEnemyProfile(stage);
  const powerByHeroId = new Map(eligible.map((hero) => [
    hero.id,
    getPartyCombatPower(save, [hero.id]),
  ] as const));
  const scored = combinations(eligible, size).map((party) => scoreParty(
    party,
    stage,
    enemyProfile,
    partySizeRecommendedPower,
    powerByHeroId,
  ));
  scored.sort((a, b) => b.score - a.score || partyKey(a.heroIds).localeCompare(partyKey(b.heroIds)));
  const best = scored[0]!;
  const assessment = assessPartyPower(save, best.heroIds, partySizeRecommendedPower);
  const reasons = buildRecommendationReasons(stage, best, assessment, enemyProfile, size < requestedSize);
  return { heroIds: best.heroIds, requestedSize, score: best.score, assessment, reasons };
}

export function sanitizePartyPreset(
  input: GameSaveV1,
  heroIds: readonly string[],
  restrictions: PartyRestrictions = {},
): string[] {
  const save = normalizeMetaSave(input);
  const locked = new Set(restrictions.lockedHeroIds ?? []);
  const forbidden = new Set(restrictions.forbiddenClasses ?? []);
  return [...new Set(heroIds)]
    .filter((heroId) => {
      const hero = HERO_BY_ID[heroId];
      return Boolean(hero
        && save.roster.ownedHeroIds.includes(heroId)
        && !locked.has(heroId)
        && !forbidden.has(hero.ricochetClass));
    })
    .slice(0, 3);
}

export function readPartyPreset(
  input: GameSaveV1,
  slot: number,
  restrictions: PartyRestrictions = {},
): readonly string[] {
  const save = normalizeMetaSave(input);
  return sanitizePartyPreset(save, save.roster.partyPresets[normalizePresetSlot(slot)] ?? [], restrictions);
}

export function writePartyPreset(
  input: GameSaveV1,
  slot: number,
  heroIds: readonly string[],
  restrictions: PartyRestrictions = {},
): GameSaveV1 {
  const save = normalizeMetaSave(input);
  save.roster.partyPresets[normalizePresetSlot(slot)] = sanitizePartyPreset(save, heroIds, restrictions);
  assertNoWalletState(save);
  return save;
}

export function clearPartyPreset(input: GameSaveV1, slot: number): GameSaveV1 {
  const save = normalizeMetaSave(input);
  save.roster.partyPresets[normalizePresetSlot(slot)] = [];
  assertNoWalletState(save);
  return save;
}

function scoreParty(
  party: readonly HeroDefinition[],
  stage: StageDefinition,
  enemyProfile: ReturnType<typeof buildEnemyProfile>,
  recommendedPower: number,
  powerByHeroId: ReadonlyMap<string, number>,
): ScoredParty {
  const heroIds = party.map((hero) => hero.id);
  const power = heroIds.reduce((total, heroId) => total + (powerByHeroId.get(heroId) ?? 0), 0);
  let roleScore = 0;
  let riskScore = 0;
  for (const hero of party) {
    roleScore += OBJECTIVE_ROLE_WEIGHT[stage.objective.type][hero.ricochetClass];
    riskScore += enemyRoleScore(hero, enemyProfile.behaviors);
    riskScore += hazardRoleScore(hero, stage);
  }
  const roles = new Set(party.map((hero) => hero.ricochetClass));
  const elements = new Set(party.map((hero) => hero.element));
  const desiredElementSpread = Math.min(party.length, Math.max(1, enemyProfile.elements.size));
  const diversityScore = Math.max(0, roles.size - 1) * 6
    + Math.min(elements.size, desiredElementSpread) * 2
    + (enemyProfile.dominantElement && elements.size > 1 ? 2 : 0);
  const powerRatio = power / Math.max(1, recommendedPower);
  const powerFit = Math.min(18, powerRatio * 14) - Math.max(0, 0.75 - powerRatio) * 18;
  return {
    heroIds,
    score: power * 1.2 + roleScore + riskScore + diversityScore + powerFit,
    roleScore,
    riskScore,
    diversityScore,
  };
}

function enemyRoleScore(hero: HeroDefinition, behaviors: ReadonlySet<string>): number {
  let score = 0;
  if (behaviors.has("shield")) {
    if (hero.ricochetClass === "pierce") score += 9;
    if (hero.ricochetClass === "heavy") score += 6;
    if (hero.tags.includes("shield-break")) score += 11;
  }
  if (behaviors.has("heavy")) {
    if (hero.ricochetClass === "burst") score += 8;
    if (hero.tags.includes("weakpoint") || hero.tags.includes("mark")) score += 7;
  }
  if (behaviors.has("support") || behaviors.has("summoner") || behaviors.has("splitter")) {
    if (hero.ricochetClass === "burst" || hero.ricochetClass === "bounce") score += 6;
    if (hero.tags.includes("area-damage")) score += 5;
  }
  if (behaviors.has("shooter")) {
    if (hero.ricochetClass === "support") score += 5;
    if (hero.tags.includes("guard")) score += 7;
  }
  if (behaviors.has("charger") && (hero.ricochetClass === "heavy" || hero.ricochetClass === "support")) score += 4;
  return score;
}

function hazardRoleScore(hero: HeroDefinition, stage: StageDefinition): number {
  let score = 0;
  const hazards = new Set(stage.hazards.map((hazard) => hazard.type));
  if ((["wind-vector", "current", "whirlpool", "wave-front"] as const).some((type) => hazards.has(type))) {
    if (hero.ricochetClass === "support") score += 5;
    if (hero.tags.includes("speed") || hero.tags.includes("cleanse") || hero.tags.includes("wind")) score += 6;
  }
  if (hazards.has("moving-bumper") && hero.ricochetClass === "bounce") score += 6;
  if (hazards.has("one-way-wall") || hazards.has("portal")) {
    if (hero.ricochetClass === "pierce") score += 5;
    if (hero.tags.includes("phase") || hero.tags.includes("portal")) score += 8;
  }
  if (hazards.has("lightning") || hazards.has("sound-wave")) {
    if (hero.tags.includes("speed") || hero.tags.includes("guard") || hero.tags.includes("preview")) score += 5;
  }
  if (stage.walls.some((wall) => wall.breakable) && (hero.ricochetClass === "heavy" || hero.ricochetClass === "burst")) score += 4;
  return score;
}

function buildEnemyProfile(stage: StageDefinition): {
  readonly behaviors: ReadonlySet<string>;
  readonly elements: ReadonlySet<ElementId>;
  readonly dominantElement?: ElementId;
} {
  const enemies = stage.enemies.flatMap((placement) => {
    const enemy = ENEMY_BY_ID[placement.enemyId];
    return enemy ? [enemy] : [];
  });
  const behaviors = new Set(enemies.map((enemy) => enemy.behaviorId));
  const elements = new Set(enemies.map((enemy) => enemy.element));
  const elementCounts = new Map<ElementId, number>();
  for (const enemy of enemies) elementCounts.set(enemy.element, (elementCounts.get(enemy.element) ?? 0) + 1);
  const dominant = [...elementCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    behaviors,
    elements,
    ...(dominant && dominant[1] / Math.max(1, enemies.length) >= 0.6 ? { dominantElement: dominant[0] } : {}),
  };
}

function buildRecommendationReasons(
  stage: StageDefinition,
  best: ScoredParty,
  assessment: PartyPowerAssessment,
  enemyProfile: ReturnType<typeof buildEnemyProfile>,
  shortRoster: boolean,
): string[] {
  const reasons = [OBJECTIVE_REASON[stage.objective.type]];
  const risks: string[] = [];
  if (enemyProfile.behaviors.has("shield")) risks.push("방패 적");
  if (enemyProfile.behaviors.has("shooter")) risks.push("원거리 공격");
  if (enemyProfile.behaviors.has("support") || enemyProfile.behaviors.has("summoner")) risks.push("지원·소환 적");
  if (stage.hazards.length) risks.push(`${stage.hazards.length}개 지형 위험`);
  if (risks.length && best.riskScore > 0) reasons.push(`${risks.slice(0, 2).join("·")} 대응 점수가 높은 선원을 배치했습니다.`);
  else if (best.diversityScore > 0 && best.heroIds.length > 1) reasons.push("역할과 속성을 분산해 대응 폭을 넓혔습니다.");
  if (shortRoster) reasons.push(`선택 인원보다 출전 가능한 영웅이 적어 ${best.heroIds.length}명만 추천했습니다.`);
  else if (assessment.level === "ready") reasons.push(`전투력 ${assessment.currentPower.toLocaleString()}으로 권장을 충족합니다.`);
  else reasons.push(`전투력 ${assessment.currentPower.toLocaleString()} · ${assessment.label}`);
  return reasons.slice(0, 3);
}

function combinations<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, picked: T[]): void => {
    if (picked.length === size) {
      result.push([...picked]);
      return;
    }
    for (let index = start; index <= values.length - (size - picked.length); index += 1) {
      picked.push(values[index]!);
      visit(index + 1, picked);
      picked.pop();
    }
  };
  visit(0, []);
  return result;
}

function partyKey(heroIds: readonly string[]): string {
  return [...heroIds].sort().join("|");
}

function normalizePresetSlot(slot: number): number {
  return Math.max(0, Math.min(2, Math.floor(slot)));
}

function matchesLevelFilter(level: number, filter: PartyLevelFilter): boolean {
  if (filter === "all") return true;
  if (filter === "1-10") return level <= 10;
  if (filter === "11-30") return level >= 11 && level <= 30;
  return level >= 31;
}
