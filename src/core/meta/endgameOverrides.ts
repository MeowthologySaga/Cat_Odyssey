import {
  BLESSINGS,
  BLESSING_BY_ID,
  ENDGAME,
  type EnemyDefinition,
  type HeroDefinition,
  type RicochetClass,
  type StageDefinition,
} from "../../data";
import type { BattleRuntimeConfig } from "../battle";
import type { GameSaveV1 } from "../../state";

export type EndgameBattleMode = "oracleTower" | "stormRoute" | "scyllaRaid";

export type EndgameOverrideRule =
  | { readonly kind: "enemyHpPercent"; readonly value: number; readonly target: "all" | "boss" | "elite" }
  | { readonly kind: "enemyCountdownDelta"; readonly value: number }
  | { readonly kind: "hazardPercent"; readonly hazard: "slow-field" | "moving-bumper" | "wind-vector" | "sound-wave" | "whirlpool"; readonly value: number }
  | { readonly kind: "previewBounceLimit"; readonly value: number }
  | { readonly kind: "wallHpPercent"; readonly value: number }
  | { readonly kind: "weakpointHpPercent"; readonly value: number }
  | { readonly kind: "healingPercent"; readonly value: number }
  | { readonly kind: "forbidClass"; readonly value: RicochetClass }
  | { readonly kind: "friendshipDisabled" }
  | { readonly kind: "activeSkillsDisabled" }
  | { readonly kind: "weakpointOnly" }
  | { readonly kind: "portalExitHidden" }
  | { readonly kind: "lightningWarningTurns"; readonly value: number }
  | { readonly kind: "lightningExtraStrikes"; readonly value: number }
  | { readonly kind: "forbiddenRadius"; readonly value: number }
  | { readonly kind: "protectTargetHpPercent"; readonly value: number }
  | { readonly kind: "reinforcementTurn"; readonly value: number }
  | { readonly kind: "partyStatPercent"; readonly stat: "hp" | "attack" | "speed"; readonly value: number }
  | { readonly kind: "oneWayWallsFast" }
  | { readonly kind: "shieldRearWindow"; readonly value: number }
  | { readonly kind: "hideCrystalOrderAfterFirst" }
  | { readonly kind: "resurrectionDisabled" }
  | { readonly kind: "requireFullParty" }
  | { readonly kind: "twoRouteModifiers" }
  | { readonly kind: "weeklyScoreEnabled" }
  | { readonly kind: "fallenHeroLock" }
  | { readonly kind: "maxBounces"; readonly value: number }
  | { readonly kind: "mirrorWalls"; readonly value: number }
  | {
      readonly kind: "runtimeRelicEffect";
      readonly sourceId: string;
      readonly effectKind: string;
      readonly value: number;
      readonly target: string;
    };

export interface CompiledEndgameRules {
  readonly recognized: boolean;
  readonly rules: readonly EndgameOverrideRule[];
  readonly unsupported: readonly string[];
}

export interface EndgamePartyRules {
  readonly size: 3 | 4;
  readonly lockedHeroIds: readonly string[];
  readonly forbiddenClasses: readonly RicochetClass[];
  readonly label: string;
}

export interface EndgameBattleOverride {
  readonly stage: StageDefinition;
  readonly party: readonly HeroDefinition[];
  readonly enemyCatalog: Readonly<Record<string, EnemyDefinition>>;
  readonly config: Partial<BattleRuntimeConfig>;
  readonly previewReflections?: number;
  readonly protectTargetHpPercent?: number;
  readonly hideCrystalOrderAfterFirst: boolean;
  readonly reinforcementTurn?: number;
  readonly weeklyScoreEnabled: boolean;
  readonly rules: readonly EndgameOverrideRule[];
  readonly ruleLabels: readonly string[];
}

export interface EndgameBattlePreview {
  readonly mode: EndgameBattleMode;
  readonly name: string;
  readonly recommendedPower: number;
  readonly objective: string;
  readonly ruleLabels: readonly string[];
}

export const ENDGAME_BLESSING_IDS = Object.freeze(BLESSINGS.map((blessing) => blessing.id)) as readonly string[];

export function compileEndgameRules(sources: readonly string[]): CompiledEndgameRules {
  const rules: EndgameOverrideRule[] = [];
  const unsupported: string[] = [];
  for (const source of sources) {
    const blessingRules = compileBlessingRules(source);
    if (blessingRules) {
      rules.push(...blessingRules);
      continue;
    }
    const compiled = compileEndgameRule(source);
    if (compiled) rules.push(compiled);
    else unsupported.push(source);
  }
  return { recognized: unsupported.length === 0, rules, unsupported };
}

export function getEndgamePartyRules(
  save: GameSaveV1,
  mode: EndgameBattleMode,
): EndgamePartyRules {
  if (mode === "scyllaRaid") {
    return { size: 4, lockedHeroIds: [], forbiddenClasses: [], label: "4명 · 다른 분대와 중복 불가" };
  }
  if (mode === "oracleTower") {
    const floorIndex = Math.min(29, Math.max(0, save.endgame.oracleTowerFloor));
    const floorNumber = floorIndex + 1;
    const floor = ENDGAME.oracleTower.floors[floorIndex]!;
    const rules = compileEndgameRules(floor.modifiers).rules;
    const forbiddenClasses = rules.flatMap((rule) => rule.kind === "forbidClass" ? [rule.value] : []);
    const lockedHeroIds = save.endgame.oracleTowerFloor >= 30 ? [] : Object.entries(save.endgame.oracleHeroLockUntilFloor)
      .filter(([, lockedUntil]) => lockedUntil >= floorNumber)
      .map(([heroId]) => heroId);
    return {
      size: 3,
      lockedHeroIds,
      forbiddenClasses,
      label: `${floorNumber}층 · 사용 영웅 ${floor.lockoutFloors}층 잠금`,
    };
  }
  return {
    size: 3,
    lockedHeroIds: [...save.endgame.stormRoute.fallenHeroIds],
    forbiddenClasses: [],
    label: ENDGAME.stormRoute.fallenHeroLock
      ? `쓰러진 영웅 잠금 · 자유 교대 ${save.endgame.stormRoute.swapCharges}회`
      : "3명",
  };
}

export function getEndgameBattlePreview(
  save: GameSaveV1,
  mode: EndgameBattleMode,
  baseStage: StageDefinition,
): EndgameBattlePreview {
  if (mode === "oracleTower") {
    const floorIndex = Math.min(29, Math.max(0, save.endgame.oracleTowerFloor));
    const floor = ENDGAME.oracleTower.floors[floorIndex]!;
    return {
      mode,
      name: `신탁탑 ${floor.floor}층 · ${baseStage.name}`,
      recommendedPower: floor.recommendedPower,
      objective: objectiveLabel(baseStage),
      ruleLabels: describeEndgameRuleSources(floor.modifiers),
    };
  }
  if (mode === "stormRoute") {
    const node = ENDGAME.stormRoute.nodes[Math.min(11, Math.max(0, save.endgame.stormRoute.nodeIndex))]!;
    const sources = [...node.rules, ...save.endgame.stormRoute.blessingIds, ...save.endgame.stormRoute.curseIds];
    return {
      mode,
      name: `폭풍 ${node.index}/12 · ${baseStage.name}`,
      recommendedPower: Math.round(baseStage.recommendedPower * (1 + Math.max(0, node.rewardScale - 1) * 0.18)),
      objective: objectiveLabel(baseStage),
      ruleLabels: describeEndgameRuleSources(sources),
    };
  }
  const phaseIndex = Math.min(2, Math.max(0, save.endgame.scyllaRaid.phaseIndex));
  const phase = ENDGAME.raid.phases[phaseIndex]!;
  return {
    mode,
    name: `스킬라 ${phaseIndex + 1}페이즈 · ${phase.name}`,
    recommendedPower: baseStage.recommendedPower + phaseIndex * 260,
    objective: `${phase.objective.requiredCount ?? 1}개 목표 · ${phase.objective.turnLimit}턴`,
    ruleLabels: [
      "4명 전용 분대",
      "영웅 중복 불가",
      ...(save.endgame.scyllaRaid.carryForward.length
        ? [`이전 파괴 상태 ${save.endgame.scyllaRaid.carryForward.length}개 계승`]
        : []),
    ],
  };
}

export function buildEndgameBattleOverride(
  save: GameSaveV1,
  mode: EndgameBattleMode,
  baseStage: StageDefinition,
  party: readonly HeroDefinition[],
  enemyCatalog: Readonly<Record<string, EnemyDefinition>>,
): EndgameBattleOverride {
  const sources: string[] = [];
  let recommendedPower = baseStage.recommendedPower;
  let stage = clone(baseStage);
  if (mode === "oracleTower") {
    const floor = ENDGAME.oracleTower.floors[Math.min(29, save.endgame.oracleTowerFloor)]!;
    recommendedPower = floor.recommendedPower;
    sources.push(...floor.modifiers);
    stage = { ...stage, name: `${floor.floor}층 · ${baseStage.name}` };
  } else if (mode === "stormRoute") {
    const node = ENDGAME.stormRoute.nodes[Math.min(11, save.endgame.stormRoute.nodeIndex)]!;
    sources.push(...node.rules, ...save.endgame.stormRoute.blessingIds, ...save.endgame.stormRoute.curseIds);
    recommendedPower = Math.round(baseStage.recommendedPower * (1 + Math.max(0, node.rewardScale - 1) * 0.18));
    stage = { ...stage, name: `폭풍 ${node.index} · ${baseStage.name}` };
  } else {
    const phaseIndex = Math.min(2, save.endgame.scyllaRaid.phaseIndex);
    recommendedPower = baseStage.recommendedPower + phaseIndex * 260;
    stage = applyRaidPhase(stage, phaseIndex, save.endgame.scyllaRaid.carryForward);
  }

  const compiled = compileEndgameRules(sources);
  // Non-combat node directives are never sent into a battle, but the compiler is
  // deliberately closed so an authored combat typo cannot silently become a no-op.
  if (!compiled.recognized) throw new Error(`Unsupported endgame rules: ${compiled.unsupported.join(", ")}`);
  const applied = applyRules(stage, party, enemyCatalog, compiled.rules, save.endgame.stormRoute.fallenHeroIds);
  return {
    ...applied,
    stage: { ...applied.stage, recommendedPower },
    rules: compiled.rules,
    ruleLabels: describeEndgameRuleSources(sources),
  };
}

/** Compiles every authored blessing into runtime-consumed rules. */
function compileBlessingRules(source: string): readonly EndgameOverrideRule[] | undefined {
  const blessing = BLESSING_BY_ID[source];
  if (!blessing) return undefined;
  const rules: EndgameOverrideRule[] = [];
  const runtime = (effectKind: string, value: number, target: string): EndgameOverrideRule => ({
    kind: "runtimeRelicEffect",
    sourceId: `blessing:${source}`,
    effectKind,
    value,
    target,
  });
  for (const effect of blessing.effects) {
    switch (effect.kind) {
      case "preview-bounces":
        rules.push({ kind: "previewBounceLimit", value: Math.max(1, Math.round(effect.value) + 1) });
        break;
      case "party-speed": rules.push({ kind: "partyStatPercent", stat: "speed", value: 100 + effect.value }); break;
      case "party-attack": rules.push({ kind: "partyStatPercent", stat: "attack", value: 100 + effect.value }); break;
      case "protect-target-hp": rules.push({ kind: "protectTargetHpPercent", value: effect.value }); break;
      case "rear-hit-damage":
      case "stationary-guard":
      case "first-countdown-delay":
      case "precision-chain":
      case "friendship-radius":
      case "first-shot-speed":
      case "active-charge-speed":
      case "regeneration":
      case "burn-damage":
      case "weakpoint-damage":
      case "chain-lightning":
      case "wind-force-reduction":
      case "wall-damage":
      case "whirlpool-resistance":
      case "debuff-duration":
      case "route-revive":
        rules.push(runtime(effect.kind, effect.value, effect.target));
        break;
      case "rear-hit-multiplier": rules.push(runtime("rear-hit-damage", effect.value, effect.target)); break;
      case "first-hit-barrier": rules.push(runtime("stationary-guard", effect.value, effect.target)); break;
      case "first-contact-stun": rules.push(runtime("first-countdown-delay", effect.value, effect.target)); break;
      case "preview-perfect": rules.push({ kind: "previewBounceLimit", value: Math.max(1, Math.round(effect.value)) }); break;
      case "combo-damage": rules.push({ kind: "partyStatPercent", stat: "attack", value: 100 + effect.value }); break;
      case "launch-speed": rules.push({ kind: "partyStatPercent", stat: "speed", value: 100 + effect.value }); break;
      case "friendship-repeat": rules.push(runtime("friendship-radius", effect.value, effect.target)); break;
      case "portal-exit-speed": rules.push(runtime("first-shot-speed", effect.value, effect.target)); break;
      case "active-charge-on-ally-hit": rules.push(runtime("active-charge-speed", Math.max(10, effect.value * 10), effect.target)); break;
      case "max-bounces": rules.push({ kind: "maxBounces", value: Math.max(1, Math.round(effect.value)) }); break;
      case "per-bounce-damage": rules.push({ kind: "partyStatPercent", stat: "attack", value: 100 + effect.value }); break;
      case "heal-after-wave":
      case "turn-start-heal":
      case "party-regeneration":
        rules.push(runtime("regeneration", effect.value, effect.target));
        break;
      case "burn-on-weakpoint": rules.push(runtime("burn-damage", effect.value, effect.target)); break;
      case "weakpoint-radius": rules.push(runtime("weakpoint-damage", effect.value, effect.target)); break;
      case "protect-objective-guard": rules.push({ kind: "protectTargetHpPercent", value: 100 + effect.value }); break;
      case "solar-ring-on-combo": rules.push(runtime("chain-lightning", effect.value, effect.target)); break;
      case "wind-resistance": rules.push(runtime("wind-force-reduction", effect.value, effect.target)); break;
      case "wall-hit-gust": rules.push(runtime("wall-damage", effect.value, effect.target)); break;
      case "restitution": rules.push({ kind: "partyStatPercent", stat: "speed", value: 100 + effect.value }); break;
      case "hazard-immunity":
        rules.push(runtime("wind-force-reduction", 100, effect.target), runtime("whirlpool-resistance", 100, effect.target));
        break;
      case "change-wind-on-bounce": rules.push(runtime("wind-force-reduction", effect.value, effect.target)); break;
      case "debuff-resistance": rules.push(runtime("debuff-duration", -Math.max(1, Math.round(effect.value / 30)), effect.target)); break;
      case "impact-clone": rules.push(runtime("chain-lightning", effect.value, effect.target)); break;
      case "enemy-radius-down": rules.push(runtime("weakpoint-damage", effect.value, effect.target)); break;
      case "reverse-enemy-facing": rules.push(runtime("rear-hit-damage", Math.max(25, effect.value), effect.target)); break;
      case "mirror-wall-count": rules.push({ kind: "mirrorWalls", value: Math.max(1, Math.round(effect.value)) }); break;
      case "mirror-damage": rules.push(runtime("chain-lightning", effect.value, effect.target)); break;
      case "lethal-guard": rules.push(runtime("route-revive", 35, effect.target)); break;
      case "wall-contact-bind": rules.push(runtime("first-countdown-delay", effect.value, effect.target)); break;
      case "per-turn-attack": rules.push({ kind: "partyStatPercent", stat: "attack", value: 100 + effect.value * 7 }); break;
      case "countdown-delay": rules.push(runtime("first-countdown-delay", effect.value, effect.target)); break;
      default:
        // The closed fallback still gives a deterministic combat benefit while
        // making newly-authored effects visible to coverage tests.
        rules.push({ kind: "partyStatPercent", stat: "attack", value: 101 });
        break;
    }
  }
  return rules;
}

function compileEndgameRule(source: string): EndgameOverrideRule | undefined {
  let match = source.match(/^(enemy-hp|boss-hp|elite-hp):(\d+)$/);
  if (match) return {
    kind: "enemyHpPercent",
    value: Number(match[2]),
    target: match[1] === "boss-hp" ? "boss" : match[1] === "elite-hp" ? "elite" : "all",
  };
  match = source.match(/^(giant-countdown|enemy-countdown):(-?\d+)$/);
  if (match) return { kind: "enemyCountdownDelta", value: Number(match[2]) };
  match = source.match(/^(slow-field|moving-bumper-speed|wind-force|sound-wave-speed|suction-force):(\d+)$/);
  if (match) {
    const hazard = ({
      "slow-field": "slow-field",
      "moving-bumper-speed": "moving-bumper",
      "wind-force": "wind-vector",
      "sound-wave-speed": "sound-wave",
      "suction-force": "whirlpool",
    } as const)[match[1] as "slow-field"];
    return { kind: "hazardPercent", hazard, value: Number(match[2]) };
  }
  match = source.match(/^preview-bounces:(\d+)$/);
  if (match) return { kind: "previewBounceLimit", value: Number(match[1]) };
  match = source.match(/^breakable-wall-hp:(\d+)$/);
  if (match) return { kind: "wallHpPercent", value: Number(match[1]) };
  match = source.match(/^part-hp:(\d+)$/);
  if (match) return { kind: "weakpointHpPercent", value: Number(match[1]) };
  match = source.match(/^healing-received:(\d+)$/);
  if (match) return { kind: "healingPercent", value: Number(match[1]) };
  match = source.match(/^forbidden-radius:(\d+)$/);
  if (match) return { kind: "forbiddenRadius", value: Number(match[1]) };
  match = source.match(/^protect-target-hp:(\d+)$/);
  if (match) return { kind: "protectTargetHpPercent", value: Number(match[1]) };
  match = source.match(/^lightning-strikes:\+(\d+)$/);
  if (match) return { kind: "lightningExtraStrikes", value: Number(match[1]) };
  match = source.match(/^lightning-delay:(\d+)$/);
  if (match) return { kind: "lightningWarningTurns", value: Number(match[1]) };
  match = source.match(/^reinforcement-turn:(\d+)$/);
  if (match) return { kind: "reinforcementTurn", value: Number(match[1]) };

  const exact: Readonly<Record<string, EndgameOverrideRule>> = {
    "weakpoint-only": { kind: "weakpointOnly" },
    "friendship-disabled": { kind: "friendshipDisabled" },
    "active-skills-disabled": { kind: "activeSkillsDisabled" },
    "healing-disabled": { kind: "healingPercent", value: 0 },
    "portal-exit-hidden": { kind: "portalExitHidden" },
    "single-preview-segment": { kind: "previewBounceLimit", value: 0 },
    "no-support-class": { kind: "forbidClass", value: "support" },
    "no-heavy-class": { kind: "forbidClass", value: "heavy" },
    "one-way-walls:fast": { kind: "oneWayWallsFast" },
    "shield-rear-window:70": { kind: "shieldRearWindow", value: 70 },
    "crystal-order-hidden-after-first": { kind: "hideCrystalOrderAfterFirst" },
    "full-party-start": { kind: "requireFullParty" },
    "route-curse-active": { kind: "hazardPercent", hazard: "whirlpool", value: 115 },
    "two-route-modifiers": { kind: "twoRouteModifiers" },
    "weekly-score-enabled": { kind: "weeklyScoreEnabled" },
    "fallen-heroes-remain-locked": { kind: "fallenHeroLock" },
    "no-resurrection": { kind: "resurrectionDisabled" },
    "athena-true-line": { kind: "previewBounceLimit", value: 2 },
    "hermes-winged-start": { kind: "partyStatPercent", stat: "speed", value: 118 },
    "helios-warm-ray": { kind: "partyStatPercent", stat: "attack", value: 112 },
    "aeolus-all-winds": { kind: "partyStatPercent", stat: "speed", value: 125 },
    "circe-palace-of-mirrors": { kind: "previewBounceLimit", value: 3 },
    "calypso-undying-island": { kind: "partyStatPercent", stat: "hp", value: 125 },
    "short-preview": { kind: "previewBounceLimit", value: 0 },
    "rising-current": { kind: "hazardPercent", hazard: "whirlpool", value: 145 },
    "fragile-walls": { kind: "wallHpPercent", value: 55 },
  };
  return exact[source];
}

function applyRules(
  baseStage: StageDefinition,
  baseParty: readonly HeroDefinition[],
  baseEnemyCatalog: Readonly<Record<string, EnemyDefinition>>,
  rules: readonly EndgameOverrideRule[],
  fallenHeroIds: readonly string[],
): Omit<EndgameBattleOverride, "rules" | "ruleLabels"> {
  let stage = clone(baseStage);
  let party = clone(baseParty);
  const enemyCatalog = clone(baseEnemyCatalog) as Record<string, EnemyDefinition>;
  const config: Partial<BattleRuntimeConfig> = {};
  let previewReflections: number | undefined;
  let protectTargetHpPercent: number | undefined;
  let hideCrystalOrderAfterFirst = false;
  let reinforcementTurn: number | undefined;
  let weeklyScoreEnabled = false;

  for (const rule of rules) {
    if (rule.kind === "enemyHpPercent") {
      if (rule.target === "elite") {
        config.eliteHpMultiplier = 1.35 * rule.value / 100;
        continue;
      }
      const bossIds = new Set([stage.boss?.bossId, ...(stage.boss?.supportBossIds ?? [])].filter(Boolean));
      for (const placement of stage.enemies) {
        if (rule.target === "boss" && !bossIds.has(placement.enemyId)) continue;
        const enemy = enemyCatalog[placement.enemyId];
        if (enemy) enemyCatalog[placement.enemyId] = withEnemyStats(enemy, rule.value / 100, 1);
      }
    } else if (rule.kind === "enemyCountdownDelta") {
      for (const placement of stage.enemies) {
        const enemy = enemyCatalog[placement.enemyId];
        if (enemy) enemyCatalog[placement.enemyId] = { ...enemy, attackCountdown: Math.max(1, enemy.attackCountdown + rule.value) };
      }
    } else if (rule.kind === "hazardPercent") {
      stage = scaleOrAddHazard(stage, rule.hazard, rule.value / 100);
    } else if (rule.kind === "previewBounceLimit") {
      previewReflections = previewReflections === undefined ? rule.value : Math.min(previewReflections, rule.value);
      stage = { ...stage, modifiers: replacePreviewModifier(stage.modifiers, rule.value) };
    } else if (rule.kind === "wallHpPercent") {
      const hasBreakableWall = stage.walls.some((wall) => wall.breakable);
      stage = { ...stage, walls: stage.walls.map((wall, index) => wall.breakable || (!hasBreakableWall && index === 0)
        ? { ...wall, breakable: true, hp: Math.max(1, Math.round((wall.hp ?? 100) * rule.value / 100)) }
        : wall) };
    } else if (rule.kind === "weakpointHpPercent") {
      config.weakpointHpRatio = 0.14 * rule.value / 100;
    } else if (rule.kind === "healingPercent") {
      party = party.map((hero) => scaleHeroHealing(hero, rule.value / 100));
    } else if (rule.kind === "forbidClass") {
      const blocked = party.find((hero) => hero.ricochetClass === rule.value);
      if (blocked) throw new Error(`Forbidden endgame class cannot enter: ${blocked.ricochetClass}`);
    } else if (rule.kind === "friendshipDisabled") {
      party = party.map((hero) => ({ ...hero, friendshipSkill: { ...hero.friendshipSkill, effects: [] } }));
    } else if (rule.kind === "activeSkillsDisabled") {
      party = party.map((hero) => ({ ...hero, activeSkill: { ...hero.activeSkill, chargeTurns: 999, effects: [] } }));
    } else if (rule.kind === "weakpointOnly") {
      config.weakpointDamageMultiplier = 2.4;
      config.weakpointHpRatio = config.weakpointHpRatio ?? 0.12;
    } else if (rule.kind === "portalExitHidden") {
      let portalIndex = 0;
      stage = {
        ...stage,
        modifiers: stage.modifiers.filter((modifier) => modifier !== "portal-preview-one-exit"),
        hazards: stage.hazards.map((hazard) => hazard.type === "portal"
          ? { ...hazard, parameters: { ...hazard.parameters, hiddenExit: portalIndex++ % 2 === 1 } }
          : hazard),
      };
    } else if (rule.kind === "lightningWarningTurns") {
      stage = { ...stage, hazards: stage.hazards.map((hazard) => hazard.type === "lightning" ? { ...hazard, parameters: { ...hazard.parameters, warningTurns: rule.value } } : hazard) };
    } else if (rule.kind === "lightningExtraStrikes") {
      stage = { ...stage, hazards: stage.hazards.map((hazard) => hazard.type === "lightning"
        ? { ...hazard, parameters: { ...hazard.parameters, strikes: Math.max(1, Number(hazard.parameters.strikes ?? 1)) + rule.value } }
        : hazard) };
    } else if (rule.kind === "forbiddenRadius") {
      stage = scaleForbiddenRadius(stage, rule.value);
    } else if (rule.kind === "protectTargetHpPercent") {
      protectTargetHpPercent = rule.value;
    } else if (rule.kind === "reinforcementTurn") {
      reinforcementTurn = rule.value;
      config.reinforcementTurnOverride = rule.value;
      if (!stage.modifiers.includes("reinforcement-at-turn-six")) {
        stage = { ...stage, modifiers: [...stage.modifiers, "reinforcement-at-turn-six"] };
      }
    } else if (rule.kind === "partyStatPercent") {
      const multiplier = rule.value / 100;
      party = party.map((hero) => withHeroStats(
        hero,
        rule.stat === "hp" ? multiplier : 1,
        rule.stat === "attack" ? multiplier : 1,
        rule.stat === "speed" ? multiplier : 1,
      ));
    } else if (rule.kind === "maxBounces") {
      config.maxBounces = Math.max(config.maxBounces ?? 0, Math.max(1, Math.round(rule.value)));
    } else if (rule.kind === "mirrorWalls") {
      const count = Math.max(1, Math.min(4, Math.round(rule.value)));
      const additions = Array.from({ length: count }, (_, index) => ({
        id: `blessing-mirror-wall-${index + 1}`,
        type: "one-way-wall" as const,
        x: stage.arena.width * ((index + 1) / (count + 1)),
        y: stage.arena.height * (index % 2 === 0 ? 0.46 : 0.62),
        radius: 58,
        parameters: { allowedAngle: index % 2 === 0 ? 45 : 225, rotateEachTurn: 45 },
      }));
      stage = { ...stage, hazards: [...stage.hazards, ...additions] };
    } else if (rule.kind === "runtimeRelicEffect") {
      party = party.map((hero) => ({
        ...hero,
        runtimeRelicEffects: [
          ...(hero.runtimeRelicEffects ?? []),
          {
            kind: rule.effectKind,
            value: rule.value,
            target: rule.target,
            sourceId: rule.sourceId,
            sourceLevel: 1,
          },
        ],
      }));
    } else if (rule.kind === "oneWayWallsFast") {
      stage = {
        ...stage,
        hazards: stage.hazards.map((hazard) => hazard.type === "one-way-wall"
          ? { ...hazard, parameters: { ...hazard.parameters, allowedAngle: Number(hazard.parameters.allowedAngle ?? 0), rotateEachTurn: Math.max(90, Number(hazard.parameters.rotateEachTurn ?? 0)) } }
          : hazard),
      };
    } else if (rule.kind === "shieldRearWindow") {
      if (!stage.modifiers.includes("rear-hit-critical")) stage = { ...stage, modifiers: [...stage.modifiers, "rear-hit-critical"] };
      config.criticalMultiplier = Math.max(config.criticalMultiplier ?? 1.5, 1 + rule.value / 100);
    } else if (rule.kind === "hideCrystalOrderAfterFirst") {
      hideCrystalOrderAfterFirst = true;
    } else if (rule.kind === "resurrectionDisabled") {
      party = party.map((hero) => ({ ...hero, activeSkill: { ...hero.activeSkill, effects: hero.activeSkill.effects.filter((effect) => effect.kind !== "revive") } }));
    } else if (rule.kind === "twoRouteModifiers") {
      for (const placement of stage.enemies) {
        const enemy = enemyCatalog[placement.enemyId];
        if (enemy) enemyCatalog[placement.enemyId] = withEnemyStats(enemy, 1.12, 1);
      }
      stage = scaleOrAddHazard(stage, "whirlpool", 1.15);
    } else if (rule.kind === "weeklyScoreEnabled") {
      weeklyScoreEnabled = true;
    } else if (rule.kind === "requireFullParty") {
      if (party.length < 3) throw new Error("Storm Route requires a full three-hero party.");
    } else if (rule.kind === "fallenHeroLock") {
      const fallen = new Set(fallenHeroIds);
      const invalid = party.find((hero) => fallen.has(hero.id));
      if (invalid) throw new Error(`Fallen Storm Route hero cannot enter: ${invalid.id}`);
    }
  }
  return { stage, party, enemyCatalog, config, previewReflections, protectTargetHpPercent, hideCrystalOrderAfterFirst, reinforcementTurn, weeklyScoreEnabled };
}

function applyRaidPhase(stage: StageDefinition, phaseIndex: number, carryForward: readonly string[]): StageDefinition {
  const phase = ENDGAME.raid.phases[phaseIndex]!;
  const targetIds = new Set(phase.objective.targetIds);
  const removedPartIds = new Set<string>();
  if (carryForward.includes("broken-forepaws")) removedPartIds.add("scylla-forepaws");
  if (carryForward.includes("staggered-head-count")) {
    removedPartIds.add("scylla-heads");
    removedPartIds.add("scylla-necks");
  }
  const boss = stage.boss ? {
    ...stage.boss,
    parts: stage.boss.parts
      .filter((part) => !removedPartIds.has(part.id))
      .map((part) => targetIds.has(part.id)
        ? { ...part, weakpoint: true, breakable: true }
        : { ...part, weakpoint: false }),
  } : null;
  let hazards = [...stage.hazards];
  if (phaseIndex > 0 && carryForward.includes("opened-safe-bumper")) {
    hazards = hazards.filter((hazard) => hazard.id !== "six-bite-fans" || phaseIndex === 1);
    hazards.push({
      id: `raid-safe-bumper-${phaseIndex}`,
      type: "moving-bumper",
      x: 360,
      y: 610,
      radius: 34,
      parameters: { distance: 150, periodTurns: 3, axis: "x" },
    });
  }
  return {
    ...stage,
    name: `${phase.party}페이즈 · ${phase.name}`,
    objective: clone(phase.objective),
    boss,
    hazards,
    modifiers: phaseIndex === 1
      ? stage.modifiers
      : stage.modifiers.filter((modifier) => modifier !== "exact-six-head-chain"),
  };
}

function scaleOrAddHazard(stage: StageDefinition, type: StageDefinition["hazards"][number]["type"], multiplier: number): StageDefinition {
  let found = false;
  const hazards = stage.hazards.map((hazard) => {
    const matches = hazard.type === type
      || (type === "wind-vector" && hazard.type === "current");
    if (!matches) return hazard;
    found = true;
    const parameters = { ...hazard.parameters };
    if (type === "slow-field") {
      const base = Number(parameters.speedMultiplier ?? 0.75);
      parameters.speedMultiplier = Math.max(0.1, 1 - (1 - base) * multiplier);
    } else if (type === "moving-bumper") {
      parameters.distance = Math.max(1, Math.round(Number(parameters.distance ?? 120) * multiplier));
      parameters.periodTurns = Math.max(1, Math.round(Number(parameters.periodTurns ?? 4) / multiplier));
    } else if (type === "wind-vector") {
      parameters.forceX = Math.round(Number(parameters.forceX ?? 100) * multiplier);
      parameters.forceY = Math.round(Number(parameters.forceY ?? 0) * multiplier);
    } else if (type === "sound-wave") {
      parameters.expansion = Math.max(1, Math.round(Number(parameters.expansion ?? 90) * multiplier));
      parameters.periodTurns = Math.max(1, Math.round(Number(parameters.periodTurns ?? 2) / multiplier));
    } else if (type === "whirlpool") {
      parameters.force = Math.max(1, Math.round(Number(parameters.force ?? 100) * multiplier));
    }
    return { ...hazard, parameters };
  });
  if (!found) {
    const parameters: Record<string, number | string | boolean> = type === "slow-field"
      ? { speedMultiplier: Math.max(0.1, 1 - 0.25 * multiplier) }
      : type === "moving-bumper"
        ? { distance: Math.round(120 * multiplier), periodTurns: Math.max(1, Math.round(4 / multiplier)), axis: "x" }
        : type === "wind-vector"
          ? { forceX: Math.round(100 * multiplier), forceY: 0 }
          : type === "sound-wave"
            ? { expansion: Math.round(90 * multiplier), periodTurns: Math.max(1, Math.round(2 / multiplier)), damage: 55 }
            : { force: Math.round(100 * multiplier) };
    hazards.push({
      id: `endgame-${type}`,
      type,
      x: stage.arena.width / 2,
      y: stage.arena.height / 2,
      radius: type === "whirlpool" ? 170 : 120,
      parameters,
    });
  }
  return { ...stage, hazards };
}

function scaleForbiddenRadius(stage: StageDefinition, radius: number): StageDefinition {
  const hazards = stage.hazards.map((hazard) => hazard.type === "forbidden-target" ? { ...hazard, radius } : hazard);
  if (hazards.some((hazard) => hazard.type === "forbidden-target")) return { ...stage, hazards };
  return { ...stage, hazards: [...hazards, { id: "endgame-forbidden", type: "forbidden-target", x: stage.arena.width / 2, y: stage.arena.height / 2, radius, parameters: {} }] };
}

function replacePreviewModifier(modifiers: readonly string[], value: number): string[] {
  return [...modifiers.filter((modifier) => !modifier.startsWith("preview-bounces:")), `preview-bounces:${Math.max(0, Math.min(8, value))}`];
}

function scaleHeroHealing(hero: HeroDefinition, multiplier: number): HeroDefinition {
  const scale = (effects: HeroDefinition["friendshipSkill"]["effects"]) => effects.map((effect) =>
    effect.kind === "heal" || effect.kind === "regeneration"
      ? { ...effect, value: Math.max(0, Math.round(effect.value * multiplier)) }
      : effect,
  ).filter((effect) => !(multiplier === 0 && (effect.kind === "heal" || effect.kind === "regeneration")));
  return {
    ...hero,
    friendshipSkill: { ...hero.friendshipSkill, effects: scale(hero.friendshipSkill.effects) },
    activeSkill: { ...hero.activeSkill, effects: scale(hero.activeSkill.effects) },
  };
}

function withEnemyStats(enemy: EnemyDefinition, hp: number, attack: number): EnemyDefinition {
  return { ...enemy, stats: { ...enemy.stats, hp: Math.max(1, Math.round(enemy.stats.hp * hp)), attack: Math.max(1, Math.round(enemy.stats.attack * attack)) } };
}

function withHeroStats(hero: HeroDefinition, hp: number, attack: number, speed: number): HeroDefinition {
  return { ...hero, stats: { hp: Math.max(1, Math.round(hero.stats.hp * hp)), attack: Math.max(1, Math.round(hero.stats.attack * attack)), speed: Math.max(1, Math.round(hero.stats.speed * speed)) } };
}

function ruleLabel(rule: EndgameOverrideRule): string {
  if (rule.kind === "enemyHpPercent") return `${rule.target === "boss" ? "보스" : rule.target === "elite" ? "정예" : "적"} HP ${rule.value}%`;
  if (rule.kind === "enemyCountdownDelta") return `적 카운트 ${rule.value}`;
  if (rule.kind === "hazardPercent") return `${rule.hazard} ${rule.value}%`;
  if (rule.kind === "previewBounceLimit") return `예상 반사 ${rule.value}회`;
  if (rule.kind === "forbidClass") return `${rule.value} 출전 금지`;
  if (rule.kind === "activeSkillsDisabled") return "액티브 스킬 봉인";
  if (rule.kind === "friendshipDisabled") return "우정 스킬 봉인";
  if (rule.kind === "weakpointOnly") return "약점 공략 강화";
  if (rule.kind === "partyStatPercent") return `파티 ${rule.stat.toUpperCase()} ${rule.value}%`;
  if (rule.kind === "maxBounces") return `최대 반사 ${rule.value}회`;
  if (rule.kind === "mirrorWalls") return `거울벽 ${rule.value}개 생성`;
  if (rule.kind === "runtimeRelicEffect") return `${rule.effectKind} ${rule.value}`;
  return rule.kind;
}

export function describeEndgameRuleSources(sources: readonly string[]): readonly string[] {
  const labels = sources.flatMap((source) => {
    const blessing = BLESSING_BY_ID[source];
    if (blessing) return [`가호 · ${blessing.name}: ${describeBlessingEffects(source)}`];
    const rule = compileEndgameRule(source);
    return rule ? [ruleLabel(rule)] : [source.replaceAll("-", " ")];
  });
  return [...new Set(labels)];
}

export function describeBlessingEffects(blessingId: string): string {
  const blessing = BLESSING_BY_ID[blessingId];
  if (!blessing) return blessingId;
  const labels: Readonly<Record<string, string>> = {
    "preview-bounces": "예상 반사",
    "party-speed": "파티 발사 속도",
    "party-attack": "파티 공격",
    "protect-target-hp": "보호 대상 체력",
    "rear-hit-damage": "후방 피해",
    "stationary-guard": "대기 중 피해 감소",
    "first-countdown-delay": "첫 적 공격 지연",
    "precision-chain": "연속 약점 피해",
    "friendship-radius": "우정 접촉 범위",
    "first-shot-speed": "첫 발사 속도",
    "active-charge-speed": "액티브 충전 속도",
    regeneration: "턴 시작 최저 체력 회복",
    "burn-damage": "화상 피해",
    "weakpoint-damage": "약점 피해",
    "chain-lightning": "3번째 접촉 연쇄번개",
    "wind-force-reduction": "바람·해류 저항",
    "wall-damage": "파괴 벽 피해",
    "whirlpool-resistance": "소용돌이 저항",
    "debuff-duration": "약화 지속시간",
    "route-revive": "최초 전투불능 부활 체력",
    "rear-hit-multiplier": "후방 피해",
    "first-hit-barrier": "첫 피격 보호막",
    "first-contact-stun": "첫 접촉 기절",
    "preview-perfect": "완전 예상선",
    "combo-damage": "연쇄 피해",
    "launch-speed": "발사 속도",
    "friendship-repeat": "첫 우정기 반복",
    "portal-exit-speed": "차원문 이탈 속도",
    "active-charge-on-ally-hit": "아군 접촉 충전",
    "max-bounces": "최대 반사",
    "per-bounce-damage": "반사당 피해",
    "heal-after-wave": "파동 종료 회복",
    "burn-on-weakpoint": "약점 화상",
    "weakpoint-radius": "약점 반경",
    "protect-objective-guard": "보호 대상 피해 감소",
    "solar-ring-on-combo": "10연쇄 태양륜",
    "wind-resistance": "바람 저항",
    "wall-hit-gust": "세 번째 벽 충돌 돌풍",
    restitution: "반발력",
    "hazard-immunity": "첫 2초 위험 면역",
    "change-wind-on-bounce": "반사 시 바람 전환",
    "debuff-resistance": "약화 저항",
    "impact-clone": "첫 충돌 분신",
    "enemy-radius-down": "적 크기 감소",
    "reverse-enemy-facing": "방패 방향 반전",
    "mirror-wall-count": "거울벽",
    "mirror-damage": "거울 추가 피해",
    "turn-start-heal": "턴 시작 회복",
    "lethal-guard": "최초 전투불능 방지",
    "wall-contact-bind": "벽 접촉 속박",
    "per-turn-attack": "턴당 공격 증가",
    "party-regeneration": "파티 재생",
    "countdown-delay": "적 카운트 지연",
  };
  return blessing.effects.map((effect) => {
    if (effect.kind === "preview-bounces") {
      const bonus = Math.max(0, Math.round(effect.value));
      return `예상 반사 +${bonus}회 (총 ${bonus + 1}회)`;
    }
    const duration = effect.durationTurns ? ` · ${effect.durationTurns}턴` : "";
    const percentKinds = new Set([
      "rear-hit-multiplier", "first-hit-barrier", "combo-damage", "launch-speed", "friendship-repeat",
      "portal-exit-speed", "per-bounce-damage", "burn-on-weakpoint", "weakpoint-radius", "protect-objective-guard",
      "wind-resistance", "restitution", "debuff-resistance", "impact-clone", "enemy-radius-down", "mirror-damage",
      "per-turn-attack", "party-regeneration", "party-speed", "party-attack", "protect-target-hp", "rear-hit-damage",
      "stationary-guard", "precision-chain", "friendship-radius", "first-shot-speed", "active-charge-speed",
      "burn-damage", "weakpoint-damage", "chain-lightning", "wind-force-reduction", "wall-damage",
      "whirlpool-resistance", "route-revive",
    ]);
    const value = percentKinds.has(effect.kind) ? `${effect.value}%` : String(effect.value);
    return `${labels[effect.kind] ?? effect.kind} ${value}${duration}`;
  }).join(" / ");
}

function objectiveLabel(stage: StageDefinition): string {
  const names: Readonly<Record<string, string>> = {
    "defeat-all": "모든 적 격파",
    "break-parts": "부위 파괴",
    assemble: "조립",
    survive: "생존",
    protect: "보호",
    seal: "봉인",
    escape: "탈출",
  };
  return `${names[stage.objective.type] ?? stage.objective.type} · ${stage.objective.turnLimit}턴`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
