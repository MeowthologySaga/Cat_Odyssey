import type { StageDefinition } from "../../data/types";

export const STAGE_MODIFIER_CATEGORIES = [
  "trajectory",
  "objective",
  "hazard",
  "wall",
  "boss",
  "enemy",
  "status",
  "formation",
  "sequence",
  "presentation",
] as const;

export type StageModifierCategory = (typeof STAGE_MODIFIER_CATEGORIES)[number];

export type TrajectoryModifierFlag =
  | "previewBounceLimit"
  | "portalPreviewExitCount"
  | "portalElementChangesWallCollision"
  | "excludeCattleFromAutoTarget"
  | "disableControlLock"
  | "rearHitCritical"
  | "exactSoundWaveCollision"
  | "mirrorTrajectoryOnWrongWall";

export type ObjectiveModifierFlag =
  | "protectedTargetsMoveAfterShot"
  | "protectedTargetHpPerExtraHero"
  | "exitUnlocksAfterBruteStaggers"
  | "forbiddenTargetContactFailsStage"
  | "protectedMemoryDamagedOnEnemyAction"
  | "sealDirectionHitCount"
  | "sealRequiredAngleCount"
  | "sealColorCount";

export type HazardModifierFlag =
  | "boulderDamagesAllTeams"
  | "charybdisSupportHazard"
  | "anchorHitsReduceSuction"
  | "lightningPatternChangesPerPhase"
  | "movingBumperBeforeEnemyPhase"
  | "safeLaneShiftsEachTurn"
  | "windSpeedRisesPerPhase";

export type WallModifierFlag =
  | "breakableWallOpensRearRoute"
  | "bronzeWallsGroundLightning"
  | "gateChangesSolidState"
  | "gatesShiftAfterShot"
  | "pillarsShiftInPhaseTwo"
  | "spiritWallsPhaseCadence"
  | "wallsRotateAfterShot";

export type BossModifierFlag =
  | "cannotBeKilled"
  | "minimumHp"
  | "phaseHpThresholdPercent"
  | "eyeOpensAfterRearHit"
  | "finalBoss"
  | "forepawsOpenSafeLane"
  | "survivalBoss";

export type EnemyModifierFlag =
  | "disguiseFirstShotNoAggro"
  | "reinforcementTurn";

export type StatusModifierFlag =
  | "allyContactCleansesSleep"
  | "allyHitRemovesStack"
  | "sizeChangesCollider"
  | "sleepStackThreshold"
  | "wineAffectsBothTeams";

export type FormationModifierFlag =
  | "fatherSonLinkOpensCore"
  | "furnitureMovesAfterCollision"
  | "furnitureRearrangesEachPhase"
  | "rearHitBreaksFormation"
  | "shieldFormationSharesFacing"
  | "shieldFrontDamageReductionPercent";

export type SequenceModifierFlag =
  | "crystalsRequireLitOrder"
  | "exactHeadChainCount"
  | "interruptSongInOrder"
  | "missResetsChain"
  | "singleShotAllRings";

export type PresentationModifierFlag =
  | "showHazardVector"
  | "showOneWayWallArrows"
  | "showSlowField"
  | "showSuctionVector"
  | "showWindVector"
  | "tutorialMode";

export type StageModifierParameter =
  | { readonly kind: "count"; readonly value: number }
  | { readonly kind: "percent"; readonly value: number }
  | { readonly kind: "turn"; readonly value: number }
  | { readonly kind: "hitPoints"; readonly value: number }
  | { readonly kind: "cadenceTurns"; readonly value: number }
  | { readonly kind: "identifier"; readonly value: string };

interface StageModifierEffectBase<C extends StageModifierCategory, F extends string> {
  readonly category: C;
  readonly flag: F;
  readonly parameter?: StageModifierParameter;
}

export type TrajectoryModifierEffect = StageModifierEffectBase<"trajectory", TrajectoryModifierFlag>;
export type ObjectiveModifierEffect = StageModifierEffectBase<"objective", ObjectiveModifierFlag>;
export type HazardModifierEffect = StageModifierEffectBase<"hazard", HazardModifierFlag>;
export type WallModifierEffect = StageModifierEffectBase<"wall", WallModifierFlag>;
export type BossModifierEffect = StageModifierEffectBase<"boss", BossModifierFlag>;
export type EnemyModifierEffect = StageModifierEffectBase<"enemy", EnemyModifierFlag>;
export type StatusModifierEffect = StageModifierEffectBase<"status", StatusModifierFlag>;
export type FormationModifierEffect = StageModifierEffectBase<"formation", FormationModifierFlag>;
export type SequenceModifierEffect = StageModifierEffectBase<"sequence", SequenceModifierFlag>;
export type PresentationModifierEffect = StageModifierEffectBase<"presentation", PresentationModifierFlag>;

export type StageModifierEffect =
  | TrajectoryModifierEffect
  | ObjectiveModifierEffect
  | HazardModifierEffect
  | WallModifierEffect
  | BossModifierEffect
  | EnemyModifierEffect
  | StatusModifierEffect
  | FormationModifierEffect
  | SequenceModifierEffect
  | PresentationModifierEffect;

export type StageModifierEffectFor<C extends StageModifierCategory> = Extract<
  StageModifierEffect,
  { readonly category: C }
>;

export interface RecognizedStageModifier {
  readonly recognized: true;
  readonly source: string;
  /** Stable family key; parameterized modifiers omit their authored value here. */
  readonly key: string;
  readonly parameterized: boolean;
  readonly effects: readonly StageModifierEffect[];
}

export interface UnsupportedStageModifier {
  readonly recognized: false;
  readonly source: string;
  readonly reason: string;
  readonly effects: readonly [];
}

export type CompiledStageModifier = RecognizedStageModifier | UnsupportedStageModifier;

export type StageModifierEffectsByCategory = {
  readonly [C in StageModifierCategory]: readonly StageModifierEffectFor<C>[];
};

export interface StageModifierCompilation {
  readonly recognized: boolean;
  readonly modifiers: readonly CompiledStageModifier[];
  readonly unsupported: readonly UnsupportedStageModifier[];
  readonly effects: readonly StageModifierEffect[];
  readonly byCategory: StageModifierEffectsByCategory;
}

export interface StageDefinitionModifierCompilation extends StageModifierCompilation {
  readonly stageId: string;
}

type ExactModifierRegistry = Readonly<Record<string, readonly StageModifierEffect[]>>;

/**
 * Closed registry for non-parameterized authored modifiers. Adding a new content
 * string without adding a concrete effect here intentionally produces an
 * unsupported compilation result.
 */
export const EXACT_STAGE_MODIFIER_REGISTRY = {
  "ally-contact-cleanses-sleep": [effect("status", "allyContactCleansesSleep")],
  "ally-hit-removes-stack": [effect("status", "allyHitRemovesStack")],
  "boss-cannot-be-killed": [effect("boss", "cannotBeKilled")],
  "boss-hp-stops-at-one": [effect("boss", "minimumHp", hitPoints(1))],
  "boulder-damages-all-teams": [effect("hazard", "boulderDamagesAllTeams")],
  "breakable-wall-opens-rear-route": [effect("wall", "breakableWallOpensRearRoute")],
  "bronze-walls-ground-lightning": [effect("wall", "bronzeWallsGroundLightning")],
  "cattle-moves-after-shot": [effect("objective", "protectedTargetsMoveAfterShot")],
  "charybdis-support-hazard": [effect("hazard", "charybdisSupportHazard")],
  "crystals-must-break-in-lit-order": [effect("sequence", "crystalsRequireLitOrder")],
  "disguise-first-shot-no-aggro": [effect("enemy", "disguiseFirstShotNoAggro")],
  "exact-six-head-chain": [effect("sequence", "exactHeadChainCount", count(6))],
  "exit-opens-after-one-brute-stagger": [
    effect("objective", "exitUnlocksAfterBruteStaggers", count(1)),
  ],
  "eye-opens-after-rear-hit": [effect("boss", "eyeOpensAfterRearHit")],
  "father-son-link-opens-core": [effect("formation", "fatherSonLinkOpensCore")],
  "final-boss": [effect("boss", "finalBoss")],
  "forbidden-target-contact-fails-stage": [
    effect("objective", "forbiddenTargetContactFailsStage"),
  ],
  "forepaws-open-safe-lane": [effect("boss", "forepawsOpenSafeLane")],
  "furniture-moves-after-collision": [effect("formation", "furnitureMovesAfterCollision")],
  "furniture-rearranges-each-phase": [effect("formation", "furnitureRearrangesEachPhase")],
  "gate-changes-solid-state": [effect("wall", "gateChangesSolidState")],
  "gates-shift-after-shot": [effect("wall", "gatesShiftAfterShot")],
  "hazard-vector-visible": [effect("presentation", "showHazardVector")],
  "hit-anchors-to-reduce-suction": [effect("hazard", "anchorHitsReduceSuction")],
  "interrupt-song-in-order": [effect("sequence", "interruptSongInOrder")],
  "lightning-pattern-changes-phase": [effect("hazard", "lightningPatternChangesPerPhase")],
  "miss-resets-chain": [effect("sequence", "missResetsChain")],
  "moving-bumper-before-enemy-phase": [effect("hazard", "movingBumperBeforeEnemyPhase")],
  "no-auto-target-cattle": [effect("trajectory", "excludeCattleFromAutoTarget")],
  "no-control-lock": [effect("trajectory", "disableControlLock")],
  "one-way-wall-arrows-visible": [effect("presentation", "showOneWayWallArrows")],
  "pillars-shift-phase-two": [effect("wall", "pillarsShiftInPhaseTwo")],
  "portal-element-changes-wall-collision": [
    effect("trajectory", "portalElementChangesWallCollision"),
  ],
  "portal-preview-one-exit": [effect("trajectory", "portalPreviewExitCount", count(1))],
  "protected-memory-loses-hp-on-enemy-action": [
    effect("objective", "protectedMemoryDamagedOnEnemyAction"),
  ],
  "rear-hit-breaks-formation": [effect("formation", "rearHitBreaksFormation")],
  "rear-hit-critical": [effect("trajectory", "rearHitCritical")],
  "reinforcement-at-turn-six": [effect("enemy", "reinforcementTurn", turn(6))],
  "safe-lane-shifts-each-turn": [effect("hazard", "safeLaneShiftsEachTurn")],
  "seal-on-four-direction-hits": [effect("objective", "sealDirectionHitCount", count(4))],
  "seal-requires-three-angles": [effect("objective", "sealRequiredAngleCount", count(3))],
  "shield-formation-shares-facing": [effect("formation", "shieldFormationSharesFacing")],
  "single-shot-all-rings": [effect("sequence", "singleShotAllRings")],
  "size-changes-collider": [effect("status", "sizeChangesCollider")],
  "sleep-at-three-stacks": [effect("status", "sleepStackThreshold", count(3))],
  "slow-field-visible": [effect("presentation", "showSlowField")],
  "sound-wave-collision-exact": [effect("trajectory", "exactSoundWaveCollision")],
  "spirit-walls-phase-every-other-turn": [
    effect("wall", "spiritWallsPhaseCadence", cadenceTurns(2)),
  ],
  "suction-vector-visible": [effect("presentation", "showSuctionVector")],
  "survival-boss": [effect("boss", "survivalBoss")],
  "three-color-seal": [effect("objective", "sealColorCount", count(3))],
  "walls-rotate-after-shot": [effect("wall", "wallsRotateAfterShot")],
  "wind-speed-rises-per-phase": [effect("hazard", "windSpeedRisesPerPhase")],
  "wind-vector-visible": [effect("presentation", "showWindVector")],
  "wine-affects-both-teams": [effect("status", "wineAffectsBothTeams")],
  "wrong-wall-mirrors-trajectory": [effect("trajectory", "mirrorTrajectoryOnWrongWall")],
} as const satisfies ExactModifierRegistry;

export function compileStageModifier(source: string): CompiledStageModifier {
  const exact = EXACT_STAGE_MODIFIER_REGISTRY[source as keyof typeof EXACT_STAGE_MODIFIER_REGISTRY];
  if (exact) return recognized(source, source, false, exact);

  const previewBounces = integerParameter(source, /^preview-bounces:(\d+)$/, 0, 8);
  if (previewBounces !== undefined) {
    return recognized(source, "preview-bounces", true, [
      effect("trajectory", "previewBounceLimit", count(previewBounces)),
    ]);
  }

  const bossPhase = integerParameter(source, /^boss-phase-at:(\d+)$/, 1, 99);
  if (bossPhase !== undefined) {
    return recognized(source, "boss-phase-at", true, [
      effect("boss", "phaseHpThresholdPercent", percent(bossPhase)),
    ]);
  }

  const shieldReduction = integerParameter(source, /^shield-front-reduction:(\d+)$/, 0, 100);
  if (shieldReduction !== undefined) {
    return recognized(source, "shield-front-reduction", true, [
      effect("formation", "shieldFrontDamageReductionPercent", percent(shieldReduction)),
    ]);
  }

  const protectedTargetHpPerExtraHero = integerParameter(
    source,
    /^protect-target-hp-per-extra-hero:(\d+)$/,
    0,
    5000,
  );
  if (protectedTargetHpPerExtraHero !== undefined) {
    return recognized(source, "protect-target-hp-per-extra-hero", true, [
      effect("objective", "protectedTargetHpPerExtraHero", hitPoints(protectedTargetHpPerExtraHero)),
    ]);
  }

  if (source === "tutorial:direct-hit") {
    return recognized(source, "tutorial", true, [
      effect("presentation", "tutorialMode", identifier("direct-hit")),
    ]);
  }

  return {
    recognized: false,
    source,
    reason: `Unsupported stage modifier: ${source || "<empty>"}`,
    effects: [],
  };
}

export function compileStageModifiers(modifiers: readonly string[]): StageModifierCompilation {
  const compiled = modifiers.map(compileStageModifier);
  const unsupported = compiled.filter(
    (modifier): modifier is UnsupportedStageModifier => !modifier.recognized,
  );
  const effects = compiled.flatMap((modifier) => modifier.effects);
  return {
    recognized: unsupported.length === 0,
    modifiers: compiled,
    unsupported,
    effects,
    byCategory: groupEffectsByCategory(effects),
  };
}

export function compileStageDefinitionModifiers(
  stage: Pick<StageDefinition, "id" | "modifiers">,
): StageDefinitionModifierCompilation {
  return { stageId: stage.id, ...compileStageModifiers(stage.modifiers) };
}

export function assertStageModifiersRecognized(
  modifiers: readonly string[],
  context = "stage",
): StageModifierCompilation {
  const compilation = compileStageModifiers(modifiers);
  if (!compilation.recognized) {
    const sources = compilation.unsupported.map((modifier) => modifier.source).join(", ");
    throw new Error(`${context} contains unsupported modifiers: ${sources}`);
  }
  return compilation;
}

export function stageModifierEffectsFor<C extends StageModifierCategory>(
  compilation: StageModifierCompilation,
  category: C,
): readonly StageModifierEffectFor<C>[] {
  return compilation.byCategory[category];
}

export function findStageModifierEffect<C extends StageModifierCategory>(
  compilation: StageModifierCompilation,
  category: C,
  flag: StageModifierEffectFor<C>["flag"],
): StageModifierEffectFor<C> | undefined {
  return compilation.byCategory[category].find((candidate) => candidate.flag === flag);
}

function groupEffectsByCategory(
  effects: readonly StageModifierEffect[],
): StageModifierEffectsByCategory {
  const groups: { [C in StageModifierCategory]: StageModifierEffectFor<C>[] } = {
    trajectory: [],
    objective: [],
    hazard: [],
    wall: [],
    boss: [],
    enemy: [],
    status: [],
    formation: [],
    sequence: [],
    presentation: [],
  };
  for (const modifierEffect of effects) {
    // The discriminated category guarantees the corresponding bucket type.
    (groups[modifierEffect.category] as StageModifierEffect[]).push(modifierEffect);
  }
  return groups;
}

function recognized(
  source: string,
  key: string,
  parameterized: boolean,
  effects: readonly StageModifierEffect[],
): RecognizedStageModifier {
  return { recognized: true, source, key, parameterized, effects };
}

function effect<C extends StageModifierCategory>(
  category: C,
  flag: StageModifierEffectFor<C>["flag"],
  parameter?: StageModifierParameter,
): StageModifierEffectFor<C> {
  return parameter ? { category, flag, parameter } as StageModifierEffectFor<C> : { category, flag } as StageModifierEffectFor<C>;
}

function integerParameter(
  source: string,
  pattern: RegExp,
  minimum: number,
  maximum: number,
): number | undefined {
  const match = source.match(pattern);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

function count(value: number): StageModifierParameter {
  return { kind: "count", value };
}

function percent(value: number): StageModifierParameter {
  return { kind: "percent", value };
}

function turn(value: number): StageModifierParameter {
  return { kind: "turn", value };
}

function hitPoints(value: number): StageModifierParameter {
  return { kind: "hitPoints", value };
}

function cadenceTurns(value: number): StageModifierParameter {
  return { kind: "cadenceTurns", value };
}

function identifier(value: string): StageModifierParameter {
  return { kind: "identifier", value };
}
