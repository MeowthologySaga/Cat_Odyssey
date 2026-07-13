export interface PresentationPoint {
  readonly x: number;
  readonly y: number;
}

export type EnemyActionTempo = 1 | 1.5 | 2;

/** One timing contract keeps enemy telegraphs, movement and impacts in sync. */
export function enemyPresentationDelay(milliseconds: number, tempo: EnemyActionTempo): number {
  return Math.max(0, Math.round(milliseconds / tempo));
}

export type SkillEffectFamily = "damage" | "control" | "guard" | "mobility" | "healing" | "terrain";

export interface SkillEffectProfile {
  readonly family: SkillEffectFamily;
  readonly color: number;
  readonly flash: readonly [number, number, number];
  readonly shake: number;
  readonly hitstopMs: number;
}

export interface BattleStatusPresentationEntry {
  readonly kind: string;
  readonly remainingTurns: number;
  readonly appliedTurn?: number;
}

export interface BattleRadiusEffect {
  readonly targetId: string;
  readonly kind: string;
  readonly value: number;
  readonly remainingTurns: number;
}

/** Mirrors the runtime's party collider so size-changing status art never lies. */
export function effectiveHeroPresentationRadius(
  baseRadius: number,
  targetId: string,
  effects: readonly BattleRadiusEffect[],
): number {
  const multiplier = effects
    .filter((effect) => effect.targetId === targetId
      && effect.kind === "radius-multiplier"
      && effect.remainingTurns > 0)
    .reduce((product, effect) => product * effect.value, 1);
  return Math.max(4, baseRadius * Math.min(1.8, Math.max(0.45, multiplier)));
}

/** Mirrors the runtime's enemy collider; stacked shrink effects use the strongest value. */
export function effectiveEnemyPresentationRadius(
  baseRadius: number,
  targetId: string,
  effects: readonly BattleRadiusEffect[],
): number {
  const shrink = effects
    .filter((effect) => effect.targetId === targetId
      && effect.kind === "shrink-enemy"
      && effect.remainingTurns > 0)
    .reduce((maximum, effect) => Math.max(maximum, effect.value), 0);
  return baseRadius * Math.max(0.25, 1 - shrink / 100);
}

export interface BattleStatusPresentation<T extends BattleStatusPresentationEntry> {
  readonly visible: readonly T[];
  readonly hiddenCount: number;
}

const STATUS_PRESENTATION_PRIORITY: Readonly<Record<string, number>> = {
  stun: 120,
  bind: 110,
  "sleep-stack": 105,
  "slow-field": 100,
  "wine-slow": 95,
  "lightning-grounded": 90,
  "radius-multiplier": 85,
  "damage-redirect": 75,
  "projectile-guard": 70,
  regeneration: 65,
};

const BATTLE_EFFECT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "active-charge-speed": "액티브 충전 가속",
  "afterimage-strikes": "잔상 연격",
  "ally-launch": "동료 발사",
  "arena-beam": "전장 광선",
  bind: "속박",
  burn: "화상",
  "chain-bounce": "연쇄 반사",
  "chain-lightning": "연쇄 번개",
  "charger-knockback": "돌진 밀치기",
  cleanse: "상태 정화",
  "countdown-delay": "공격 지연",
  "cross-slash": "교차 참격",
  "damage-redirect": "피해 분담",
  "follow-up-shot": "추격탄",
  "formation-broken": "진형 붕괴",
  heal: "체력 회복",
  "heavy-impact-stack": "충격 누적",
  "lightning-grounded": "낙뢰 접지",
  "line-pierce": "직선 관통",
  "mark-weakpoint": "약점 표식",
  "mirror-clone": "거울 분신",
  "mirror-trajectory": "반전 궤적",
  "nearest-barrage": "집중 포화",
  "orbiting-blade": "선회 칼날",
  "portal-affinity-earth": "대지 차원 친화",
  "portal-affinity-spirit": "영체 차원 친화",
  "portal-pair": "쌍둥이 차원문",
  "preview-extend": "궤적 연장",
  "projectile-guard": "투사체 보호",
  "push-wave": "밀어내기 파동",
  "radial-launch": "방사 발사",
  "radius-multiplier": "몸집 변화",
  regeneration: "체력 재생",
  "reveal-weakpoint": "약점 간파",
  revive: "부활",
  "route-revive": "운명의 부활",
  "shield-break": "방패 파괴",
  "shrink-enemy": "적 축소",
  "sleep-stack": "수면 누적",
  "slow-field": "감속",
  "speed-up": "가속",
  "stationary-guard": "정지 수비",
  stun: "기절",
  "telegraph-extend": "예고 연장",
  "temporary-bumper": "임시 범퍼",
  "temporary-wall": "임시 벽",
  "trajectory-perfect": "완전 예측",
  "velocity-multiplier": "추진 가속",
  "wall-phase": "영체 통과",
  "weakpoint-multiplier": "약점 강화",
  "wind-vector": "순풍",
  "wine-slow": "취기",
});

/** Never leak internal kebab-case identifiers into the player-facing HUD. */
export function battleEffectLabel(effectKind: string): string {
  const known = BATTLE_EFFECT_LABELS[effectKind];
  if (known) return known;
  if (effectKind.startsWith("relic-")) return "유물 효과";
  return "특수 효과";
}

/** Keeps urgent control/debuff information visible when a hero has many effects. */
export function selectBattleStatusEffects<T extends BattleStatusPresentationEntry>(
  effects: readonly T[],
  limit = 3,
): BattleStatusPresentation<T> {
  const safeLimit = Math.max(0, Math.floor(limit));
  const sorted = [...effects].sort((left, right) => {
    const priority = statusPresentationPriority(right.kind) - statusPresentationPriority(left.kind);
    if (priority !== 0) return priority;
    if (left.remainingTurns !== right.remainingTurns) return left.remainingTurns - right.remainingTurns;
    const applied = (right.appliedTurn ?? -1) - (left.appliedTurn ?? -1);
    return applied || left.kind.localeCompare(right.kind);
  });
  return {
    visible: sorted.slice(0, safeLimit),
    hiddenCount: Math.max(0, sorted.length - safeLimit),
  };
}

function statusPresentationPriority(kind: string): number {
  const exact = STATUS_PRESENTATION_PRIORITY[kind];
  if (exact !== undefined) return exact;
  const normalized = kind.toLowerCase();
  if (normalized.includes("stun") || normalized.includes("sleep")) return 115;
  if (normalized.includes("bind") || normalized.includes("slow")) return 100;
  if (normalized.includes("guard") || normalized.includes("shield")) return 70;
  return 50;
}

/** Presentation-only grouping; authoritative behavior remains in BattleRuntime. */
export function skillEffectProfile(effectKind = ""): SkillEffectProfile {
  const value = effectKind.toLowerCase();
  if (["heal", "regeneration", "revive", "cleanse"].some((token) => value.includes(token))) {
    return { family: "healing", color: 0x82e0a6, flash: [74, 164, 111], shake: 0, hitstopMs: 0 };
  }
  if (["guard", "redirect", "shield"].some((token) => value.includes(token))) {
    return { family: "guard", color: 0x80d9f2, flash: [74, 145, 180], shake: 0.0015, hitstopMs: 16 };
  }
  if (["wall", "bumper", "portal", "clone"].some((token) => value.includes(token))) {
    return { family: "terrain", color: 0xf0bd76, flash: [178, 127, 61], shake: 0.002, hitstopMs: 20 };
  }
  if (["launch", "speed", "wind", "phase", "afterimage"].some((token) => value.includes(token))) {
    return { family: "mobility", color: 0x6ee7d2, flash: [46, 167, 157], shake: 0.0024, hitstopMs: 18 };
  }
  if (["bind", "stun", "slow", "mark", "shrink", "delay", "reveal"].some((token) => value.includes(token))) {
    return { family: "control", color: 0xc58bea, flash: [124, 74, 164], shake: 0.0026, hitstopMs: 24 };
  }
  return { family: "damage", color: 0xffc15f, flash: [196, 108, 35], shake: 0.0042, hitstopMs: 34 };
}

export interface WallSpriteVisibilityOptions {
  readonly active: boolean;
  readonly broken: boolean;
  readonly hasTexture: boolean;
  readonly hasBrokenVisual: boolean;
}

/** Broken collider art disappears unless the author supplied an explicit broken-state sprite. */
export function shouldShowWallSprite(options: WallSpriteVisibilityOptions): boolean {
  return options.active
    && options.hasTexture
    && (!options.broken || options.hasBrokenVisual);
}

/**
 * Logical battle regions. Phaser's FIT scaling projects these coordinates as
 * one unit, so the footer remains outside the arena even on letterboxed
 * desktop and mobile viewports.
 */
export const BATTLE_HUD_LAYOUT = {
  logicalWidth: 720,
  logicalHeight: 1280,
  arenaTop: 92,
  arenaBottom: 1132,
  footerTop: 1132,
  footerBottom: 1280,
  footerDividerX: 382,
  turnRail: { x: 12, y: 1140, width: 360, height: 58 },
  objectiveRail: { x: 390, y: 1140, width: 318, height: 58 },
  lowerLeftRail: { x: 12, y: 1206, width: 360, height: 70 },
  lowerRightRail: { x: 390, y: 1206, width: 318, height: 70 },
  phaseOverlay: { x: 12, y: 1140, width: 360, height: 58 },
  skillOverlay: { x: 390, y: 1140, width: 318, height: 58 },
  /** Temporary tutorial copy replaces footer rails, never the playable arena. */
  coachmarkOverlay: { x: 12, y: 1138, width: 696, height: 136 },
} as const;

export interface ProjectedBattleHudRegions {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly gameLeft: number;
  readonly gameRight: number;
  readonly arenaTop: number;
  readonly arenaBottom: number;
  readonly footerTop: number;
  readonly footerBottom: number;
}

export function isBattleArenaPointerY(pointerY: number, inset = 0): boolean {
  const safeInset = Math.max(0, inset);
  return pointerY >= BATTLE_HUD_LAYOUT.arenaTop + safeInset
    && pointerY <= BATTLE_HUD_LAYOUT.arenaBottom - safeInset;
}

export interface AimPullResolution {
  /** Launch direction, opposite to the player's pull. */
  readonly direction: PresentationPoint;
  readonly power: number;
  /** Presentation-only offset that keeps the cat close to its launch origin. */
  readonly displayOffset: PresentationPoint;
  readonly distance: number;
}

/** Empty-space clicks must never start a shot; the active cat is the handle. */
export function canStartAimFromActor(
  pointer: PresentationPoint,
  actor: PresentationPoint,
  actorRadius: number,
  minimumHitRadius = 72,
): boolean {
  const hitRadius = Math.max(minimumHitRadius, Math.max(0, actorRadius) * 1.85);
  return distance(pointer, actor) <= hitRadius;
}

/**
 * Resolves a slingshot gesture from pointer displacement, not from the actor's
 * absolute distance to the cursor. This makes click-and-release a no-op even
 * when the generous actor hit area was pressed near its edge.
 */
export function resolveAimPull(
  start: PresentationPoint,
  current: PresentationPoint,
  maximumPowerDistance = 210,
  maximumDisplayDistance = 92,
): AimPullResolution | null {
  const pullX = current.x - start.x;
  const pullY = current.y - start.y;
  const pullDistance = Math.hypot(pullX, pullY);
  if (pullDistance < 0.001) return null;
  const powerDistance = Math.max(1, maximumPowerDistance);
  const displayDistance = Math.min(Math.max(0, maximumDisplayDistance), pullDistance);
  const inverseLength = 1 / pullDistance;
  const canonical = (value: number): number => Math.abs(value) < 1e-12 ? 0 : value;
  return {
    direction: { x: canonical(-pullX * inverseLength), y: canonical(-pullY * inverseLength) },
    power: Math.min(1, pullDistance / powerDistance),
    displayOffset: {
      x: canonical(pullX * inverseLength * displayDistance),
      y: canonical(pullY * inverseLength * displayDistance),
    },
    distance: pullDistance,
  };
}

export function compactBattleHudLine(value: string, maximumCharacters: number): string {
  const characters = Array.from(value.trim());
  const limit = Math.max(2, Math.floor(maximumCharacters));
  return characters.length <= limit ? characters.join("") : `${characters.slice(0, limit - 1).join("")}…`;
}

export interface EnemyIntentBadgePlacementOptions {
  readonly enemyX: number;
  readonly enemyY: number;
  readonly enemyRadius: number;
  readonly badgeWidth: number;
  readonly badgeHeight: number;
  readonly stackOffset?: number;
}

export function placeEnemyIntentBadge(options: EnemyIntentBadgePlacementOptions): PresentationPoint {
  const margin = 8;
  const halfWidth = Math.max(1, options.badgeWidth / 2);
  const halfHeight = Math.max(1, options.badgeHeight / 2);
  const minimumX = margin + halfWidth;
  const maximumX = BATTLE_HUD_LAYOUT.logicalWidth - margin - halfWidth;
  const minimumY = BATTLE_HUD_LAYOUT.arenaTop + margin + halfHeight;
  const maximumY = BATTLE_HUD_LAYOUT.arenaBottom - margin - halfHeight;
  const stackOffset = Math.max(0, options.stackOffset ?? 0);
  const preferredAbove = options.enemyY - options.enemyRadius - 28 - halfHeight - stackOffset;
  const preferredBelow = options.enemyY + options.enemyRadius + 28 + halfHeight + stackOffset;
  const y = preferredAbove >= minimumY
    ? preferredAbove
    : Math.min(maximumY, Math.max(minimumY, preferredBelow));
  return {
    x: Math.min(maximumX, Math.max(minimumX, options.enemyX)),
    y: Math.min(maximumY, Math.max(minimumY, y)),
  };
}

/** Mirrors Phaser.Scale.FIT for layout regression tests and host integration. */
export function projectBattleHudRegions(viewportWidth: number, viewportHeight: number): ProjectedBattleHudRegions {
  const safeWidth = Math.max(1, viewportWidth);
  const safeHeight = Math.max(1, viewportHeight);
  const scale = Math.min(
    safeWidth / BATTLE_HUD_LAYOUT.logicalWidth,
    safeHeight / BATTLE_HUD_LAYOUT.logicalHeight,
  );
  const renderedWidth = BATTLE_HUD_LAYOUT.logicalWidth * scale;
  const renderedHeight = BATTLE_HUD_LAYOUT.logicalHeight * scale;
  const offsetX = (safeWidth - renderedWidth) / 2;
  const offsetY = (safeHeight - renderedHeight) / 2;
  return {
    scale,
    offsetX,
    offsetY,
    gameLeft: offsetX,
    gameRight: offsetX + renderedWidth,
    arenaTop: offsetY + BATTLE_HUD_LAYOUT.arenaTop * scale,
    arenaBottom: offsetY + BATTLE_HUD_LAYOUT.arenaBottom * scale,
    footerTop: offsetY + BATTLE_HUD_LAYOUT.footerTop * scale,
    footerBottom: offsetY + BATTLE_HUD_LAYOUT.footerBottom * scale,
  };
}

export interface PresentationSegment {
  readonly from: PresentationPoint;
  readonly to: PresentationPoint;
  /** False for pass-through contacts that split simulation segments without reflecting. */
  readonly bounceAfter?: boolean;
}

export interface PreviewDot extends PresentationPoint {
  /** The reflected leg is deliberately dimmer than the initial aim leg. */
  readonly reflected: boolean;
}

export interface LimitedTrajectoryPreview {
  readonly dots: readonly PreviewDot[];
  readonly firstBounce: PresentationPoint | null;
}

function distance(a: PresentationPoint, b: PresentationPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointAlong(from: PresentationPoint, to: PresentationPoint, travelled: number): PresentationPoint {
  const length = distance(from, to);
  if (length <= 0.0001) return { ...from };
  const ratio = Math.min(1, Math.max(0, travelled / length));
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

function appendDots(
  output: PreviewDot[],
  from: PresentationPoint,
  to: PresentationPoint,
  maxLength: number,
  spacing: number,
  reflected: boolean,
): void {
  const visibleLength = Math.min(distance(from, to), maxLength);
  for (let travelled = 0; travelled <= visibleLength + 0.001; travelled += spacing) {
    output.push({ ...pointAlong(from, to, travelled), reflected });
  }
  const finalPoint = pointAlong(from, to, visibleLength);
  const last = output[output.length - 1];
  if (!last || distance(last, finalPoint) > 0.001) output.push({ ...finalPoint, reflected });
}

/**
 * Builds the intentionally incomplete aim guide used by the battle scene.
 *
 * Ricochet prediction stays useful without solving the shot for the player:
 * the initial leg is shown, then only a short, faded portion after the first
 * bounce. Enemy/weakpoint contacts and later bounces are never disclosed.
 */
export function buildLimitedTrajectoryPreview(
  segments: readonly PresentationSegment[],
  options: { readonly initialLength?: number; readonly reflectedLength?: number; readonly spacing?: number; readonly visibleReflections?: number } = {},
): LimitedTrajectoryPreview {
  const first = segments[0];
  if (!first) return { dots: [], firstBounce: null };

  const initialLength = Math.max(0, options.initialLength ?? 560);
  const reflectedLength = Math.max(0, options.reflectedLength ?? 150);
  const spacing = Math.max(8, options.spacing ?? 21);
  const visibleReflections = Math.max(0, Math.floor(options.visibleReflections ?? 1));
  const dots: PreviewDot[] = [];
  let initialRemaining = initialLength;
  let firstBounceIndex = -1;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const length = distance(segment.from, segment.to);
    appendDots(dots, segment.from, segment.to, initialRemaining, spacing, false);
    if (length > initialRemaining + 0.001) return { dots, firstBounce: null };
    initialRemaining = Math.max(0, initialRemaining - length);
    if (segment.bounceAfter ?? true) {
      firstBounceIndex = index;
      break;
    }
  }

  const reflectedStart = firstBounceIndex + 1;
  if (firstBounceIndex < 0 || visibleReflections === 0 || !segments[reflectedStart]) {
    return { dots, firstBounce: null };
  }

  let reflectionNumber = 1;
  let reflectedRemaining = visibleReflections === 1 ? reflectedLength : Number.POSITIVE_INFINITY;
  for (let index = reflectedStart; index < segments.length && reflectionNumber <= visibleReflections; index += 1) {
    const segment = segments[index]!;
    const length = distance(segment.from, segment.to);
    appendDots(dots, segment.from, segment.to, reflectedRemaining, spacing * 1.12, true);
    if (length > reflectedRemaining + 0.001) break;
    reflectedRemaining = Math.max(0, reflectedRemaining - length);
    if (!(segment.bounceAfter ?? true)) continue;
    reflectionNumber += 1;
    reflectedRemaining = reflectionNumber === visibleReflections
      ? reflectedLength
      : Number.POSITIVE_INFINITY;
  }

  return { dots, firstBounce: { ...segments[firstBounceIndex]!.to } };
}

export function objectiveProgressText(current: number, required: number): string {
  const safeRequired = Math.max(1, Math.round(required));
  const safeCurrent = Math.min(safeRequired, Math.max(0, Math.round(current)));
  return `${safeCurrent} / ${safeRequired}`;
}

export function battleTurnText(turnNumber: number, turnLimit: number, enemyPhaseTurn?: number): string {
  if (enemyPhaseTurn !== undefined) return `적 행동  ·  ${Math.max(1, Math.round(enemyPhaseTurn))}턴째`;
  return `턴 ${Math.max(1, Math.round(turnNumber))} / ${Math.max(1, Math.round(turnLimit))}`;
}

export interface EnemyIntentBadgeOptions {
  readonly behavior: string;
  readonly countdown: number;
  readonly blocked?: boolean;
  readonly acting?: boolean;
  readonly danger?: boolean;
  readonly helpful?: boolean;
  readonly summon?: boolean;
}

/** Compact labels stay legible when several enemies stand close together. */
export function enemyIntentBadgeText(options: EnemyIntentBadgeOptions): string {
  if (options.blocked) return `멈춤 · ${options.behavior}`;
  if (options.acting) return `행동 중 · ${options.behavior}`;
  if (options.danger && options.helpful) return "회복 준비";
  if (options.danger && options.summon) return "소환 준비";
  if (options.danger) return `다음 공격 · ${options.behavior}`;
  return `${Math.max(0, Math.round(options.countdown))}턴 · ${options.behavior}`;
}

export function effectivePreviewReflections(
  baseReflections: number,
  effects: readonly { readonly kind: string; readonly value: number }[],
  maximum = 6,
): number {
  const base = Math.max(0, Math.floor(baseReflections));
  let result = base;
  for (const effect of effects) {
    const value = Math.max(0, Math.round(effect.value));
    if (effect.kind === "preview-extend") result = Math.max(result, base + value);
    if (effect.kind === "trajectory-perfect") result = Math.max(result, value);
  }
  return Math.min(Math.max(0, Math.floor(maximum)), result);
}

export interface ViewIdReconciliation {
  readonly create: readonly string[];
  readonly keep: readonly string[];
  readonly remove: readonly string[];
}

export function reconcileViewIds(existingIds: Iterable<string>, runtimeIds: Iterable<string>): ViewIdReconciliation {
  const existing = [...new Set(existingIds)];
  const runtime = [...new Set(runtimeIds)];
  const existingSet = new Set(existing);
  const runtimeSet = new Set(runtime);
  return {
    create: runtime.filter((id) => !existingSet.has(id)),
    keep: runtime.filter((id) => existingSet.has(id)),
    remove: existing.filter((id) => !runtimeSet.has(id)),
  };
}
