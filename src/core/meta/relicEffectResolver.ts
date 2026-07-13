import type { DataEffect, RelicDefinition, RuntimeRelicEffect } from "../../data/types";

export type RelicEffectSupport = "battle" | "reward" | "unsupported";

export interface RelicEffectSpec {
  readonly label: string;
  readonly support: RelicEffectSupport;
  readonly unit: "percent" | "turn" | "count" | "hp";
}

/**
 * Single source of truth for authored relic-effect coverage and player-facing
 * wording. An unknown or unfinished kind is deliberately reported as
 * unsupported instead of being presented as if its passive were active. Every
 * effect currently authored by relics.json has a battle or reward consumer.
 */
export const RELIC_EFFECT_SPECS: Readonly<Record<string, RelicEffectSpec>> = Object.freeze({
  "weakpoint-damage": { label: "약점 피해", support: "battle", unit: "percent" },
  "stationary-guard": { label: "대기 중 피해 감소", support: "battle", unit: "percent" },
  "first-countdown-delay": { label: "첫 공격 카운트 지연", support: "battle", unit: "turn" },
  "first-shot-speed": { label: "첫 발사 속도", support: "battle", unit: "percent" },
  "pierce-retained-speed": { label: "관통 후 속도 유지", support: "battle", unit: "percent" },
  "temporary-wall-hp": { label: "임시 벽 내구도", support: "battle", unit: "percent" },
  "precision-chain": { label: "연속 약점 보너스", support: "battle", unit: "percent" },
  "first-clear-material": { label: "첫 클리어 재료", support: "reward", unit: "percent" },
  "boss-damage": { label: "보스 피해", support: "battle", unit: "percent" },
  "rear-hit-damage": { label: "후방 피해", support: "battle", unit: "percent" },
  "friendship-radius": { label: "우정 접촉 범위", support: "battle", unit: "percent" },
  "part-break-damage": { label: "파괴 부위 피해", support: "battle", unit: "percent" },
  "whirlpool-resistance": { label: "소용돌이 저항", support: "battle", unit: "percent" },
  mass: { label: "중량형 질량", support: "battle", unit: "percent" },
  "stun-duration": { label: "첫 기절 지속", support: "battle", unit: "turn" },
  "boss-part-hp-visible": { label: "보스 부위 체력 표시", support: "battle", unit: "count" },
  "wind-force-reduction": { label: "바람·해류 저항", support: "battle", unit: "percent" },
  "wall-damage": { label: "파괴 벽 피해", support: "battle", unit: "percent" },
  "speed-after-ally": { label: "아군 접촉 후 속도", support: "battle", unit: "percent" },
  "heal-on-hazard-exit": { label: "위험지대 이탈 회복", support: "battle", unit: "hp" },
  "hazard-vector-visible": { label: "위험 벡터 표시", support: "battle", unit: "count" },
  "low-hp-restitution": { label: "저체력 반발력", support: "battle", unit: "percent" },
  "route-gold": { label: "항로 골드", support: "reward", unit: "percent" },
  "route-revive": { label: "전투당 최초 전투불능 부활", support: "battle", unit: "percent" },
  "debuff-duration": { label: "약화 지속시간", support: "battle", unit: "turn" },
  "active-charge-speed": { label: "액티브 충전 속도", support: "battle", unit: "percent" },
  "burn-damage": { label: "화상 피해", support: "battle", unit: "percent" },
  "chain-lightning": { label: "3번째 접촉 연쇄번개", support: "battle", unit: "percent" },
  "phase-chance": { label: "충돌 위상 통과", support: "battle", unit: "percent" },
  "first-weakpoint-critical": { label: "첫 약점 치명타 확률", support: "battle", unit: "percent" },
  regeneration: { label: "최저 체력 재생", support: "battle", unit: "hp" },
  "enemy-action-preview": { label: "다음 적 행동 예고", support: "battle", unit: "count" },
  "preview-bounces": { label: "예상 반사 횟수", support: "battle", unit: "count" },
});

export function scaleRelicEffectValue(value: number, level: number): number {
  if (value === 0) return 0;
  const safeLevel = Math.min(5, Math.max(1, Math.floor(level)));
  const magnitude = Math.abs(value) * (1 + (safeLevel - 1) * 0.2);
  return Math.round(magnitude * 100) / 100 * Math.sign(value);
}

export function relicEffectSupport(kind: string): RelicEffectSupport {
  return RELIC_EFFECT_SPECS[kind]?.support ?? "unsupported";
}

export function relicEffectSpec(kind: string): RelicEffectSpec | undefined {
  return RELIC_EFFECT_SPECS[kind];
}

export function relicEffectValue(
  effects: readonly Pick<RuntimeRelicEffect, "kind" | "value">[],
  kind: string,
  aggregation: "sum" | "max" = "sum",
): number {
  const values = effects.filter((effect) => effect.kind === kind).map((effect) => effect.value);
  if (values.length === 0) return 0;
  return aggregation === "max"
    ? values.reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY)
    : values.reduce((sum, value) => sum + value, 0);
}

export function createRuntimeRelicEffects(
  relicId: string,
  level: number,
  effects: readonly DataEffect[],
): readonly RuntimeRelicEffect[] {
  const sourceLevel = Math.min(5, Math.max(1, Math.floor(level)));
  return effects.map((effect) => ({
    ...effect,
    sourceId: relicId,
    sourceLevel,
    value: scaleRelicEffectValue(effect.value, sourceLevel),
  }));
}

export function relicEffectLevelSummary(relic: RelicDefinition, level: number): string {
  const currentLevel = Math.min(5, Math.max(1, Math.floor(level)));
  const nextLevel = Math.min(5, currentLevel + 1);
  return relic.effects.map((effect) => {
    const spec = RELIC_EFFECT_SPECS[effect.kind] ?? {
      label: effect.kind,
      support: "unsupported" as const,
      unit: "count" as const,
    };
    const current = scaleRelicEffectValue(effect.value, currentLevel);
    const next = scaleRelicEffectValue(effect.value, nextLevel);
    const progression = currentLevel < 5 && current !== next
      ? `${formatRelicEffectValue(current, spec.unit)} → ${formatRelicEffectValue(next, spec.unit)}`
      : formatRelicEffectValue(current, spec.unit);
    const status = spec.support === "unsupported" ? " · 현재 미연결" : "";
    return `${spec.label} ${progression}${status}`;
  }).join(" / ");
}

function formatRelicEffectValue(value: number, unit: RelicEffectSpec["unit"]): string {
  const readable = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  if (unit === "percent") return `${value >= 0 ? "+" : ""}${readable}%`;
  if (unit === "turn") return `${Math.abs(value)}턴${value < 0 ? " 감소" : ""}`;
  if (unit === "hp") return `${value >= 0 ? "+" : ""}${readable} HP`;
  return `${value >= 0 ? "+" : ""}${readable}`;
}
