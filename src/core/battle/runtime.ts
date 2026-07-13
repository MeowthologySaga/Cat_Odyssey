import type {
  BossPartDefinition,
  DataEffect,
  EnemyBehaviorDefinition,
  EnemyDefinition,
  HeroDefinition,
  RuntimeRelicEffect,
  SpawnDefinition,
  StageDefinition,
} from "../../data/types";
import { relicEffectValue } from "../meta/relicEffectResolver";
import {
  capHeroContactDamage,
  classDamageMultiplier,
  resolveHeroImpactFormula,
  RICOCHET_PHYSICS_PROFILES,
  type HeroImpactFormulaResult,
} from "./combatFormula";
import {
  add,
  clamp,
  distanceToSegmentSquared,
  expandedColliderContainsPoint,
  hashSeed,
  lerp as lerpVec,
  normalize,
  reflectVelocity,
  scale,
  traceRicochet,
  vec2,
  type Collider,
  type RicochetTraceResult,
  type TraceCollision,
  type Vec2,
} from "../../simulation";
import {
  BATTLE_SNAPSHOT_VERSION,
  type BattleActiveSkillCommand,
  type BattleActiveSkillPreview,
  type BattleActionAvailability,
  type AimCommand,
  type AimState,
  type BattleEnemyState,
  type BattleEnemyActionOutcome,
  type BattleEnemyIntentBlockReason,
  type BattleEnemyIntentKind,
  type BattleEnemyIntentState,
  type BattleEvent,
  type BattleEventType,
  type BattleHazardState,
  type BattleLaunchPreview,
  type BattleObjectiveProgressState,
  type BattleObjectiveTargetState,
  type BattleOutcomeReason,
  type BattlePartyMemberState,
  type BattleProjectileState,
  type BattlePropState,
  type BattleRuntimeConfig,
  type BattleSetup,
  type BattleSnapshot,
  type BattleStageModifierState,
  type BattleStatusEffectState,
  type BattleTrajectory,
  type BattleTrajectoryContact,
  type BattleVictoryRule,
  type BattleWallState,
  type BattleWeakpointSetup,
  type BattleWeakpointState,
  type TrajectoryTargetKind,
} from "./types";
import {
  compileStageDefinitionModifiers,
  type StageDefinitionModifierCompilation,
  type StageModifierCategory,
  type StageModifierEffectFor,
} from "./stageModifiers";
import {
  firstAvailableNonBossEnemy,
  SCRIPTED_REINFORCEMENT_CANDIDATE_IDS,
  summonCandidateIdsForAttackKind,
} from "./dynamicEnemyContract";
import { isSoundWaveContactSafe } from "./soundWaveGeometry";

const STEP_EPSILON = 1e-9;
const NEGATIVE_PARTY_STATUS_KINDS = new Set([
  "bind",
  "radius-multiplier",
  "sleep-stack",
  "slow-field",
  "stun",
  "wine-slow",
]);

interface EnemyDamageContext {
  readonly actionId: string;
  readonly attackKind: string;
  readonly intentKind: BattleEnemyIntentKind;
  readonly effectKind?: string;
  readonly sourceKind: "enemyAttack" | "hazard";
}

interface EnemySpatialTarget {
  readonly id: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly kind: "party" | "objective";
}

interface EnemyActionResolution {
  readonly outcomeKind: BattleEnemyActionOutcome;
  readonly targetIds: readonly string[];
  readonly amount?: number;
}

interface HeroImpactContext {
  readonly impactSpeed: number;
  readonly referenceSpeed: number;
  readonly incidence: number;
  readonly ricochetCount: number;
  readonly comboCount: number;
}

interface HeroDamageRoll extends HeroImpactFormulaResult {
  readonly damage: number;
  readonly critical: boolean;
}

/** Flags with authoritative simulation consumers in this module. */
export const BATTLE_RUNTIME_MODIFIER_FLAGS = Object.freeze([
  "portalElementChangesWallCollision", "rearHitCritical", "exactSoundWaveCollision", "mirrorTrajectoryOnWrongWall",
  "protectedTargetsMoveAfterShot", "protectedTargetHpPerExtraHero", "exitUnlocksAfterBruteStaggers", "forbiddenTargetContactFailsStage",
  "protectedMemoryDamagedOnEnemyAction", "sealDirectionHitCount", "sealRequiredAngleCount",
  "boulderDamagesAllTeams", "charybdisSupportHazard", "anchorHitsReduceSuction",
  "lightningPatternChangesPerPhase", "movingBumperBeforeEnemyPhase", "safeLaneShiftsEachTurn", "windSpeedRisesPerPhase",
  "breakableWallOpensRearRoute", "bronzeWallsGroundLightning", "gateChangesSolidState", "gatesShiftAfterShot",
  "pillarsShiftInPhaseTwo", "spiritWallsPhaseCadence", "wallsRotateAfterShot",
  "cannotBeKilled", "minimumHp", "phaseHpThresholdPercent", "eyeOpensAfterRearHit",
  "finalBoss", "forepawsOpenSafeLane", "survivalBoss", "disguiseFirstShotNoAggro", "reinforcementTurn",
  "allyContactCleansesSleep", "allyHitRemovesStack", "sizeChangesCollider", "sleepStackThreshold", "wineAffectsBothTeams",
  "fatherSonLinkOpensCore", "furnitureMovesAfterCollision", "furnitureRearrangesEachPhase",
  "rearHitBreaksFormation", "shieldFormationSharesFacing", "shieldFrontDamageReductionPercent",
  "crystalsRequireLitOrder", "exactHeadChainCount", "interruptSongInOrder", "missResetsChain", "singleShotAllRings",
] as const);

/** Rendering/aim-assist flags intentionally consumed by BattleScene. */
export const BATTLE_SCENE_MODIFIER_FLAGS = Object.freeze([
  "previewBounceLimit", "portalPreviewExitCount", "excludeCattleFromAutoTarget", "disableControlLock",
  "showHazardVector", "showOneWayWallArrows", "showSlowField", "showSuctionVector", "showWindVector", "tutorialMode",
] as const);

export const DEFAULT_BATTLE_RUNTIME_CONFIG: Readonly<BattleRuntimeConfig> = Object.freeze({
  fixedStep: 1 / 120,
  maxAdvanceSteps: 2400,
  maxProjectileDuration: 3.4,
  maxBounces: 20,
  maxCollisions: 96,
  minLaunchSpeed: 620,
  maxLaunchSpeed: 1020,
  minProjectileSpeed: 8,
  defaultFriction: 0.015,
  enemyHitCooldown: 0.08,
  weakpointHitCooldown: 0.06,
  allyHitCooldown: 0.12,
  damageVariance: 0.08,
  criticalChance: 0.1,
  criticalMultiplier: 1.5,
  enemyLevelHpGrowth: 0.075,
  enemyLevelAttackGrowth: 0.045,
  eliteHpMultiplier: 1.35,
  eliteAttackMultiplier: 1.2,
  weakpointHpRatio: 0.14,
  weakpointDamageMultiplier: 1.65,
});

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeConfig(config?: Partial<BattleRuntimeConfig>): BattleRuntimeConfig {
  const merged = { ...DEFAULT_BATTLE_RUNTIME_CONFIG, ...(config ?? {}) };
  return {
    fixedStep: Math.max(1 / 1000, merged.fixedStep),
    maxAdvanceSteps: Math.max(1, Math.floor(merged.maxAdvanceSteps)),
    maxProjectileDuration: Math.max(0.01, merged.maxProjectileDuration),
    maxBounces: Math.max(0, Math.floor(merged.maxBounces)),
    maxCollisions: Math.max(1, Math.floor(merged.maxCollisions)),
    minLaunchSpeed: Math.max(1, merged.minLaunchSpeed),
    maxLaunchSpeed: Math.max(Math.max(1, merged.minLaunchSpeed), merged.maxLaunchSpeed),
    minProjectileSpeed: Math.max(0, merged.minProjectileSpeed),
    defaultFriction: clamp(merged.defaultFriction, 0, 1),
    enemyHitCooldown: Math.max(0, merged.enemyHitCooldown),
    weakpointHitCooldown: Math.max(0, merged.weakpointHitCooldown),
    allyHitCooldown: Math.max(0, merged.allyHitCooldown),
    damageVariance: clamp(merged.damageVariance, 0, 0.95),
    criticalChance: clamp(merged.criticalChance, 0, 1),
    criticalMultiplier: Math.max(1, merged.criticalMultiplier),
    enemyLevelHpGrowth: Math.max(0, merged.enemyLevelHpGrowth),
    enemyLevelAttackGrowth: Math.max(0, merged.enemyLevelAttackGrowth),
    eliteHpMultiplier: Math.max(1, merged.eliteHpMultiplier),
    eliteAttackMultiplier: Math.max(1, merged.eliteAttackMultiplier),
    weakpointHpRatio: clamp(merged.weakpointHpRatio, 0.01, 1),
    weakpointDamageMultiplier: Math.max(1, merged.weakpointDamageMultiplier),
    reinforcementTurnOverride: merged.reinforcementTurnOverride === undefined
      ? undefined
      : Math.max(1, Math.round(merged.reinforcementTurnOverride)),
  };
}

function compiledModifierEffect(
  compilation: StageDefinitionModifierCompilation,
  category: StageModifierCategory,
  flag: string,
) {
  return compilation.byCategory[category].find((candidate) => candidate.flag === flag);
}

function compiledModifierParameterNumber(
  compilation: StageDefinitionModifierCompilation,
  category: StageModifierCategory,
  flag: string,
  fallback = 0,
): number {
  const parameter = compiledModifierEffect(compilation, category, flag)?.parameter;
  return parameter && typeof parameter.value === "number" ? parameter.value : fallback;
}

function resolveVictoryRule(
  stage: StageDefinition,
  compilation: StageDefinitionModifierCompilation,
  override?: BattleVictoryRule,
): BattleVictoryRule {
  if (override) return cloneJson(override);
  if (stage.objective.type === "break-parts" || stage.objective.type === "assemble") {
    return {
      type: "completeTargets",
      objectiveType: stage.objective.type,
      required: Math.max(1, stage.objective.requiredCount ?? stage.objective.targetIds.length),
      targetIds: [...stage.objective.targetIds],
    };
  }
  if (stage.objective.type === "survive") {
    return { type: "surviveTurns", turns: Math.max(1, stage.objective.turnLimit) };
  }
  if (stage.objective.type === "protect") {
    const required = Math.max(1, stage.objective.requiredCount ?? stage.objective.targetIds.length);
    if (compiledModifierEffect(compilation, "status", "allyContactCleansesSleep")) {
      return {
        type: "completeTargets",
        objectiveType: "protect",
        required,
        targetIds: [...stage.objective.targetIds],
      };
    }
    return {
      type: "protectTargets",
      required,
      turns: Math.max(1, stage.objective.turnLimit),
      targetIds: [...stage.objective.targetIds],
    };
  }
  if (stage.objective.type === "seal" || stage.objective.type === "escape") {
    return {
      type: "completeTargets",
      objectiveType: stage.objective.type,
      required: Math.max(1, stage.objective.requiredCount ?? stage.objective.targetIds.length),
      targetIds: [...stage.objective.targetIds],
    };
  }
  return { type: "defeatAll" };
}

function spawnById(stage: StageDefinition, spawnId: string): SpawnDefinition {
  const spawn = stage.spawns.find((entry) => entry.id === spawnId);
  if (!spawn) throw new Error(`Missing spawn '${spawnId}' in stage '${stage.id}'.`);
  return spawn;
}

function partySpawn(stage: StageDefinition): SpawnDefinition {
  return stage.spawns.find((spawn) => spawn.kind === "party") ?? {
    id: "generated-party",
    kind: "party",
    x: stage.arena.width / 2,
    y: stage.arena.height * 0.82,
    radius: 36,
  };
}

function partyPosition(
  stage: StageDefinition,
  heroes: readonly HeroDefinition[],
  index: number,
  explicit?: readonly Vec2[],
): Vec2 {
  const configured = explicit?.[index];
  if (configured) return { ...configured };
  const spawn = partySpawn(stage);
  if (heroes.length === 1) return vec2(spawn.x, spawn.y);
  const maximumRadius = heroes.reduce((maximum, hero) => Math.max(maximum, hero.radius), 0);
  const spacing = maximumRadius * 2 + 12;
  return vec2(spawn.x + (index - (heroes.length - 1) / 2) * spacing, spawn.y);
}

function enemyMaxHp(
  definition: EnemyDefinition,
  level: number,
  elite: boolean,
  config: BattleRuntimeConfig,
): number {
  const levelMultiplier = 1 + Math.max(0, level - 1) * config.enemyLevelHpGrowth;
  return Math.max(1, Math.round(definition.stats.hp * levelMultiplier * (elite ? config.eliteHpMultiplier : 1)));
}

function createEnemyStates(
  stage: StageDefinition,
  enemyCatalog: Readonly<Record<string, EnemyDefinition>>,
  config: BattleRuntimeConfig,
): BattleEnemyState[] {
  return stage.enemies.map((placement) => {
    const definition = enemyCatalog[placement.enemyId];
    if (!definition) throw new Error(`Unknown enemy '${placement.enemyId}' in stage '${stage.id}'.`);
    const spawn = spawnById(stage, placement.spawnId);
    const maxHp = enemyMaxHp(definition, placement.level, Boolean(placement.elite), config);
    return {
      id: placement.spawnId,
      definitionId: definition.id,
      spawnId: placement.spawnId,
      level: placement.level,
      elite: Boolean(placement.elite),
      hp: maxHp,
      maxHp,
      position: vec2(spawn.x, spawn.y),
      radius: Math.max(1, spawn.radius || definition.radius),
      behaviorId: definition.behaviorId,
      facing: vec2(0, 1),
      generation: 0,
      splitUsed: false,
      summonCount: 0,
      attackCountdown: Math.max(1, definition.attackCountdown),
      alive: true,
      weakpoints: [],
    };
  });
}

function weakpointStateFromSetup(
  setup: BattleWeakpointSetup,
  enemy: BattleEnemyState,
  config: BattleRuntimeConfig,
): BattleWeakpointState {
  const maxHp = Math.max(1, Math.round(setup.maxHp ?? enemy.maxHp * config.weakpointHpRatio));
  return {
    id: setup.id,
    partId: setup.partId ?? setup.id,
    enemyInstanceId: setup.enemyInstanceId,
    hp: maxHp,
    maxHp,
    position: { ...setup.position },
    radius: Math.max(1, setup.radius),
    collider: "circle",
    halfExtent: Math.max(1, setup.radius),
    rotation: 0,
    damageMultiplier: Math.max(1, setup.damageMultiplier ?? config.weakpointDamageMultiplier),
    breakable: setup.breakable ?? true,
    broken: false,
  };
}

function generatedWeakpointsForPart(
  enemy: BattleEnemyState,
  part: BossPartDefinition,
  startIndex: number,
  totalCount: number,
  config: BattleRuntimeConfig,
): BattleWeakpointState[] {
  const result: BattleWeakpointState[] = [];
  for (let index = 0; index < part.count; index += 1) {
    const ordinal = startIndex + index;
    // Boss parts are anchored to the illustrated anatomy instead of being
    // distributed around an arbitrary ring. These anchors are deterministic,
    // mirror paired limbs/heads, and remain attached when the boss moves.
    const localIndex = part.count <= 1 ? 0.5 : index / (part.count - 1);
    let local = vec2(0, 0);
    if (part.kind === "eye") {
      local = vec2((localIndex - 0.5) * enemy.radius * 0.72, -enemy.radius * 0.25);
    } else if (part.kind === "head") {
      const angle = Math.PI * (1.12 + localIndex * 0.76);
      local = vec2(Math.cos(angle) * enemy.radius * 0.64, Math.sin(angle) * enemy.radius * 0.58);
    } else if (part.kind === "neck") {
      local = vec2((localIndex - 0.5) * enemy.radius * 1.05, -enemy.radius * 0.02);
    } else if (part.kind === "forepaw") {
      local = vec2((localIndex < 0.5 ? -1 : 1) * enemy.radius * 0.48, enemy.radius * 0.42);
    } else if (part.kind === "shield") {
      local = vec2(0, enemy.radius * 0.48);
    } else if (part.kind === "core") {
      local = vec2(0, -enemy.radius * 0.02);
    } else if (part.kind === "body" && totalCount > 1) {
      // Multi-body bosses (the Siren triad) need distinct, readable collision
      // silhouettes. The old radial fallback placed three single-count body
      // parts within ~20 px of the boss centre, so their colliders overlapped
      // and an ordered hit could immediately register against a future part.
      const centeredOrdinal = ordinal - (totalCount - 1) / 2;
      local = vec2(centeredOrdinal * enemy.radius * 0.72, -enemy.radius * 0.04);
    } else {
      const angle = -Math.PI / 2 + (ordinal / Math.max(1, totalCount)) * Math.PI * 2;
      local = vec2(Math.cos(angle) * enemy.radius * 0.28, Math.sin(angle) * enemy.radius * 0.28);
    }
    const maxHp = Math.max(1, Math.round(enemy.maxHp * config.weakpointHpRatio));
    const baseRadius = Math.max(10, enemy.radius * (part.collider === "circle" ? 0.2 : 0.16));
    result.push({
      id: `${enemy.id}:${part.id}:${index + 1}`,
      partId: part.id,
      enemyInstanceId: enemy.id,
      hp: maxHp,
      maxHp,
      position: add(enemy.position, local),
      radius: baseRadius,
      collider: part.collider,
      halfExtent: part.collider === "circle" ? baseRadius : Math.max(baseRadius * 1.55, enemy.radius * 0.28),
      rotation: part.kind === "neck" ? Math.PI / 2 : part.kind === "forepaw" ? (local.x < 0 ? -0.45 : 0.45) : 0,
      damageMultiplier: config.weakpointDamageMultiplier,
      breakable: part.breakable,
      broken: false,
    });
  }
  return result;
}

function attachWeakpoints(
  stage: StageDefinition,
  enemies: BattleEnemyState[],
  explicit: readonly BattleWeakpointSetup[] | undefined,
  config: BattleRuntimeConfig,
): void {
  if (explicit?.length) {
    for (const weakpointSetup of explicit) {
      const enemy = enemies.find((entry) => entry.id === weakpointSetup.enemyInstanceId);
      if (!enemy) throw new Error(`Weakpoint '${weakpointSetup.id}' references missing enemy '${weakpointSetup.enemyInstanceId}'.`);
      enemy.weakpoints.push(weakpointStateFromSetup(weakpointSetup, enemy, config));
    }
  }

  const boss = stage.boss;
  if (!boss) return;
  const enemy = enemies.find((entry) => entry.definitionId === boss.bossId);
  if (!enemy) return;
  const objectiveTargetIds = new Set(stage.objective.targetIds);
  // Some authored objectives (for example anti-shield) deliberately target a
  // breakable boss part that is not tagged as a damage weakpoint. It still
  // needs runtime geometry and state, otherwise the objective is impossible.
  const weakParts = boss.parts.filter(
    (part) => part.weakpoint || part.breakable || objectiveTargetIds.has(part.id),
  );
  const totalCount = weakParts.reduce((sum, part) => sum + part.count, 0);
  let offset = 0;
  for (const part of weakParts) {
    const existingCount = enemy.weakpoints.filter((weakpoint) => weakpoint.partId === part.id).length;
    const missingCount = Math.max(0, part.count - existingCount);
    if (missingCount > 0) {
      enemy.weakpoints.push(...generatedWeakpointsForPart(
        enemy,
        { ...part, count: missingCount },
        offset + existingCount,
        totalCount,
        config,
      ));
    }
    offset += part.count;
  }
}

function createObjectiveTargets(
  stage: StageDefinition,
  enemies: readonly BattleEnemyState[],
  partySize: number,
  modifierCompilation: StageDefinitionModifierCompilation,
): BattleObjectiveTargetState[] {
  const targets: BattleObjectiveTargetState[] = [];
  for (const sourceId of stage.objective.targetIds) {
    if (sourceId === "party") {
      const spawn = partySpawn(stage);
      targets.push({
        id: "party",
        sourceId,
        kind: "party",
        position: vec2(spawn.x, spawn.y),
        radius: Math.max(1, spawn.radius),
        hp: 1,
        maxHp: 1,
        hitCount: 0,
        active: true,
        completed: false,
        failed: false,
      });
      continue;
    }

    const matchingWeakpoints = enemies.flatMap((enemy) => enemy.weakpoints).filter(
      (weakpoint) => weakpoint.id === sourceId || weakpoint.partId === sourceId,
    );
    if (matchingWeakpoints.length > 0) {
      for (const weakpoint of matchingWeakpoints) {
        targets.push({
          id: weakpoint.id,
          sourceId,
          kind: "bossPart",
          position: { ...weakpoint.position },
          radius: weakpoint.radius,
          hp: weakpoint.hp,
          maxHp: weakpoint.maxHp,
          hitCount: 0,
          active: true,
          completed: false,
          failed: false,
        });
      }
      continue;
    }

    const prop = stage.spawns.find((spawn) => spawn.kind === "prop" && spawn.id === sourceId);
    if (prop) {
      const interaction = prop.interaction;
      const authoredMaxHp = interaction?.mode === "assembly"
        ? Math.max(1, Math.round(interaction.hitsRequired))
        : interaction
          ? Math.max(1, Math.round(interaction.maxHp))
          : stage.objective.type === "protect"
            ? 100
            : 1;
      // Some protect encounters are balanced around extra crew physically
      // screening the objective. Keep solo difficulty authored, then grant the
      // explicit guard pool once per additional deployed hero.
      const extraCrewGuardHp = stage.objective.type === "protect"
        ? compiledModifierParameterNumber(
          modifierCompilation,
          "objective",
          "protectedTargetHpPerExtraHero",
          0,
        ) * Math.max(0, partySize - 1)
        : 0;
      const maxHp = authoredMaxHp + extraCrewGuardHp;
      targets.push({
        id: prop.id,
        sourceId,
        kind: "prop",
        position: vec2(prop.x, prop.y),
        radius: Math.max(1, prop.radius),
        hp: maxHp,
        maxHp,
        hitCount: 0,
        active: true,
        completed: false,
        failed: false,
      });
      continue;
    }

    // Escape stages currently author `north-exit` without a spawn. Keeping the
    // synthesis deterministic makes the data valid while still exposing the
    // target to renderers through the snapshot.
    if (stage.objective.type === "escape") {
      targets.push({
        id: sourceId,
        sourceId,
        kind: "exit",
        position: vec2(stage.arena.width / 2, 42),
        radius: 58,
        hp: 1,
        maxHp: 1,
        hitCount: 0,
        active: true,
        completed: false,
        failed: false,
      });
    }
  }
  return targets;
}

function createObjectiveProgress(
  stage: StageDefinition,
  enemies: readonly BattleEnemyState[],
  victoryRule: BattleVictoryRule,
  partySize: number,
  modifierCompilation: StageDefinitionModifierCompilation,
): BattleObjectiveProgressState {
  const targets = createObjectiveTargets(stage, enemies, partySize, modifierCompilation);
  let required = Math.max(1, stage.objective.requiredCount ?? targets.length);
  if (victoryRule.type === "defeatAll") required = Math.max(1, enemies.length);
  if (victoryRule.type === "surviveTurns" || victoryRule.type === "protectTargets") {
    required = victoryRule.turns;
  }
  return {
    type: stage.objective.type,
    current: 0,
    required,
    turnLimit: Math.max(1, stage.objective.turnLimit),
    completed: false,
    failed: false,
    targetIds: [...stage.objective.targetIds],
    targets,
  };
}

function createProps(stage: StageDefinition, objective: BattleObjectiveProgressState): BattlePropState[] {
  return stage.spawns.filter((spawn) => spawn.kind === "prop").map((spawn) => {
    const target = objective.targets.find((entry) => entry.id === spawn.id);
    const interaction = spawn.interaction;
    const mode = interaction?.mode;
    const requiredProgress = interaction?.mode === "assembly"
      ? Math.max(1, Math.round(interaction.hitsRequired))
      : Math.max(1, target?.maxHp ?? (interaction?.maxHp ?? 1));
    return {
      id: spawn.id,
      origin: vec2(spawn.x, spawn.y),
      position: vec2(spawn.x, spawn.y),
      destination: interaction?.mode === "assembly" ? { ...interaction.destination } : undefined,
      radius: Math.max(1, spawn.radius),
      hp: target?.hp ?? 1,
      maxHp: target?.maxHp ?? 1,
      active: true,
      state: "idle",
      visualState: mode === "destructible"
        ? "intact"
        : mode === "assembly"
          ? "unlashed"
          : mode === "bond"
            ? "bonded"
            : "idle",
      interactionMode: mode,
      progress: 0,
      requiredProgress,
    };
  });
}

function createHazards(stage: StageDefinition): BattleHazardState[] {
  return stage.hazards.map((hazard) => {
    const warningTurns = Math.max(0, Number(hazard.parameters.warningTurns ?? (hazard.type === "wave-front" ? 1 : 0)));
    return {
      id: hazard.id,
      type: hazard.type,
      origin: vec2(hazard.x, hazard.y),
      position: vec2(hazard.x, hazard.y),
      radius: Math.max(1, hazard.radius),
      active: true,
      phase: 0,
      parameters: {
        ...hazard.parameters,
        baseRadius: Math.max(1, hazard.radius),
        armed: warningTurns <= 0,
      },
    };
  });
}

function createWalls(stage: StageDefinition): BattleWallState[] {
  return stage.walls.map((wall) => {
    const maxHp = wall.breakable ? Math.max(1, wall.hp ?? 1) : Number.MAX_SAFE_INTEGER;
    return {
      id: wall.id,
      hp: maxHp,
      maxHp,
      breakable: Boolean(wall.breakable),
      broken: false,
      active: true,
      offset: vec2(0, 0),
      rotation: 0,
    };
  });
}

function createModifierStates(compilation: StageDefinitionModifierCompilation): BattleStageModifierState[] {
  return compilation.modifiers.flatMap((modifier, modifierIndex) => {
    if (!modifier.recognized) return [];
    return modifier.effects.map((effect, effectIndex) => ({
      id: `${modifier.source}:${modifierIndex}:${effectIndex}`,
      source: modifier.source,
      key: modifier.key,
      category: effect.category,
      flag: effect.flag,
      parameter: effect.parameter ? cloneJson(effect.parameter) : undefined,
      active: true,
      triggerCount: 0,
      value: 0,
      lastTurn: 0,
    }));
  });
}

function initialSnapshot(
  setup: BattleSetup,
  modifierCompilation: StageDefinitionModifierCompilation,
): BattleSnapshot {
  if (setup.party.length === 0) throw new Error("Battle party must contain at least one hero.");
  const partyIds = new Set<string>();
  for (const hero of setup.party) {
    if (partyIds.has(hero.id)) throw new Error(`Duplicate party hero '${hero.id}'.`);
    partyIds.add(hero.id);
  }

  const config = normalizeConfig(setup.config);
  const enemies = createEnemyStates(setup.stage, setup.enemyCatalog, config);
  attachWeakpoints(setup.stage, enemies, setup.weakpoints, config);
  const victoryRule = resolveVictoryRule(setup.stage, modifierCompilation, setup.victoryRule);
  const objective = createObjectiveProgress(
    setup.stage,
    enemies,
    victoryRule,
    setup.party.length,
    modifierCompilation,
  );
  const party: BattlePartyMemberState[] = setup.party.map((hero, index) => ({
    id: hero.id,
    definitionId: hero.id,
    hp: Math.max(1, Math.round(hero.stats.hp)),
    maxHp: Math.max(1, Math.round(hero.stats.hp)),
    position: partyPosition(setup.stage, setup.party, index, setup.partyPositions),
    radius: hero.radius,
    alive: true,
    activeSkill: {
      charge: 0,
      requiredCharge: effectiveActiveCharge(hero, setup.stage),
      ready: false,
      uses: 0,
    },
  }));

  const startsWithVictory = victoryRule.type === "defeatAll" && enemies.length === 0;
  return {
    snapshotVersion: BATTLE_SNAPSHOT_VERSION,
    stageId: setup.stage.id,
    seed: setup.seed,
    config,
    victoryRule,
    phase: startsWithVictory ? "victory" : "awaitingAim",
    battleTime: 0,
    fixedAccumulator: 0,
    turnNumber: 1,
    completedTurns: 0,
    rescueTurnLimitBonus: 0,
    activePartyIndex: 0,
    party,
    enemies,
    enemyIntents: [],
    objective,
    props: createProps(setup.stage, objective),
    hazards: createHazards(setup.stage),
    walls: createWalls(setup.stage),
    effects: [],
    modifiers: createModifierStates(modifierCompilation),
    stagePhase: 1,
    aim: null,
    projectile: null,
    comboCount: 0,
    bestCombo: 0,
    ricochetCount: 0,
    totalHits: 0,
    rng: { state: hashSeed(setup.seed), draws: 0 },
    eventSequence: 0,
    outcome: startsWithVictory
      ? { victory: true, reason: "allEnemiesDefeated", turnNumber: 1 }
      : null,
  };
}

function targetFromColliderId(colliderId: string): { kind: TrajectoryTargetKind; id: string } {
  const separator = colliderId.indexOf(":");
  if (separator < 0) return { kind: "other", id: colliderId };
  const prefix = colliderId.slice(0, separator);
  const id = colliderId.slice(separator + 1);
  if (prefix === "wall") return { kind: "wall", id };
  if (prefix === "enemy") return { kind: "enemy", id };
  if (prefix === "weakpoint") return { kind: "weakpoint", id };
  if (prefix === "ally") return { kind: "ally", id };
  if (prefix === "objective") return { kind: "objective", id };
  if (prefix === "hazard") return { kind: "hazard", id };
  if (prefix === "hazardLethal") return { kind: "hazard", id: `${id}#lethal` };
  return { kind: "other", id };
}

function sanitizeTrajectory(trace: RicochetTraceResult): BattleTrajectory {
  let segmentTime = 0;
  const segments = trace.segments.map((segment) => {
    const startTime = segmentTime;
    segmentTime += segment.duration;
    return {
      from: { ...segment.from },
      to: { ...segment.to },
      velocity: { ...segment.velocity },
      startTime,
      endTime: segmentTime,
      collisionIds: [...segment.collisionIds],
    };
  });
  const contacts: BattleTrajectoryContact[] = trace.collisions.map((collision) => {
    const target = targetFromColliderId(collision.collider.id);
    return {
      colliderId: collision.collider.id,
      targetKind: target.kind,
      targetId: target.id,
      position: { ...collision.position },
      contactPoint: { ...collision.contactPoint },
      normal: { ...collision.normal },
      elapsedTime: collision.elapsedTime,
      response: collision.response,
      hitAccepted: collision.hitAccepted,
      bounceIndex: collision.bounceIndex,
      simultaneous: collision.simultaneous,
    };
  });
  return {
    start: trace.points[0] ? { ...trace.points[0] } : { ...trace.finalPosition },
    initialVelocity: trace.segments[0]?.velocity ? { ...trace.segments[0].velocity } : { ...trace.finalVelocity },
    finalPosition: { ...trace.finalPosition },
    finalVelocity: { ...trace.finalVelocity },
    totalDuration: trace.elapsedTime,
    traceTermination: trace.termination,
    bounceCount: trace.bounceCount,
    points: trace.points.map((point) => ({ ...point })),
    segments,
    contacts,
  };
}

function effectiveActiveCharge(hero: HeroDefinition, stage: StageDefinition): number {
  // A normal encounter must allow its signature skill before the turn limit.
  // Longer/endgame stages still respect most of the authored charge identity.
  const encounterBudget = Math.max(4, Math.ceil(stage.objective.turnLimit * (stage.boss ? 0.65 : 0.55)));
  const baseCharge = Math.max(1, Math.min(Math.round(hero.activeSkill.chargeTurns), encounterBudget));
  const chargeSpeed = Math.max(0, relicEffectValue(hero.runtimeRelicEffects ?? [], "active-charge-speed"));
  return Math.max(1, Math.ceil(baseCharge / (1 + chargeSpeed / 100)));
}

function trajectoryPositionAt(trajectory: BattleTrajectory, elapsed: number): { position: Vec2; velocity: Vec2 } {
  if (trajectory.segments.length === 0 || elapsed >= trajectory.totalDuration - STEP_EPSILON) {
    return { position: { ...trajectory.finalPosition }, velocity: { ...trajectory.finalVelocity } };
  }
  const segment = trajectory.segments.find((entry) => elapsed <= entry.endTime + STEP_EPSILON)
    ?? trajectory.segments[trajectory.segments.length - 1]!;
  const duration = Math.max(STEP_EPSILON, segment.endTime - segment.startTime);
  const t = clamp((elapsed - segment.startTime) / duration, 0, 1);
  return {
    position: lerpVec(segment.from, segment.to, t),
    velocity: { ...segment.velocity },
  };
}

function isBattleSnapshot(value: unknown): value is BattleSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BattleSnapshot>;
  return candidate.snapshotVersion === BATTLE_SNAPSHOT_VERSION
    && typeof candidate.stageId === "string"
    && Array.isArray(candidate.party)
    && Array.isArray(candidate.enemies)
    && typeof candidate.turnNumber === "number";
}

export function serializeBattleSnapshot(snapshot: BattleSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseBattleSnapshot(serialized: string): BattleSnapshot {
  const parsed = JSON.parse(serialized) as unknown;
  if (!isBattleSnapshot(parsed)) throw new Error("Invalid battle snapshot.");
  return parsed;
}

export class BattleRuntime {
  private readonly stage: StageDefinition;
  private readonly modifierCompilation: StageDefinitionModifierCompilation;
  private readonly heroById: Readonly<Record<string, HeroDefinition>>;
  private readonly enemyById: Readonly<Record<string, EnemyDefinition>>;
  private readonly enemyBehaviorById: Readonly<Record<string, EnemyBehaviorDefinition>>;
  private readonly relicEffects: readonly RuntimeRelicEffect[];
  private state: BattleSnapshot;
  private events: BattleEvent[] = [];
  private boulderDamageTurn = -1;
  private readonly boulderDamageKeys = new Set<string>();

  public constructor(setup: BattleSetup, snapshot?: BattleSnapshot) {
    this.stage = setup.stage;
    this.modifierCompilation = compileStageDefinitionModifiers(setup.stage);
    if (!this.modifierCompilation.recognized) {
      throw new Error(`Stage '${setup.stage.id}' contains unsupported modifiers: ${
        this.modifierCompilation.unsupported.map((modifier) => modifier.source).join(", ")
      }`);
    }
    this.heroById = Object.freeze(Object.fromEntries(setup.party.map((hero) => [hero.id, hero])));
    this.enemyById = setup.enemyCatalog;
    this.enemyBehaviorById = setup.enemyBehaviorCatalog ?? {};
    this.relicEffects = Object.freeze([...new Map(
      setup.party
        .flatMap((hero) => hero.runtimeRelicEffects ?? [])
        .map((effect) => [`${effect.sourceId}:${effect.kind}:${effect.target}`, { ...effect }] as const),
    ).values()]);
    this.state = snapshot ? this.restoreSnapshot(setup, snapshot) : initialSnapshot(setup, this.modifierCompilation);

    if (!snapshot) {
      this.emit("battleStarted");
      this.initializeStageModifiers();
      this.initializeRelicEffects();
      if (this.state.phase === "victory") this.emit("victory", { reason: "allEnemiesDefeated" });
      else {
        this.applyRelicRegeneration();
        this.emit("turnStarted", { actorId: this.activePartyMember().id });
      }
    }
    // A paid rescue re-enters at a stable aiming boundary and may have moved
    // actors, so rebuild there. Mid-flight/enemy-phase snapshots must retain
    // the already announced target coordinates byte-for-byte.
    if (!snapshot || this.state.phase === "awaitingAim" || this.state.phase === "aiming") {
      this.refreshEnemyIntents();
    }
  }

  private restoreSnapshot(setup: BattleSetup, snapshot: BattleSnapshot): BattleSnapshot {
    if (snapshot.snapshotVersion !== BATTLE_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported battle snapshot version '${snapshot.snapshotVersion}'.`);
    }
    if (snapshot.stageId !== setup.stage.id) {
      throw new Error(`Snapshot stage '${snapshot.stageId}' does not match '${setup.stage.id}'.`);
    }
    for (const partyMember of snapshot.party) {
      if (!this.heroById[partyMember.definitionId]) {
        throw new Error(`Snapshot references missing hero '${partyMember.definitionId}'.`);
      }
    }
    for (const enemy of snapshot.enemies) {
      if (!this.enemyById[enemy.definitionId]) {
        throw new Error(`Snapshot references missing enemy '${enemy.definitionId}'.`);
      }
    }
    const restored = cloneJson(snapshot);
    const legacy = restored as BattleSnapshot & Partial<Pick<
      BattleSnapshot,
      "objective" | "props" | "hazards" | "walls" | "effects" | "enemyIntents"
    >>;
    const baseline = initialSnapshot(setup, this.modifierCompilation);
    if (!legacy.objective || !legacy.props || !legacy.hazards || !legacy.walls || !legacy.effects) {
      legacy.objective ??= baseline.objective;
      legacy.props ??= baseline.props;
      legacy.hazards ??= baseline.hazards;
      legacy.walls ??= baseline.walls;
      legacy.effects ??= baseline.effects;
    }
    (legacy as Partial<BattleSnapshot>).modifiers ??= baseline.modifiers;
    (legacy as Partial<BattleSnapshot>).stagePhase ??= baseline.stagePhase;
    (legacy as Partial<BattleSnapshot>).enemyIntents ??= baseline.enemyIntents;
    (legacy as Partial<BattleSnapshot>).rescueTurnLimitBonus ??= 0;
    for (const member of restored.party) {
      const definition = this.heroById[member.definitionId];
      const requiredCharge = definition ? effectiveActiveCharge(definition, setup.stage) : 1;
      if (!member.activeSkill) {
        member.activeSkill = { charge: 0, requiredCharge, ready: false, uses: 0 };
      } else {
        member.activeSkill.requiredCharge = requiredCharge;
        member.activeSkill.charge = Math.min(requiredCharge, member.activeSkill.charge);
        member.activeSkill.ready = member.activeSkill.ready || member.activeSkill.charge >= requiredCharge;
      }
    }
    for (const enemy of restored.enemies) {
      const definition = this.enemyById[enemy.definitionId];
      enemy.behaviorId ??= definition?.behaviorId ?? "charger";
      enemy.facing ??= vec2(0, 1);
      enemy.generation ??= 0;
      enemy.splitUsed ??= false;
      enemy.summonCount ??= 0;
      for (const weakpoint of enemy.weakpoints) {
        weakpoint.collider ??= "circle";
        weakpoint.halfExtent ??= weakpoint.radius;
        weakpoint.rotation ??= 0;
      }
    }
    for (const wall of restored.walls) {
      wall.active ??= true;
      wall.offset ??= vec2(0, 0);
      wall.rotation ??= 0;
    }
    for (const prop of restored.props) {
      const fallback = baseline.props.find((entry) => entry.id === prop.id);
      prop.origin ??= fallback?.origin ?? { ...prop.position };
      prop.destination ??= fallback?.destination;
      prop.visualState ??= fallback?.visualState ?? prop.state;
      prop.interactionMode ??= fallback?.interactionMode;
      prop.progress ??= fallback?.progress ?? 0;
      prop.requiredProgress ??= fallback?.requiredProgress ?? Math.max(1, prop.maxHp);
    }
    for (const hazard of restored.hazards) {
      hazard.parameters.baseRadius ??= hazard.radius;
      if (hazard.type !== "lightning" && hazard.type !== "sound-wave" && hazard.type !== "wave-front") continue;
      const warningTurns = Math.max(0, Math.round(Number(
        hazard.parameters.warningTurns ?? (hazard.type === "wave-front" ? 1 : 0),
      )));
      if (hazard.type === "wave-front") {
        const activeTurns = Math.max(1, Math.round(Number(hazard.parameters.activeTurns ?? 3)));
        const cycle = hazard.phase <= 0 ? 0 : (hazard.phase - 1) % Math.max(1, warningTurns + activeTurns);
        hazard.parameters.armed = warningTurns === 0 || cycle >= warningTurns;
      } else {
        const cycle = Math.max(1, warningTurns + 1);
        hazard.parameters.armed = warningTurns === 0 || hazard.phase % cycle === warningTurns;
      }
    }
    if (restored.projectile) {
      restored.projectile.friendshipTriggerKeys ??= [];
      restored.projectile.objectiveContactIds ??= [];
      restored.projectile.relicDamageContacts ??= 0;
      restored.projectile.precisionChain ??= 0;
      restored.projectile.pierceBoostContactIds ??= [];
      restored.projectile.enteredHazardIds ??= [];
      restored.projectile.rewardedHazardExitIds ??= [];
    }
    return restored;
  }

  public getSnapshot(): BattleSnapshot {
    return cloneJson(this.state);
  }

  public serialize(): string {
    return serializeBattleSnapshot(this.state);
  }

  public drainEvents(): BattleEvent[] {
    const drained = this.events.map((event) => cloneJson(event));
    this.events.length = 0;
    return drained;
  }

  public getRelicEffectValue(kind: string, aggregation: "sum" | "max" = "sum"): number {
    return this.relicValue(kind, aggregation);
  }

  public getActionAvailability(actorId = this.activePartyMember().id): BattleActionAvailability {
    const actor = this.state.party.find((member) => member.id === actorId && member.alive);
    if (!actor || (this.state.phase !== "awaitingAim" && this.state.phase !== "aiming")) {
      return { actorId, allowed: false };
    }
    if (this.hasEffect(actor.id, "stun")) return { actorId, allowed: false, reason: "stun" };
    return { actorId, allowed: true };
  }

  private modifierState(flag: string): BattleStageModifierState | undefined {
    return this.state.modifiers.find((modifier) => modifier.flag === flag);
  }

  private modifierStates(flag: string): BattleStageModifierState[] {
    return this.state.modifiers.filter((modifier) => modifier.flag === flag);
  }

  private hasModifier(category: StageModifierCategory, flag: string): boolean {
    return this.state.modifiers.some(
      (modifier) => modifier.category === category && modifier.flag === flag && modifier.active,
    );
  }

  private modifierNumber(category: StageModifierCategory, flag: string, fallback = 0): number {
    const modifier = this.state.modifiers.find(
      (candidate) => candidate.category === category && candidate.flag === flag && candidate.active,
    );
    const parameter = modifier?.parameter;
    return parameter && typeof parameter.value === "number" ? parameter.value : fallback;
  }

  private triggerModifier(
    flag: string,
    detail: Partial<Omit<BattleEvent, "sequence" | "type" | "battleTime" | "turnNumber">> = {},
    value?: number,
  ): void {
    for (const modifier of this.modifierStates(flag)) {
      this.triggerModifierState(modifier, detail, value);
    }
  }

  private triggerModifierState(
    modifier: BattleStageModifierState,
    detail: Partial<Omit<BattleEvent, "sequence" | "type" | "battleTime" | "turnNumber">> = {},
    value?: number,
  ): void {
    modifier.triggerCount += 1;
    modifier.lastTurn = this.state.turnNumber;
    modifier.value = value ?? modifier.value + 1;
    this.emit("modifierTriggered", {
      effectKind: modifier.flag,
      current: modifier.value,
      ...detail,
    });
  }

  private relicValue(kind: string, aggregation: "sum" | "max" = "sum"): number {
    return relicEffectValue(this.relicEffects, kind, aggregation);
  }

  private relicEffect(kind: string): RuntimeRelicEffect | undefined {
    return this.relicEffects.find((effect) => effect.kind === kind);
  }

  private relicEffectUsed(kind: string): boolean {
    return this.state.effects.some(
      (effect) => effect.targetId === "battle" && effect.kind === `relic-used:${kind}` && effect.remainingTurns > 0,
    );
  }

  private markRelicEffectUsed(kind: string): void {
    if (this.relicEffectUsed(kind)) return;
    this.state.effects.push({
      id: `relic:battle:${kind}`,
      sourceId: this.relicEffect(kind)?.sourceId ?? "relic",
      targetId: "battle",
      kind: `relic-used:${kind}`,
      value: 1,
      remainingTurns: 1_000_000,
      appliedTurn: this.state.turnNumber,
    });
  }

  private initializeRelicEffects(): void {
    const countdownDelay = Math.max(0, Math.round(this.relicValue("first-countdown-delay")));
    if (countdownDelay > 0) {
      for (const enemy of this.state.enemies) enemy.attackCountdown += countdownDelay;
      this.emit("statusEffectApplied", {
        actorId: this.relicEffect("first-countdown-delay")?.sourceId ?? "relic",
        targetId: "all-enemies",
        effectKind: "relic-first-countdown-delay",
        amount: countdownDelay,
        duration: countdownDelay,
      });
    }
  }

  private initializeStageModifiers(): void {
    if (this.hasModifier("objective", "exitUnlocksAfterBruteStaggers")) {
      for (const target of this.state.objective.targets.filter((entry) => entry.kind === "exit")) target.active = false;
      this.triggerModifier("exitUnlocksAfterBruteStaggers", { targetId: "north-exit" }, 0);
    }
    if (this.hasModifier("boss", "eyeOpensAfterRearHit")) {
      for (const target of this.state.objective.targets.filter((entry) => entry.sourceId.includes("eye"))) {
        target.active = false;
      }
      this.triggerModifier("eyeOpensAfterRearHit", {}, 0);
    }
    if (this.hasModifier("formation", "fatherSonLinkOpensCore")) {
      const pairAvailable = this.fatherSonPairAvailable();
      for (const target of this.state.objective.targets.filter((entry) => entry.sourceId.includes("core"))) {
        target.active = !pairAvailable;
      }
      this.triggerModifier("fatherSonLinkOpensCore", { effectKind: pairAvailable ? "fatherSonLinkRequired" : "fatherSonFallbackOpen" }, pairAvailable ? 0 : -1);
    }
    for (const flag of ["cannotBeKilled", "minimumHp", "survivalBoss", "finalBoss"] as const) {
      if (this.state.modifiers.some((modifier) => modifier.flag === flag)) this.triggerModifier(flag, {}, 1);
    }
  }

  private fatherSonPairAvailable(): boolean {
    const livingDefinitions = new Set(this.state.party.filter((member) => member.alive).map((member) => member.definitionId));
    return livingDefinitions.has("meow-dysseus") && livingDefinitions.has("tele-meow-chus");
  }

  private ensureFatherSonCoreAccessible(): void {
    if (!this.hasModifier("formation", "fatherSonLinkOpensCore") || this.fatherSonPairAvailable()) return;
    let changed = false;
    for (const target of this.state.objective.targets.filter((entry) => entry.sourceId.includes("core"))) {
      if (!target.active) changed = true;
      target.active = true;
    }
    if (changed) {
      this.triggerModifier("fatherSonLinkOpensCore", { effectKind: "fatherSonFallbackOpen" }, -1);
      this.emit("formationChanged", { effectKind: "fatherSonFallbackOpen" });
    }
  }

  public previewActiveSkill(actorId = this.activePartyMember().id): BattleActiveSkillPreview | null {
    const member = this.state.party.find((entry) => entry.id === actorId && entry.alive);
    const hero = member ? this.heroById[member.definitionId] : undefined;
    if (!member || !hero) return null;
    const blockedReason = hero.activeSkill.effects.some((effect) => effect.kind === "ally-launch")
      && !this.state.party.some((entry) => entry.alive && entry.id !== member.id)
      ? "no_ally" as const
      : hero.activeSkill.effects.some((effect) => effect.kind === "revive")
        && !this.state.party.some((entry) => !entry.alive)
        ? "no_fallen_ally" as const
        : undefined;
    return {
      actorId: member.id,
      skillId: `${hero.id}:active`,
      skillName: hero.activeSkill.name,
      charge: member.activeSkill.charge,
      requiredCharge: member.activeSkill.requiredCharge,
      ready: member.activeSkill.ready && !blockedReason,
      blockedReason,
      effects: cloneJson(hero.activeSkill.effects),
    };
  }

  /** One authoritative placement gate is shared by UI previews and skill commits. */
  public isActiveSkillPlacementOpen(position: Vec2, radius: number, firstPortal?: Vec2): boolean {
    const safeRadius = Math.max(1, radius);
    if (
      position.x < safeRadius + 8
      || position.x > this.stage.arena.width - safeRadius - 8
      || position.y < safeRadius + 8
      || position.y > this.stage.arena.height - safeRadius - 8
    ) return false;
    if (firstPortal && Math.hypot(position.x - firstPortal.x, position.y - firstPortal.y) < safeRadius * 2 + 28) {
      return false;
    }

    const circles = [
      ...this.state.party.filter((entry) => entry.alive).map((entry) => ({ position: entry.position, radius: entry.radius })),
      ...this.state.enemies.filter((entry) => entry.alive).map((entry) => ({ position: entry.position, radius: entry.radius })),
      ...this.state.props.filter((entry) => entry.state !== "broken" && entry.state !== "failed")
        .map((entry) => ({ position: entry.position, radius: entry.radius })),
    ];
    if (circles.some((entry) => Math.hypot(position.x - entry.position.x, position.y - entry.position.y) < safeRadius + entry.radius + 10)) {
      return false;
    }

    for (const wall of this.stage.walls) {
      const state = this.state.walls.find((entry) => entry.id === wall.id);
      if (state?.broken || state?.active === false) continue;
      const rotation = state?.rotation ?? 0;
      const offset = state?.offset ?? vec2(0, 0);
      const center = vec2((wall.x + (wall.x2 ?? wall.x)) / 2, (wall.y + (wall.y2 ?? wall.y)) / 2);
      const transform = (point: Vec2): Vec2 => {
        const cosine = Math.cos(rotation);
        const sine = Math.sin(rotation);
        const localX = point.x - center.x;
        const localY = point.y - center.y;
        return vec2(
          center.x + localX * cosine - localY * sine + offset.x,
          center.y + localX * sine + localY * cosine + offset.y,
        );
      };
      const wallRadius = Math.max(0, wall.radius ?? 0);
      if (wall.shape === "circle") {
        const wallCenter = transform(vec2(wall.x, wall.y));
        if (Math.hypot(position.x - wallCenter.x, position.y - wallCenter.y) < safeRadius + wallRadius + 8) return false;
      } else {
        const a = transform(vec2(wall.x, wall.y));
        const b = transform(vec2(wall.x2 ?? wall.x, wall.y2 ?? wall.y));
        const clearance = safeRadius + (wall.shape === "capsule" ? wallRadius : 0) + 8;
        if (distanceToSegmentSquared(position, a, b) < clearance * clearance) return false;
      }
    }

    const blockingHazards = new Set(["moving-bumper", "one-way-wall", "portal"]);
    return this.state.hazards.filter((entry) => entry.active && blockingHazards.has(entry.type)).every((entry) => (
      Math.hypot(position.x - entry.position.x, position.y - entry.position.y) >= safeRadius + entry.radius + 10
    ));
  }

  public activateActiveSkill(command: BattleActiveSkillCommand = {}): BattleActiveSkillPreview | null {
    if (this.state.phase !== "awaitingAim" && this.state.phase !== "aiming") return null;
    if (!this.getActionAvailability(command.actorId ?? this.activePartyMember().id).allowed) return null;
    const actorId = command.actorId ?? this.activePartyMember().id;
    const member = this.state.party.find((entry) => entry.id === actorId && entry.alive);
    const hero = member ? this.heroById[member.definitionId] : undefined;
    if (!member || !hero || !member.activeSkill.ready) return null;
    const preview = this.previewActiveSkill(actorId);
    if (!preview?.ready) return null;
    const needsBumper = hero.activeSkill.effects.some((effect) => effect.kind === "temporary-bumper");
    const needsPortalPair = hero.activeSkill.effects.some((effect) => effect.kind === "portal-pair");
    if (needsBumper && (!command.position || !this.isActiveSkillPlacementOpen(command.position, 42))) return null;
    if (needsPortalPair && (
      !command.position
      || !command.secondaryPosition
      || !this.isActiveSkillPlacementOpen(command.position, 34)
      || !this.isActiveSkillPlacementOpen(command.secondaryPosition, 34, command.position)
    )) return null;
    member.activeSkill.charge = 0;
    member.activeSkill.ready = false;
    member.activeSkill.uses += 1;
    this.emit("activeSkillActivated", {
      actorId,
      skillId: preview.skillId,
      skillName: preview.skillName,
      position: command.position ?? member.position,
    });
    for (const effect of hero.activeSkill.effects) {
      this.applyActiveSkillEffect(member, hero, effect, command);
    }
    this.refreshAnnouncedIntentStatuses();
    this.checkVictory();
    return preview;
  }

  public setAim(command: AimCommand): BattleLaunchPreview | null {
    if (this.state.phase !== "awaitingAim" && this.state.phase !== "aiming") return null;
    if (!this.getActionAvailability().allowed) return null;
    const direction = normalize(command.direction);
    if (direction.x === 0 && direction.y === 0) return null;
    this.state.aim = { direction, power: clamp(command.power, 0, 1) };
    this.state.phase = "aiming";
    const preview = this.previewAim();
    this.emit("aimChanged", {
      actorId: this.activePartyMember().id,
      position: { ...this.activePartyMember().position },
    });
    return preview;
  }

  public clearAim(): boolean {
    if (this.state.phase !== "aiming") return false;
    this.state.aim = null;
    this.state.phase = "awaitingAim";
    this.emit("aimCleared", { actorId: this.activePartyMember().id });
    return true;
  }

  public previewAim(command?: AimCommand): BattleLaunchPreview | null {
    if (this.state.phase !== "awaitingAim" && this.state.phase !== "aiming") return null;
    if (!this.getActionAvailability().allowed) return null;
    const aim = command
      ? { direction: normalize(command.direction), power: clamp(command.power, 0, 1) }
      : this.state.aim;
    if (!aim || (aim.direction.x === 0 && aim.direction.y === 0)) return null;
    const actor = this.activePartyMember();
    return {
      actorId: actor.id,
      aim: cloneJson(aim),
      trajectory: this.buildTrajectory(actor, aim),
    };
  }

  public launch(command?: AimCommand): BattleLaunchPreview | null {
    if (command) {
      const preview = this.setAim(command);
      if (!preview) return null;
    }
    if (this.state.phase !== "aiming" || !this.state.aim) return null;
    if (!this.getActionAvailability().allowed) return null;
    const actor = this.activePartyMember();
    const trajectory = this.buildTrajectory(actor, this.state.aim);
    const exactHeadChain = this.modifierState("exactHeadChainCount");
    if (exactHeadChain) {
      exactHeadChain.value = 0;
      exactHeadChain.lastTurn = this.state.turnNumber;
    }
    this.state.comboCount = 0;
    this.state.ricochetCount = 0;
    this.state.fixedAccumulator = 0;
    this.state.projectile = {
      actorId: actor.id,
      elapsed: 0,
      contactIndex: 0,
      lastBounceIndex: 0,
      position: { ...actor.position },
      velocity: { ...trajectory.initialVelocity },
      trajectory,
      friendshipTriggerKeys: [],
      objectiveContactIds: [],
      relicDamageContacts: 0,
      precisionChain: 0,
      pierceBoostContactIds: [],
      enteredHazardIds: this.state.hazards.filter((hazard) => hazard.active && Math.hypot(
        actor.position.x - hazard.position.x,
        actor.position.y - hazard.position.y,
      ) <= hazard.radius + this.effectivePartyRadius(actor)).map((hazard) => hazard.id),
      rewardedHazardExitIds: [],
    };
    this.state.phase = "projectile";
    const preview = { actorId: actor.id, aim: cloneJson(this.state.aim), trajectory: cloneJson(trajectory) };
    this.emit("launched", { actorId: actor.id, position: { ...actor.position } });
    if (trajectory.totalDuration <= STEP_EPSILON) this.finishProjectileTurn();
    return preview;
  }

  /** Consumes a turn that cannot accept input, preventing status soft-locks. */
  public skipBlockedTurn(): BattleActionAvailability | null {
    if (this.state.phase !== "awaitingAim" && this.state.phase !== "aiming") return null;
    const availability = this.getActionAvailability();
    if (availability.allowed || !availability.reason) return null;
    const actor = this.activePartyMember();
    this.state.aim = null;
    this.state.phase = "awaitingAim";
    this.state.comboCount = 0;
    this.state.ricochetCount = 0;
    this.emit("heroActionBlocked", {
      actorId: actor.id,
      targetId: actor.id,
      position: actor.position,
      effectKind: availability.reason,
      duration: this.effectsFor(actor.id).find((effect) => effect.kind === availability.reason)?.remainingTurns,
    });
    this.completePartyTurn(actor);
    return availability;
  }

  public advance(deltaSeconds: number): BattleSnapshot {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || this.state.phase !== "projectile") {
      return this.getSnapshot();
    }
    this.state.fixedAccumulator += deltaSeconds;
    let steps = 0;
    while (
      this.state.phase === "projectile"
      && this.state.fixedAccumulator + STEP_EPSILON >= this.state.config.fixedStep
      && steps < this.state.config.maxAdvanceSteps
    ) {
      this.state.fixedAccumulator = Math.max(0, this.state.fixedAccumulator - this.state.config.fixedStep);
      this.stepProjectile(this.state.config.fixedStep);
      steps += 1;
    }
    return this.getSnapshot();
  }

  private activePartyMember(): BattlePartyMemberState {
    const member = this.state.party[this.state.activePartyIndex];
    if (!member) throw new Error("Active party index is invalid.");
    return member;
  }

  private activeHeroDefinition(): HeroDefinition {
    const actor = this.activePartyMember();
    const definition = this.heroById[actor.definitionId];
    if (!definition) throw new Error(`Missing hero definition '${actor.definitionId}'.`);
    return definition;
  }

  private effectsFor(targetId: string): BattleStatusEffectState[] {
    return this.state.effects.filter((effect) => effect.targetId === targetId && effect.remainingTurns > 0);
  }

  private hasEffect(targetId: string, kind: string): boolean {
    return this.state.effects.some(
      (effect) => effect.targetId === targetId && effect.kind === kind && effect.remainingTurns > 0,
    );
  }

  private effectValue(targetId: string, kind: string): number {
    return this.state.effects
      .filter((effect) => effect.targetId === targetId && effect.kind === kind && effect.remainingTurns > 0)
      .reduce((maximum, effect) => Math.max(maximum, effect.value), 0);
  }

  private effectivePartyRadius(member: BattlePartyMemberState): number {
    const multipliers = this.effectsFor(member.id)
      .filter((effect) => effect.kind === "radius-multiplier")
      .map((effect) => effect.value);
    const multiplier = multipliers.length > 0
      ? multipliers.reduce((product, value) => product * value, 1)
      : 1;
    return Math.max(4, member.radius * clamp(multiplier, 0.45, 1.8));
  }

  private applyStatus(
    sourceId: string,
    targetId: string,
    kind: string,
    value: number,
    duration: number,
    deferUntilNextTurn = false,
  ): void {
    let effectiveDuration = Math.max(1, Math.round(duration));
    const targetsParty = this.state.party.some((member) => member.id === targetId);
    if (targetsParty && NEGATIVE_PARTY_STATUS_KINDS.has(kind)) {
      effectiveDuration = Math.max(
        0,
        effectiveDuration + Math.round(Math.min(0, this.relicValue("debuff-duration"))),
      );
    }
    if (
      kind === "stun"
      && this.state.enemies.some((enemy) => enemy.id === targetId)
      && !this.relicEffectUsed("stun-duration")
    ) {
      const bonusTurns = Math.max(0, Math.round(this.relicValue("stun-duration", "max")));
      if (bonusTurns > 0) {
        effectiveDuration += bonusTurns;
        this.markRelicEffectUsed("stun-duration");
      }
    }
    if (effectiveDuration <= 0) {
      this.emit("statusEffectApplied", {
        actorId: this.relicEffect("debuff-duration")?.sourceId ?? sourceId,
        targetId,
        effectKind: "relic-debuff-resisted",
        amount: 0,
        duration: 0,
      });
      return;
    }
    const id = `${sourceId}:${targetId}:${kind}`;
    const existing = this.state.effects.find((effect) => effect.id === id);
    if (existing) {
      existing.value = Math.max(existing.value, value);
      existing.remainingTurns = Math.max(existing.remainingTurns, effectiveDuration);
      existing.appliedTurn = this.state.turnNumber;
      existing.deferUntilNextTurn = existing.deferUntilNextTurn || deferUntilNextTurn;
    } else {
      this.state.effects.push({
        id,
        sourceId,
        targetId,
        kind,
        value,
        remainingTurns: effectiveDuration,
        appliedTurn: this.state.turnNumber,
        deferUntilNextTurn,
      });
    }
    this.emit("statusEffectApplied", {
      actorId: sourceId,
      targetId,
      effectKind: kind,
      amount: value,
      duration: effectiveDuration,
    });
    if (kind === "shrink-enemy" && this.hasModifier("status", "sizeChangesCollider")) {
      this.triggerModifier("sizeChangesCollider", { actorId: sourceId, targetId, amount: value }, value);
    }
  }

  private buildTrajectory(actor: BattlePartyMemberState, aim: AimState): BattleTrajectory {
    const hero = this.activeHeroDefinition();
    const physicsProfile = RICOCHET_PHYSICS_PROFILES[hero.ricochetClass];
    const speedScale = Math.max(0.5, hero.stats.speed / 100);
    const effectiveMass = hero.mass * (
      hero.ricochetClass === "heavy" ? 1 + Math.max(0, this.relicValue("mass")) / 100 : 1
    );
    // Mass now has a readable handling trade-off: light cats launch farther,
    // while heavy cats retain more damage momentum on impact.
    const massSpeedScale = clamp(1 / Math.sqrt(Math.max(0.35, effectiveMass)), 0.82, 1.16);
    const firstShotMultiplier = this.state.completedTurns === 0
      ? 1 + Math.max(0, this.relicValue("first-shot-speed")) / 100
      : 1;
    const launchSpeed = (
      this.state.config.minLaunchSpeed
      + (this.state.config.maxLaunchSpeed - this.state.config.minLaunchSpeed) * aim.power
    ) * speedScale * massSpeedScale * firstShotMultiplier * physicsProfile.launchSpeedMultiplier;
    let velocity = scale(aim.direction, launchSpeed);
    for (const effect of this.effectsFor(actor.id)) {
      if (effect.kind === "wind-vector") velocity = scale(velocity, 1 + effect.value / 100);
      if (effect.kind === "speed-up" || effect.kind === "velocity-multiplier") {
        velocity = scale(velocity, 1 + effect.value / 100);
      }
      if (effect.kind === "slow-field") velocity = scale(velocity, clamp(effect.value, 0.1, 1));
      if (effect.kind === "mirror-trajectory") velocity = vec2(-velocity.x, velocity.y);
    }
    for (const hazard of this.state.hazards) {
      if (!hazard.active || Math.hypot(
        actor.position.x - hazard.position.x,
        actor.position.y - hazard.position.y,
      ) > hazard.radius + actor.radius) continue;
      if (hazard.type === "slow-field") {
        const multiplier = Number(hazard.parameters.speedMultiplier ?? 0.75);
        velocity = scale(velocity, clamp(multiplier, 0.1, 1));
      }
      if (hazard.type === "current" || hazard.type === "wind-vector") {
        if (hazard.parameters.pulseActive === false) continue;
        if (
          hazard.parameters.spiritOnly === true
          && this.heroById[actor.definitionId]?.element !== "spirit"
        ) continue;
        const rotation = hazard.phase * Number(hazard.parameters.rotateEachTurn ?? 0) * Math.PI / 180;
        const sign = Number(hazard.parameters.directionSign ?? 1);
        const windResistance = 1 - clamp(this.relicValue("wind-force-reduction") / 100, 0, 1);
        const forceX = Number(hazard.parameters.forceX ?? 0) * sign * windResistance;
        const forceY = Number(hazard.parameters.forceY ?? 0) * sign * windResistance;
        velocity = add(velocity, vec2(
          forceX * Math.cos(rotation) - forceY * Math.sin(rotation),
          forceX * Math.sin(rotation) + forceY * Math.cos(rotation),
        ));
      }
      if (hazard.type === "whirlpool") {
        if (hazard.parameters.pulseActive === false) continue;
        const toward = normalize(vec2(
          hazard.position.x - actor.position.x,
          hazard.position.y - actor.position.y,
        ));
        const resistance = 1 - clamp(this.relicValue("whirlpool-resistance") / 100, 0, 1);
        velocity = add(velocity, scale(toward, Number(hazard.parameters.force ?? 100) * resistance));
      }
    }
    const lowHpRestitution = actor.hp / actor.maxHp < 0.35
      ? Math.max(0, this.relicValue("low-hp-restitution")) / 100
      : 0;
    const effectiveRestitution = clamp(hero.restitution * (1 + lowHpRestitution), 0, 2);
    const trace = traceRicochet({
      position: actor.position,
      velocity,
      duration: this.state.config.maxProjectileDuration,
      moverRadius: this.effectivePartyRadius(actor),
      colliders: this.buildColliders(actor.id, velocity),
      maxBounces: this.state.config.maxBounces,
      maxCollisions: this.state.config.maxCollisions,
      minSpeed: this.state.config.minProjectileSpeed,
      defaultRestitution: effectiveRestitution,
      defaultFriction: clamp(this.state.config.defaultFriction * physicsProfile.frictionMultiplier, 0, 1),
    });
    return sanitizeTrajectory(trace);
  }

  private relicPhasesThroughWall(activeActorId: string, wallId: string): boolean {
    const chance = clamp(this.relicValue("phase-chance", "max"), 0, 100);
    if (chance <= 0) return false;
    const roll = hashSeed(
      `${this.state.seed}:${this.state.turnNumber}:${this.state.completedTurns}:${activeActorId}:${wallId}:phase`,
    ) / 4294967296;
    return roll < chance / 100;
  }

  private buildColliders(
    activeActorId: string,
    _contactVelocity: Vec2,
    excludedColliderIds: ReadonlySet<string> = new Set(),
  ): Collider[] {
    const colliders: Collider[] = [];
    const { width, height } = this.stage.arena;
    const activeActor = this.state.party.find((member) => member.id === activeActorId);
    const lowHpRestitution = activeActor && activeActor.hp / activeActor.maxHp < 0.35
      ? Math.max(0, this.relicValue("low-hp-restitution")) / 100
      : 0;
    const boundaryHero = activeActor ? this.heroById[activeActor.definitionId] : undefined;
    const boundaryRestitution = clamp(
      (boundaryHero?.restitution ?? this.activeHeroDefinition().restitution) * (1 + lowHpRestitution),
      0,
      2,
    );
    colliders.push(
      { id: "wall:arena-top", type: "segment", a: vec2(0, 0), b: vec2(width, 0), restitution: boundaryRestitution, response: "bounce", tag: "wall" },
      { id: "wall:arena-right", type: "segment", a: vec2(width, 0), b: vec2(width, height), restitution: boundaryRestitution, response: "bounce", tag: "wall" },
      { id: "wall:arena-bottom", type: "segment", a: vec2(width, height), b: vec2(0, height), restitution: boundaryRestitution, response: "bounce", tag: "wall" },
      { id: "wall:arena-left", type: "segment", a: vec2(0, height), b: vec2(0, 0), restitution: boundaryRestitution, response: "bounce", tag: "wall" },
    );
    const phasesThroughWalls = this.hasEffect(activeActorId, "wall-phase");
    const phasesThroughSpiritWalls = this.hasEffect(activeActorId, "portal-affinity-spirit");
    for (const wall of this.stage.walls) {
      const wallState = this.state.walls.find((entry) => entry.id === wall.id);
      if (
        wallState?.broken
        || wallState?.active === false
        || phasesThroughWalls
        || this.relicPhasesThroughWall(activeActorId, wall.id)
        || (phasesThroughSpiritWalls && wall.material === "spirit")
      ) continue;
      const offset = wallState?.offset ?? vec2(0, 0);
      const rotation = wallState?.rotation ?? 0;
      const center = vec2((wall.x + (wall.x2 ?? wall.x)) / 2, (wall.y + (wall.y2 ?? wall.y)) / 2);
      const transformPoint = (point: Vec2): Vec2 => {
        const cosine = Math.cos(rotation);
        const sine = Math.sin(rotation);
        const localX = point.x - center.x;
        const localY = point.y - center.y;
        return vec2(
          center.x + localX * cosine - localY * sine + offset.x,
          center.y + localX * sine + localY * cosine + offset.y,
        );
      };
      if (wall.shape === "circle") {
        colliders.push({
          id: `wall:${wall.id}`,
          type: "circle",
          center: transformPoint(vec2(wall.x, wall.y)),
          radius: Math.max(0, wall.radius ?? 0),
          restitution: wall.restitution,
          response: "bounce",
          tag: "wall",
        });
      } else {
        colliders.push({
          id: `wall:${wall.id}`,
          type: "segment",
          a: transformPoint(vec2(wall.x, wall.y)),
          b: transformPoint(vec2(wall.x2 ?? wall.x, wall.y2 ?? wall.y)),
          radius: wall.shape === "capsule" ? Math.max(0, wall.radius ?? 0) : 0,
          restitution: wall.restitution,
          response: "bounce",
          tag: "wall",
        });
      }
    }

    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      colliders.push({
        id: `enemy:${enemy.id}`,
        type: "circle",
        center: enemy.position,
        radius: this.hasEffect(enemy.id, "shrink-enemy")
          ? enemy.radius * Math.max(0.25, 1 - this.effectValue(enemy.id, "shrink-enemy") / 100)
          : enemy.radius,
        response: "passThrough",
        hitCooldown: this.state.config.enemyHitCooldown,
        tag: "enemy",
      });
      for (const weakpoint of enemy.weakpoints) {
        if (weakpoint.broken) continue;
        const objectiveTarget = this.state.objective.targets.find(
          (target) => target.id === weakpoint.id || target.sourceId === weakpoint.partId,
        );
        if (objectiveTarget && !objectiveTarget.active) continue;
        const material = {
          id: `weakpoint:${weakpoint.id}`,
          response: "passThrough" as const,
          hitCooldown: this.state.config.weakpointHitCooldown,
          tag: "weakpoint",
        };
        if (weakpoint.collider === "capsule") {
          const axis = vec2(Math.cos(weakpoint.rotation), Math.sin(weakpoint.rotation));
          colliders.push({
            ...material,
            type: "segment",
            a: add(weakpoint.position, scale(axis, -weakpoint.halfExtent)),
            b: add(weakpoint.position, scale(axis, weakpoint.halfExtent)),
            radius: weakpoint.radius,
          });
        } else if (weakpoint.collider === "polygon") {
          // The collision library sweeps circles against segments. A convex
          // diamond gives polygon-authored cores real edges without reverting
          // to the oversized circular approximation used by the prototype.
          const cosine = Math.cos(weakpoint.rotation);
          const sine = Math.sin(weakpoint.rotation);
          const local = [
            vec2(0, -weakpoint.radius),
            vec2(weakpoint.halfExtent, 0),
            vec2(0, weakpoint.radius),
            vec2(-weakpoint.halfExtent, 0),
          ].map((point) => add(weakpoint.position, vec2(
            point.x * cosine - point.y * sine,
            point.x * sine + point.y * cosine,
          )));
          for (let index = 0; index < local.length; index += 1) {
            colliders.push({
              ...material,
              type: "segment",
              a: local[index]!,
              b: local[(index + 1) % local.length]!,
              radius: Math.max(2, weakpoint.radius * 0.12),
            });
          }
        } else {
          colliders.push({
            ...material,
            type: "weakpoint",
            center: weakpoint.position,
            radius: weakpoint.radius,
          });
        }
      }
    }

    for (const ally of this.state.party) {
      if (!ally.alive || ally.id === activeActorId) continue;
      const friendshipRadius = 1 + Math.max(0, this.relicValue("friendship-radius")) / 100;
      colliders.push({
        id: `ally:${ally.id}`,
        type: "circle",
        center: ally.position,
        radius: this.effectivePartyRadius(ally) * friendshipRadius,
        response: "passThrough",
        hitCooldown: this.state.config.allyHitCooldown,
        tag: "ally",
      });
    }

    for (const target of this.state.objective.targets) {
      if (!target.active || target.kind === "bossPart" || target.kind === "party") continue;
      colliders.push({
        id: `objective:${target.id}`,
        type: "circle",
        center: target.position,
        radius: target.radius,
        response: target.kind === "exit" ? "stop" : "passThrough",
        hitCooldown: this.state.config.allyHitCooldown,
        tag: "objective",
      });
    }

    for (const hazard of this.state.hazards) {
      if (!hazard.active || hazard.type === "forbidden-target") continue;
      if (
        (hazard.type === "lightning" || hazard.type === "sound-wave" || hazard.type === "wave-front")
        && hazard.parameters.armed !== true
      ) continue;
      if (hazard.type === "wave-front") {
        const movementAxis = String(hazard.parameters.axis ?? "y");
        const length = Math.max(
          hazard.radius * 2,
          Number(hazard.parameters.length ?? (movementAxis === "x" ? this.stage.arena.height : this.stage.arena.width)),
        );
        const half = length / 2;
        colliders.push({
          id: `hazard:${hazard.id}`,
          type: "segment",
          a: movementAxis === "x"
            ? vec2(hazard.position.x, hazard.position.y - half)
            : vec2(hazard.position.x - half, hazard.position.y),
          b: movementAxis === "x"
            ? vec2(hazard.position.x, hazard.position.y + half)
            : vec2(hazard.position.x + half, hazard.position.y),
          radius: hazard.radius,
          response: "passThrough",
          hitCooldown: 0.2,
          tag: "hazard-wave-front",
        });
        continue;
      }
      if (hazard.type === "moving-bumper" && hazard.parameters.shape === "segment") {
        const angle = Number(hazard.parameters.angle ?? 0);
        const halfLength = Math.max(hazard.radius, Number(hazard.parameters.length ?? 220) / 2);
        const axis = vec2(Math.cos(angle), Math.sin(angle));
        colliders.push({
          id: `hazard:${hazard.id}`,
          type: "segment",
          a: add(hazard.position, scale(axis, -halfLength)),
          b: add(hazard.position, scale(axis, halfLength)),
          radius: hazard.radius,
          restitution: clamp(Number(hazard.parameters.restitution ?? 1), 0, 2),
          response: "bounce",
          hitCooldown: 0.2,
          tag: "hazard-temporary-wall",
        });
        continue;
      }
      colliders.push({
        id: `hazard:${hazard.id}`,
        type: "circle",
        center: hazard.position,
        radius: hazard.radius,
        restitution: clamp(Number(hazard.parameters.restitution ?? 1), 0, 2),
        // One-way walls must decide at the actual contact after any earlier
        // ricochets. They trace as sensors and are promoted to a bounce in
        // processContact using that contact's velocity and normal.
        response: hazard.type === "moving-bumper" ? "bounce" : "passThrough",
        hitCooldown: 0.2,
        tag: "hazard",
      });
      if (hazard.type === "whirlpool") {
        const lethalRadius = Math.max(0, Number(hazard.parameters.lethalRadius ?? 0));
        if (lethalRadius > 0 && hazard.parameters.pulseActive !== false) {
          colliders.push({
            id: `hazardLethal:${hazard.id}`,
            type: "circle",
            center: hazard.position,
            radius: lethalRadius,
            response: "passThrough",
            hitCooldown: 0.2,
            tag: "hazard-lethal",
          });
        }
      }
    }
    return colliders.filter((collider) => !excludedColliderIds.has(collider.id));
  }

  private enemyObstacleColliders(
    enemy: BattleEnemyState,
    targetId?: string,
    includeActors = true,
  ): Collider[] {
    const result: Collider[] = [];
    const { width, height } = this.stage.arena;
    result.push(
      { id: "cover:arena-top", type: "segment", a: vec2(0, 0), b: vec2(width, 0), response: "stop" },
      { id: "cover:arena-right", type: "segment", a: vec2(width, 0), b: vec2(width, height), response: "stop" },
      { id: "cover:arena-bottom", type: "segment", a: vec2(width, height), b: vec2(0, height), response: "stop" },
      { id: "cover:arena-left", type: "segment", a: vec2(0, height), b: vec2(0, 0), response: "stop" },
    );
    for (const wall of this.stage.walls) {
      const wallState = this.state.walls.find((entry) => entry.id === wall.id);
      if (wallState?.broken || wallState?.active === false) continue;
      const offset = wallState?.offset ?? vec2(0, 0);
      const rotation = wallState?.rotation ?? 0;
      const center = vec2((wall.x + (wall.x2 ?? wall.x)) / 2, (wall.y + (wall.y2 ?? wall.y)) / 2);
      const transform = (point: Vec2): Vec2 => {
        const cosine = Math.cos(rotation);
        const sine = Math.sin(rotation);
        const localX = point.x - center.x;
        const localY = point.y - center.y;
        return vec2(
          center.x + localX * cosine - localY * sine + offset.x,
          center.y + localX * sine + localY * cosine + offset.y,
        );
      };
      if (wall.shape === "circle") {
        result.push({
          id: `cover:${wall.id}`,
          type: "circle",
          center: transform(vec2(wall.x, wall.y)),
          radius: Math.max(0, wall.radius ?? 0),
          response: "stop",
        });
      } else {
        result.push({
          id: `cover:${wall.id}`,
          type: "segment",
          a: transform(vec2(wall.x, wall.y)),
          b: transform(vec2(wall.x2 ?? wall.x, wall.y2 ?? wall.y)),
          radius: wall.shape === "capsule" ? Math.max(0, wall.radius ?? 0) : 0,
          response: "stop",
        });
      }
    }
    for (const hazard of this.state.hazards) {
      if (!hazard.active || (hazard.type !== "moving-bumper" && hazard.type !== "one-way-wall")) continue;
      if (hazard.type === "moving-bumper" && hazard.parameters.shape === "segment") {
        const angle = Number(hazard.parameters.angle ?? 0);
        const halfLength = Math.max(hazard.radius, Number(hazard.parameters.length ?? 220) / 2);
        const axis = vec2(Math.cos(angle), Math.sin(angle));
        result.push({
          id: `cover-hazard:${hazard.id}`,
          type: "segment",
          a: add(hazard.position, scale(axis, -halfLength)),
          b: add(hazard.position, scale(axis, halfLength)),
          radius: hazard.radius,
          response: "stop",
        });
      } else {
        result.push({
          id: `cover-hazard:${hazard.id}`,
          type: "circle",
          center: hazard.position,
          radius: hazard.radius,
          response: "stop",
        });
      }
    }
    if (!includeActors) return result;
    for (const other of this.state.enemies) {
      if (!other.alive || other.id === enemy.id || other.id === targetId) continue;
      result.push({ id: `cover-enemy:${other.id}`, type: "circle", center: other.position, radius: other.radius + 3, response: "stop" });
    }
    for (const member of this.state.party) {
      if (!member.alive || member.id === targetId) continue;
      result.push({ id: `cover-party:${member.id}`, type: "circle", center: member.position, radius: member.radius + 2, response: "stop" });
    }
    for (const target of this.protectedObjectiveTargets()) {
      if (target.id === targetId) continue;
      result.push({ id: `cover-objective:${target.id}`, type: "circle", center: target.position, radius: target.radius + 2, response: "stop" });
    }
    return result;
  }

  private traceEnemyTravel(
    enemy: BattleEnemyState,
    target: EnemySpatialTarget,
    maximumDistance: number,
    maxBounces = 0,
  ): { readonly position: Vec2; readonly distance: number; readonly path: readonly Vec2[]; readonly blockedBy?: string } {
    const offset = vec2(target.position.x - enemy.position.x, target.position.y - enemy.position.y);
    const distance = Math.hypot(offset.x, offset.y);
    const stopDistance = enemy.radius + target.radius + 4;
    const requested = Math.min(Math.max(0, maximumDistance), Math.max(0, distance - stopDistance));
    if (requested <= STEP_EPSILON) return { position: { ...enemy.position }, distance: 0, path: [{ ...enemy.position }] };
    const trace = traceRicochet({
      position: enemy.position,
      velocity: scale(normalize(offset), requested),
      duration: 1,
      moverRadius: enemy.radius,
      colliders: this.enemyObstacleColliders(enemy, target.id).map((collider) => maxBounces > 0
        ? { ...collider, response: "bounce" as const, restitution: 0.36 }
        : collider),
      maxBounces,
      maxCollisions: 8,
      minSpeed: 0,
      defaultRestitution: 0,
      defaultFriction: 0,
    });
    return {
      position: { ...trace.finalPosition },
      distance: Math.hypot(trace.finalPosition.x - enemy.position.x, trace.finalPosition.y - enemy.position.y),
      path: trace.points.map((point) => ({ ...point })),
      blockedBy: maxBounces > 0 ? undefined : trace.collisions[0]?.collider.id,
    };
  }

  private traceEnemyProjectile(
    enemy: BattleEnemyState,
    target: EnemySpatialTarget,
  ): { readonly clear: boolean; readonly impact: Vec2; readonly blockedBy?: string; readonly duration: number } {
    const displacement = vec2(target.position.x - enemy.position.x, target.position.y - enemy.position.y);
    const distance = Math.hypot(displacement.x, displacement.y);
    if (distance <= STEP_EPSILON) {
      return { clear: true, impact: { ...target.position }, duration: 0 };
    }
    const projectileSpeed = Math.max(1, this.enemyBehaviorNumber(enemy, "projectileSpeed", distance));
    const projectileRadius = Math.max(1, this.enemyBehaviorNumber(enemy, "projectileRadius", 5));
    const leadFactor = clamp(this.enemyBehaviorNumber(enemy, "leadFactor", 0), 0, 1);
    const duration = distance / projectileSpeed;
    const trace = traceRicochet({
      position: enemy.position,
      velocity: scale(normalize(displacement), projectileSpeed),
      duration,
      moverRadius: projectileRadius * (1 + leadFactor * 0.12),
      // Ranged cover is authored terrain. Other units do not accidentally
      // absorb the shot, keeping target selection legible.
      colliders: this.enemyObstacleColliders(enemy, target.id, false).filter((collider) => !collider.id.startsWith("cover:arena")),
      maxBounces: 0,
      maxCollisions: 4,
      minSpeed: 0,
      defaultRestitution: 0,
      defaultFriction: 0,
    });
    const collision = trace.collisions[0];
    return collision
      ? { clear: false, impact: { ...collision.contactPoint }, blockedBy: collision.collider.id, duration: collision.elapsedTime }
      : { clear: true, impact: { ...target.position }, duration };
  }

  private damageTemporaryWall(blockedBy: string | undefined, amount: number, position: Vec2): boolean {
    const prefix = "cover-hazard:";
    if (!blockedBy?.startsWith(prefix)) return false;
    const hazardId = blockedBy.slice(prefix.length);
    const hazard = this.state.hazards.find((entry) => entry.id === hazardId && entry.active && entry.spawnedBy);
    const maxHp = Number(hazard?.parameters.maxHp ?? 0);
    const hpBefore = Number(hazard?.parameters.hp ?? maxHp);
    if (!hazard || maxHp <= 0 || hpBefore <= 0) return false;
    const applied = Math.max(1, Math.min(hpBefore, Math.round(amount)));
    const hpAfter = Math.max(0, hpBefore - applied);
    hazard.parameters.hp = hpAfter;
    this.emit("wallDamaged", {
      actorId: "enemy",
      targetId: hazard.id,
      position,
      amount: applied,
      hpBefore,
      hpAfter,
      current: hpAfter,
      required: maxHp,
      effectKind: "temporary-wall",
    });
    if (hpAfter <= 0) {
      hazard.active = false;
      this.emit("wallBroken", {
        actorId: "enemy",
        targetId: hazard.id,
        position: hazard.position,
        effectKind: "temporary-wall",
      });
    }
    return true;
  }

  private retraceProjectileFrom(
    projectile: BattleProjectileState,
    start: Vec2,
    velocity: Vec2,
    excludedColliderIds: ReadonlySet<string>,
  ): void {
    const remainingDuration = Math.max(0, projectile.trajectory.totalDuration - projectile.elapsed);
    if (remainingDuration <= STEP_EPSILON) return;
    const actor = this.state.party.find((member) => member.id === projectile.actorId);
    const hero = actor ? this.heroById[actor.definitionId] : undefined;
    if (!actor || !hero) return;
    const trace = traceRicochet({
      position: start,
      velocity,
      duration: remainingDuration,
      moverRadius: this.effectivePartyRadius(actor),
      colliders: this.buildColliders(actor.id, velocity, excludedColliderIds),
      maxBounces: this.state.config.maxBounces,
      maxCollisions: this.state.config.maxCollisions,
      minSpeed: this.state.config.minProjectileSpeed,
      defaultRestitution: hero.restitution,
      defaultFriction: this.state.config.defaultFriction,
    });
    const tail = sanitizeTrajectory(trace);
    const offset = projectile.elapsed;
    const processedContacts = projectile.trajectory.contacts.slice(0, projectile.contactIndex);
    const prefixSegments = projectile.trajectory.segments.filter((segment) => segment.endTime <= offset + STEP_EPSILON);
    const shiftedSegments = tail.segments.map((segment) => ({
      ...segment,
      startTime: segment.startTime + offset,
      endTime: segment.endTime + offset,
    }));
    const shiftedContacts = tail.contacts.map((contact) => ({
      ...contact,
      elapsedTime: contact.elapsedTime + offset,
    }));
    projectile.trajectory = {
      ...projectile.trajectory,
      finalPosition: { ...tail.finalPosition },
      finalVelocity: { ...tail.finalVelocity },
      totalDuration: offset + tail.totalDuration,
      traceTermination: tail.traceTermination,
      bounceCount: projectile.lastBounceIndex + tail.bounceCount,
      points: [...projectile.trajectory.points.filter((_point, index) => index <= projectile.contactIndex + 1), { ...start }, ...tail.points],
      segments: [...prefixSegments, ...shiftedSegments],
      contacts: [...processedContacts, ...shiftedContacts],
    };
    projectile.contactIndex = processedContacts.length;
    projectile.position = { ...start };
    projectile.velocity = { ...velocity };
    actor.position = { ...start };
  }

  private clearRetraceStart(
    projectile: BattleProjectileState,
    position: Vec2,
    velocity: Vec2,
    colliderId: string,
    fallbackDirection: Vec2,
  ): Vec2 {
    const actor = this.state.party.find((member) => member.id === projectile.actorId);
    if (!actor) return { ...position };
    const collider = this.buildColliders(actor.id, velocity).find((entry) => entry.id === colliderId);
    const moverRadius = this.effectivePartyRadius(actor);
    const primary = normalize(velocity, normalize(fallbackDirection, vec2(1, 0)));
    if (!collider) return add(position, scale(primary, 3));

    let candidate = { ...position };
    for (let step = 0; step < 96; step += 1) {
      if (!expandedColliderContainsPoint(collider, candidate, moverRadius)) {
        return add(candidate, scale(primary, 2));
      }
      candidate = add(candidate, scale(primary, 3));
    }

    const fallback = normalize(fallbackDirection, primary);
    candidate = { ...position };
    for (let step = 0; step < 96; step += 1) {
      if (!expandedColliderContainsPoint(collider, candidate, moverRadius)) {
        return add(candidate, scale(fallback, 2));
      }
      candidate = add(candidate, scale(fallback, 3));
    }
    return add(position, scale(fallback, moverRadius + 6));
  }

  private velocityAfterContact(projectile: BattleProjectileState): Vec2 {
    const outgoing = projectile.trajectory.segments.find((segment) =>
      segment.startTime >= projectile.elapsed - STEP_EPSILON
      && segment.endTime > projectile.elapsed + STEP_EPSILON);
    if (outgoing) return { ...outgoing.velocity };
    const remaining = projectile.trajectory.segments.find(
      (segment) => segment.endTime > projectile.elapsed + STEP_EPSILON,
    );
    return { ...(remaining?.velocity ?? projectile.trajectory.finalVelocity) };
  }

  private oneWayWallBlocks(
    hazard: BattleHazardState,
    velocity: Vec2,
    contactNormal: Vec2,
  ): boolean {
    const allowedAngle = (
      Number(hazard.parameters.allowedAngle ?? 0)
      + hazard.phase * Number(hazard.parameters.rotateEachTurn ?? 0)
    ) * Math.PI / 180;
    const allowedDirection = vec2(Math.cos(allowedAngle), Math.sin(allowedAngle));
    const direction = normalize(velocity, scale(contactNormal, -1));
    const directionDot = clamp(
      direction.x * allowedDirection.x + direction.y * allowedDirection.y,
      -1,
      1,
    );
    const difference = Math.acos(directionDot) * 180 / Math.PI;
    const blockedArc = clamp(Number(hazard.parameters.blockedArc ?? 180), 0, 360);
    const passHalfArc = Math.max(0, (360 - blockedArc) / 2);
    const entersAllowedFace = contactNormal.x * allowedDirection.x
      + contactNormal.y * allowedDirection.y <= STEP_EPSILON;
    return !(entersAllowedFace && difference <= passHalfArc + STEP_EPSILON);
  }

  private stepProjectile(step: number): void {
    const projectile = this.state.projectile;
    if (!projectile) return;
    const previousElapsed = projectile.elapsed;
    const nextElapsed = Math.min(projectile.trajectory.totalDuration, previousElapsed + step);
    const stepStartBattleTime = this.state.battleTime;

    while (projectile.contactIndex < projectile.trajectory.contacts.length) {
      const contact = projectile.trajectory.contacts[projectile.contactIndex]!;
      if (contact.elapsedTime > nextElapsed + STEP_EPSILON) break;
      projectile.elapsed = contact.elapsedTime;
      projectile.position = { ...contact.position };
      this.activePartyMember().position = { ...contact.position };
      this.state.battleTime = stepStartBattleTime + Math.max(0, contact.elapsedTime - previousElapsed);
      projectile.contactIndex += 1;
      this.processContact(projectile, contact);
      const actor = this.state.party.find((member) => member.id === projectile.actorId);
      if (!actor?.alive) {
        if (this.state.phase === "projectile" && this.state.projectile === projectile) {
          projectile.teleportDestination = { ...projectile.position };
          projectile.trajectory.finalPosition = { ...projectile.position };
          projectile.trajectory.finalVelocity = vec2(0, 0);
          projectile.trajectory.totalDuration = projectile.elapsed;
          projectile.trajectory.contacts = projectile.trajectory.contacts.slice(0, projectile.contactIndex);
          this.finishProjectileTurn();
        }
        return;
      }
      if (this.state.projectile !== projectile) return;
      if (this.state.phase === "victory" || this.state.phase === "defeat") return;
    }

    const pose = trajectoryPositionAt(projectile.trajectory, nextElapsed);
    projectile.elapsed = nextElapsed;
    projectile.position = pose.position;
    projectile.velocity = pose.velocity;
    this.activePartyMember().position = { ...pose.position };
    this.state.battleTime = stepStartBattleTime + (nextElapsed - previousElapsed);
    this.resolveRelicHazardExits(projectile);
    if (nextElapsed >= projectile.trajectory.totalDuration - STEP_EPSILON) this.finishProjectileTurn();
  }

  private resolveRelicHazardExits(projectile: BattleProjectileState): void {
    const healAmount = Math.max(0, Math.round(this.relicValue("heal-on-hazard-exit")));
    if (healAmount <= 0) return;
    const actor = this.state.party.find((member) => member.id === projectile.actorId && member.alive);
    if (!actor) return;
    projectile.enteredHazardIds ??= [];
    projectile.rewardedHazardExitIds ??= [];
    for (const hazardId of projectile.enteredHazardIds) {
      if (projectile.rewardedHazardExitIds.includes(hazardId)) continue;
      const hazard = this.state.hazards.find((entry) => entry.id === hazardId);
      if (hazard && Math.hypot(
        actor.position.x - hazard.position.x,
        actor.position.y - hazard.position.y,
      ) <= hazard.radius + this.effectivePartyRadius(actor)) continue;
      projectile.rewardedHazardExitIds.push(hazardId);
      const hpBefore = actor.hp;
      actor.hp = Math.min(actor.maxHp, actor.hp + healAmount);
      const applied = actor.hp - hpBefore;
      if (applied <= 0) continue;
      this.emit("statusEffectApplied", {
        actorId: this.relicEffect("heal-on-hazard-exit")?.sourceId ?? actor.id,
        targetId: actor.id,
        position: actor.position,
        effectKind: "relic-heal-on-hazard-exit",
        amount: applied,
        hpBefore,
        hpAfter: actor.hp,
        duration: 1,
      });
    }
  }

  private processContact(projectile: BattleProjectileState, contact: BattleTrajectoryContact): void {
    const actor = this.state.party.find((member) => member.id === projectile.actorId);
    if (!actor?.alive) return;
    const hazard = contact.targetKind === "hazard"
      ? this.state.hazards.find((entry) => entry.id === contact.targetId)
      : undefined;
    if (hazard?.type === "one-way-wall" && contact.hitAccepted) {
      const velocity = this.velocityAfterContact(projectile);
      if (this.oneWayWallBlocks(hazard, velocity, contact.normal)) {
        contact.response = "bounce";
        contact.bounceIndex = projectile.lastBounceIndex + 1;
      }
    }
    if (contact.response === "bounce" && contact.bounceIndex > projectile.lastBounceIndex) {
      projectile.lastBounceIndex = contact.bounceIndex;
      this.state.ricochetCount += 1;
      this.emit("ricochet", {
        actorId: projectile.actorId,
        targetId: contact.targetId,
        position: contact.position,
        ricochets: this.state.ricochetCount,
      });
    }
    if (!contact.hitAccepted) return;
    const impact = this.heroImpactContext(projectile, contact);
    if (contact.targetKind === "wall") {
      const geometryChanged = this.damageWall(contact.targetId, contact.position, impact);
      if (geometryChanged) {
        const velocity = this.velocityAfterContact(projectile);
        const start = this.clearRetraceStart(
          projectile,
          contact.position,
          velocity,
          contact.colliderId,
          contact.normal,
        );
        this.retraceProjectileFrom(projectile, start, velocity, new Set());
      }
      return;
    }
    if (contact.targetKind === "ally") {
      const hadWallPhase = this.hasEffect(projectile.actorId, "wall-phase");
      const windBefore = this.effectValue(projectile.actorId, "wind-vector");
      this.emit("allyContact", {
        actorId: projectile.actorId,
        targetId: contact.targetId,
        position: contact.position,
      });
      if (this.hasModifier("status", "allyContactCleansesSleep")) {
        const ids = new Set([projectile.actorId, contact.targetId]);
        this.state.effects = this.state.effects.filter(
          (effect) => !(ids.has(effect.targetId) && ["sleep-stack", "slow-field", "stun"].includes(effect.kind)),
        );
        this.triggerModifier("allyContactCleansesSleep", {
          actorId: projectile.actorId,
          targetId: contact.targetId,
          position: contact.position,
        });
      }
      if (this.hasModifier("status", "allyHitRemovesStack")) {
        for (const id of [projectile.actorId, contact.targetId]) {
          const stack = this.state.effects.find((effect) => effect.targetId === id && effect.kind === "sleep-stack");
          if (stack) stack.value = Math.max(0, stack.value - 1);
        }
        this.state.effects = this.state.effects.filter((effect) => effect.kind !== "sleep-stack" || effect.value > 0);
        this.triggerModifier("allyHitRemovesStack", {
          actorId: projectile.actorId,
          targetId: contact.targetId,
          position: contact.position,
        });
      }
      if (this.hasModifier("formation", "fatherSonLinkOpensCore")) {
        const actorDefinition = this.heroById[projectile.actorId];
        const allyDefinition = this.heroById[contact.targetId];
        const pair = new Set([actorDefinition?.id, allyDefinition?.id]);
        if (pair.has("meow-dysseus") && pair.has("tele-meow-chus")) {
          for (const target of this.state.objective.targets.filter((entry) => entry.sourceId.includes("core"))) {
            target.active = true;
          }
          this.triggerModifier("fatherSonLinkOpensCore", {
            actorId: projectile.actorId,
            targetId: contact.targetId,
            position: contact.position,
          }, 1);
          this.emit("formationChanged", { effectKind: "fatherSonLinkOpensCore", position: contact.position });
        }
      }
      const friendshipKey = [projectile.actorId, contact.targetId].sort().join("|");
      if (!projectile.friendshipTriggerKeys.includes(friendshipKey)) {
        projectile.friendshipTriggerKeys.push(friendshipKey);
        this.triggerFriendshipSkill(
          projectile.actorId,
          contact.targetId,
          contact.position,
          normalize(this.velocityAfterContact(projectile), vec2(0, -1)),
          projectile.lastHitEnemyId,
        );
      }
      const speedAfterAlly = Math.max(0, this.relicValue("speed-after-ally"));
      if (speedAfterAlly > 0) this.emit("statusEffectApplied", {
        actorId: this.relicEffect("speed-after-ally")?.sourceId ?? projectile.actorId,
        targetId: projectile.actorId,
        effectKind: "relic-speed-after-ally",
        amount: speedAfterAlly,
        duration: 1,
      });
      const gainedWallPhase = !hadWallPhase && this.hasEffect(projectile.actorId, "wall-phase");
      const windAfter = this.effectValue(projectile.actorId, "wind-vector");
      if (gainedWallPhase || windAfter > windBefore || speedAfterAlly > 0) {
        const contactVelocity = this.velocityAfterContact(projectile);
        const adjustedVelocity = scale(
          contactVelocity,
          (1 + Math.max(0, windAfter - windBefore) / 100) * (1 + speedAfterAlly / 100),
        );
        const direction = normalize(adjustedVelocity, vec2(0, -1));
        const actor = this.state.party.find((member) => member.id === projectile.actorId);
        const ally = this.state.party.find((member) => member.id === contact.targetId);
        const clearance = (actor ? this.effectivePartyRadius(actor) : 1)
          + (ally ? this.effectivePartyRadius(ally) : 1) + 3;
        const start = add(contact.position, scale(direction, clearance));
        this.retraceProjectileFrom(
          projectile,
          start,
          adjustedVelocity,
          new Set([contact.colliderId]),
        );
      }
      return;
    }
    if (contact.targetKind === "enemy") {
      this.damageEnemy(contact.targetId, null, contact.position, impact);
      projectile.lastHitEnemyId = contact.targetId;
      const target = this.state.enemies.find((entry) => entry.id === contact.targetId);
      if (target) this.applyBurnOnContact(target, contact.position);
      this.boostPierceSpeed(projectile, contact);
    }
    if (contact.targetKind === "weakpoint") {
      projectile.precisionChain = (projectile.precisionChain ?? 0) + 1;
      const precisionMultiplier = 1 + Math.max(0, projectile.precisionChain - 1)
        * Math.max(0, this.relicValue("precision-chain")) / 100;
      this.damageWeakpoint(contact.targetId, contact.position, precisionMultiplier, impact);
      const owner = this.state.enemies.find((entry) => entry.weakpoints.some((weakpoint) => weakpoint.id === contact.targetId));
      if (owner) {
        projectile.lastHitEnemyId = owner.id;
        this.applyBurnOnContact(owner, contact.position);
      }
      this.boostPierceSpeed(projectile, contact);
    }
    if (contact.targetKind === "objective") {
      this.hitObjectiveTarget(contact.targetId, contact.position, impact);
    }
    if (contact.targetKind === "hazard") {
      projectile.enteredHazardIds ??= [];
      if (!projectile.enteredHazardIds.includes(contact.targetId)) projectile.enteredHazardIds.push(contact.targetId);
      this.triggerHazard(projectile, contact);
    }
  }

  private heroImpactContext(
    projectile: BattleProjectileState,
    contact: BattleTrajectoryContact,
  ): HeroImpactContext {
    const segment = projectile.trajectory.segments.find((entry) => (
      contact.elapsedTime >= entry.startTime - STEP_EPSILON
      && contact.elapsedTime <= entry.endTime + STEP_EPSILON
      && entry.collisionIds.includes(contact.colliderId)
    )) ?? [...projectile.trajectory.segments].reverse().find(
      (entry) => entry.startTime <= contact.elapsedTime + STEP_EPSILON,
    );
    const incoming = segment?.velocity ?? projectile.velocity;
    const initial = projectile.trajectory.initialVelocity;
    const direction = normalize(incoming, vec2(0, -1));
    const normal = normalize(contact.normal, vec2(0, 1));
    return {
      impactSpeed: Math.hypot(incoming.x, incoming.y),
      referenceSpeed: Math.max(1, Math.hypot(initial.x, initial.y)),
      incidence: Math.abs(direction.x * normal.x + direction.y * normal.y),
      ricochetCount: Math.max(0, projectile.lastBounceIndex),
      comboCount: Math.max(0, this.state.comboCount),
    };
  }

  private boostPierceSpeed(projectile: BattleProjectileState, contact: BattleTrajectoryContact): void {
    const bonus = Math.max(0, this.relicValue("pierce-retained-speed"));
    if (
      bonus <= 0
      || contact.response !== "passThrough"
      || projectile.pierceBoostContactIds?.includes(contact.colliderId)
      || this.state.projectile !== projectile
    ) return;
    projectile.pierceBoostContactIds ??= [];
    projectile.pierceBoostContactIds.push(contact.colliderId);
    const velocity = scale(this.velocityAfterContact(projectile), 1 + bonus / 100);
    const start = this.clearRetraceStart(
      projectile,
      contact.position,
      velocity,
      contact.colliderId,
      normalize(velocity, contact.normal),
    );
    this.retraceProjectileFrom(projectile, start, velocity, new Set());
  }

  private applyBurnOnContact(enemy: BattleEnemyState, position: Vec2): void {
    const burnPercent = Math.max(0, this.relicValue("burn-damage"));
    if (!enemy.alive || burnPercent <= 0) return;
    const damage = Math.max(1, Math.round(this.activeHeroDefinition().stats.attack * burnPercent / 100));
    this.applyStatus(
      this.relicEffect("burn-damage")?.sourceId ?? this.activePartyMember().id,
      enemy.id,
      "burn",
      damage,
      2,
    );
    this.emit("hazardTriggered", {
      actorId: this.activePartyMember().id,
      targetId: enemy.id,
      position,
      effectKind: "relic-burn",
      amount: damage,
      duration: 2,
    });
  }

  private damageWall(wallId: string, position: Vec2, impact: HeroImpactContext): boolean {
    const wall = this.state.walls.find((entry) => entry.id === wallId);
    const authoredWall = this.stage.walls.find((entry) => entry.id === wallId);
    let geometryChanged = false;
    if (wall && this.hasModifier("formation", "furnitureMovesAfterCollision")) {
      wall.offset = this.clampWallOffset(
        authoredWall,
        wall,
        vec2(wall.offset.x + (wall.offset.x >= 0 ? -45 : 45), wall.offset.y + 18),
      );
      geometryChanged = true;
      this.emitWallMoved(wall, "furniture-collision");
      this.triggerModifier("furnitureMovesAfterCollision", { targetId: wall.id, position }, wall.offset.x);
    }
    if (authoredWall?.material === "bronze" && this.hasModifier("wall", "bronzeWallsGroundLightning")) {
      this.applyStatus(wallId, this.activePartyMember().id, "lightning-grounded", 1, 1);
      this.triggerModifier("bronzeWallsGroundLightning", { targetId: wallId, position }, 1);
    }
    this.reduceSuctionFromAuthoredAnchor(wallId, position);
    if (this.hasModifier("trajectory", "mirrorTrajectoryOnWrongWall")) {
      // The penalty applies to the next launch. Deferring the tick keeps the
      // effect alive after the current projectile turn instead of deleting it
      // before buildTrajectory can ever read it.
      this.applyStatus(wallId, this.activePartyMember().id, "mirror-trajectory", 1, 1, true);
      this.triggerModifier("mirrorTrajectoryOnWrongWall", { targetId: wallId, position });
    }
    if (!wall?.breakable || wall.broken) return geometryChanged;
    const wallDamageMultiplier = 1 + Math.max(0, this.relicValue("wall-damage")) / 100;
    const roll = this.rollHeroDamage(wallDamageMultiplier, 0, impact);
    const capped = capHeroContactDamage({ rawDamage: roll.damage, targetMaxHp: wall.maxHp, target: "wall" });
    wall.hp = Math.max(0, wall.hp - capped.damage);
    this.emit("wallDamaged", {
      actorId: this.activePartyMember().id,
      targetId: wall.id,
      amount: capped.damage,
      position,
      impactGrade: roll.grade,
      speedRatio: roll.speedRatio,
      incidence: roll.incidence,
      damageMultiplier: roll.multiplier,
      damageCapped: capped.capped,
    });
    if (wall.hp > 0) return geometryChanged;
    wall.broken = true;
    geometryChanged = true;
    this.emit("wallBroken", {
      actorId: this.activePartyMember().id,
      targetId: wall.id,
      position,
    });
    if (this.hasModifier("wall", "breakableWallOpensRearRoute")) {
      this.triggerModifier("breakableWallOpensRearRoute", { targetId: wall.id, position }, 1);
    }
    return geometryChanged;
  }

  private emitWallMoved(wall: BattleWallState, effectKind: string): void {
    const authored = this.stage.walls.find((entry) => entry.id === wall.id);
    const position = authored ? vec2(
      (authored.x + (authored.x2 ?? authored.x)) / 2 + wall.offset.x,
      (authored.y + (authored.y2 ?? authored.y)) / 2 + wall.offset.y,
    ) : undefined;
    this.emit("wallMoved", {
      targetId: wall.id,
      position,
      offset: wall.offset,
      rotation: wall.rotation,
      active: wall.active,
      effectKind,
    });
  }

  private clampWallOffset(
    authoredWall: StageDefinition["walls"][number] | undefined,
    wall: BattleWallState,
    desired: Vec2,
  ): Vec2 {
    if (!authoredWall) return vec2(0, 0);
    const center = vec2(
      (authoredWall.x + (authoredWall.x2 ?? authoredWall.x)) / 2,
      (authoredWall.y + (authoredWall.y2 ?? authoredWall.y)) / 2,
    );
    const cosine = Math.cos(wall.rotation);
    const sine = Math.sin(wall.rotation);
    const rotate = (point: Vec2): Vec2 => {
      const localX = point.x - center.x;
      const localY = point.y - center.y;
      return vec2(
        center.x + localX * cosine - localY * sine,
        center.y + localX * sine + localY * cosine,
      );
    };
    const points = authoredWall.shape === "circle"
      ? [vec2(authoredWall.x, authoredWall.y)]
      : [
        rotate(vec2(authoredWall.x, authoredWall.y)),
        rotate(vec2(authoredWall.x2 ?? authoredWall.x, authoredWall.y2 ?? authoredWall.y)),
      ];
    const radius = Math.max(0, authoredWall.radius ?? 0);
    const minX = Math.min(...points.map((point) => point.x)) - radius;
    const maxX = Math.max(...points.map((point) => point.x)) + radius;
    const minY = Math.min(...points.map((point) => point.y)) - radius;
    const maxY = Math.max(...points.map((point) => point.y)) + radius;
    return vec2(
      clamp(desired.x, -minX, this.stage.arena.width - maxX),
      clamp(desired.y, -minY, this.stage.arena.height - maxY),
    );
  }

  private reduceSuctionFromAuthoredAnchor(anchorId: string, position: Vec2): void {
    if (!this.hasModifier("hazard", "anchorHitsReduceSuction") || !/(anchor|mooring)/i.test(anchorId)) return;
    for (const hazard of this.state.hazards.filter((entry) => entry.type === "whirlpool")) {
      const baseForce = Number(hazard.parameters.anchorBaseForce ?? hazard.parameters.force ?? 0);
      hazard.parameters.anchorBaseForce = baseForce;
      const hits = Math.min(3, Math.round(Number(hazard.parameters.anchorHits ?? 0)) + 1);
      hazard.parameters.anchorHits = hits;
      hazard.parameters.force = baseForce * Math.max(0.35, 1 - hits * 0.2);
    }
    this.triggerModifier("anchorHitsReduceSuction", { targetId: anchorId, position });
  }

  private objectiveTargetsFor(id: string): BattleObjectiveTargetState[] {
    return this.state.objective.targets.filter((target) => target.id === id || target.sourceId === id);
  }

  private setPropState(
    target: BattleObjectiveTargetState,
    state: BattlePropState["state"],
    actionId?: string,
  ): void {
    const prop = this.state.props.find((entry) => entry.id === target.id);
    if (!prop) return;
    const authored = this.stage.spawns.find((entry) => entry.kind === "prop" && entry.id === target.sourceId);
    const previousState = prop.state;
    const previousVisualState = prop.visualState;
    const previousProgress = prop.progress;
    const previousPosition = { ...prop.position };
    prop.hp = target.hp;
    prop.active = target.active;
    prop.position = { ...target.position };
    prop.state = state;
    prop.interactionMode = authored?.interaction?.mode ?? prop.interactionMode;
    if (prop.interactionMode === "assembly") {
      const assembly = authored?.interaction?.mode === "assembly" ? authored.interaction : undefined;
      prop.requiredProgress = Math.max(1, Math.round(assembly?.hitsRequired ?? prop.requiredProgress));
      prop.progress = Math.min(prop.requiredProgress, target.hitCount);
      prop.visualState = target.completed ? "lashed" : target.hitCount > 0 ? "positioned" : "unlashed";
    } else if (prop.interactionMode === "destructible") {
      prop.requiredProgress = Math.max(1, target.maxHp);
      prop.progress = Math.min(prop.requiredProgress, target.maxHp - target.hp);
      const ratio = target.maxHp > 0 ? target.hp / target.maxHp : 0;
      prop.visualState = ratio <= 0 ? "stump" : ratio <= 0.34 ? "fallen" : ratio <= 0.67 ? "damaged" : "intact";
    } else if (prop.interactionMode === "bond") {
      prop.requiredProgress = Math.max(1, target.maxHp);
      prop.progress = Math.min(prop.requiredProgress, target.maxHp - target.hp);
      const ratio = target.maxHp > 0 ? target.hp / target.maxHp : 0;
      prop.visualState = ratio <= 0 ? "severed" : ratio <= 0.5 ? "fraying" : "bonded";
    } else {
      prop.progress = target.hitCount;
      prop.requiredProgress = Math.max(1, prop.requiredProgress);
      prop.visualState = state;
    }
    const changed = previousState !== prop.state
      || previousVisualState !== prop.visualState
      || previousProgress !== prop.progress
      || previousPosition.x !== prop.position.x
      || previousPosition.y !== prop.position.y;
    if (changed) {
      this.emit("propStateChanged", {
        actionId,
        targetId: prop.id,
        position: prop.position,
        effectKind: prop.visualState,
        current: prop.progress,
        required: prop.requiredProgress,
      });
    }
  }

  private isForbiddenObjectiveTarget(target: BattleObjectiveTargetState): boolean {
    return this.state.hazards.some((hazard) => {
      if (hazard.type !== "forbidden-target" || !hazard.active) return false;
      const failOnHit = hazard.parameters.failOnHit !== false;
      return failOnHit && Math.hypot(
        target.position.x - hazard.position.x,
        target.position.y - hazard.position.y,
      ) <= target.radius + hazard.radius;
    });
  }

  private resetObjectiveSequence(flag: string, position?: Vec2): void {
    const modifier = this.modifierState(flag);
    if (modifier) {
      modifier.value = 0;
      modifier.lastTurn = this.state.turnNumber;
    }
    for (const target of this.state.objective.targets) {
      if (target.kind !== "prop" && target.kind !== "bossPart") continue;
      target.completed = false;
      target.active = true;
      target.failed = false;
      target.hp = target.maxHp;
      target.hitCount = 0;
      if (target.kind === "prop") {
        const authored = this.stage.spawns.find((entry) => entry.kind === "prop" && entry.id === target.sourceId);
        if (authored) target.position = vec2(authored.x, authored.y);
        this.setPropState(target, "idle");
      } else {
        for (const enemy of this.state.enemies) {
          for (const weakpoint of enemy.weakpoints) {
            if (weakpoint.id !== target.id && weakpoint.partId !== target.sourceId) continue;
            weakpoint.hp = weakpoint.maxHp;
            weakpoint.broken = false;
          }
        }
      }
    }
    this.refreshObjectiveProgress();
    this.emit("sequenceReset", { effectKind: flag, position, current: 0, required: this.state.objective.required });
    this.triggerModifier(flag, { position, current: 0 }, 0);
  }

  /**
   * Siren verses are durable boss parts, unlike the one-contact lit crystals.
   * A stray ricochet should erase progress on the verse currently being sung,
   * but must not resurrect verses the player already interrupted in order.
   */
  private resetCurrentOrderedObjectiveTarget(flag: string, position?: Vec2): void {
    const modifier = this.modifierState(flag);
    const index = Math.max(0, Math.round(modifier?.value ?? 0));
    const expected = this.state.objective.targetIds[index];
    if (!expected) return;
    for (const target of this.state.objective.targets) {
      if (target.sourceId !== expected || target.completed) continue;
      target.active = true;
      target.failed = false;
      target.hp = target.maxHp;
      target.hitCount = 0;
      for (const enemy of this.state.enemies) {
        for (const weakpoint of enemy.weakpoints) {
          if (weakpoint.id !== target.id && weakpoint.partId !== target.sourceId) continue;
          weakpoint.hp = weakpoint.maxHp;
          weakpoint.broken = false;
        }
      }
    }
    this.refreshObjectiveProgress();
    this.emit("sequenceReset", {
      effectKind: flag,
      position,
      current: index,
      required: this.state.objective.required,
    });
    this.triggerModifier(flag, { position, current: index }, index);
  }

  private acceptOrderedObjectiveContact(sourceId: string, position: Vec2): boolean {
    const flag = this.hasModifier("sequence", "crystalsRequireLitOrder")
      ? "crystalsRequireLitOrder"
      : this.hasModifier("sequence", "interruptSongInOrder")
        ? "interruptSongInOrder"
        : null;
    if (!flag) return true;
    const modifier = this.modifierState(flag);
    const index = Math.max(0, Math.round(modifier?.value ?? 0));
    const expected = this.state.objective.targetIds[index];
    if (sourceId !== expected) {
      if (flag === "interruptSongInOrder") this.resetCurrentOrderedObjectiveTarget(flag, position);
      else this.resetObjectiveSequence(flag, position);
      return false;
    }
    return true;
  }

  private advanceOrderedObjectiveSequence(sourceId: string, position: Vec2): void {
    const flag = this.hasModifier("sequence", "crystalsRequireLitOrder")
      ? "crystalsRequireLitOrder"
      : this.hasModifier("sequence", "interruptSongInOrder")
        ? "interruptSongInOrder"
        : null;
    if (!flag) return;
    const modifier = this.modifierState(flag);
    const index = Math.max(0, Math.round(modifier?.value ?? 0));
    if (this.state.objective.targetIds[index] !== sourceId) return;
    if (modifier) {
      this.triggerModifierState(modifier, {
        targetId: sourceId,
        position,
        current: index + 1,
      }, index + 1);
    }
  }

  private acceptSealContact(weakpoint: BattleWeakpointState, position: Vec2): boolean {
    const candidates = this.state.modifiers.filter((modifier) => [
      "sealDirectionHitCount", "sealRequiredAngleCount", "sealColorCount",
    ].includes(modifier.flag));
    if (candidates.length === 0) return true;
    let accepted = true;
    for (const modifier of candidates) {
      const bucketCount = Math.max(1, Number(modifier.parameter?.value ?? this.state.objective.required));
      let bucket = 0;
      if (modifier.flag === "sealColorCount") {
        const colorFamilies = { sea: 0, sun: 0, storm: 1, earth: 1, moon: 2, spirit: 2 } as const;
        bucket = colorFamilies[this.activeHeroDefinition().element] % bucketCount;
      } else {
        const angle = Math.atan2(position.y - weakpoint.position.y, position.x - weakpoint.position.x);
        bucket = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * bucketCount) % bucketCount;
      }
      const bit = 1 << bucket;
      const mask = Math.round(modifier.value);
      if ((mask & bit) !== 0) {
        accepted = false;
        continue;
      }
      const nextMask = mask | bit;
      let count = 0;
      for (let bits = nextMask; bits > 0; bits >>>= 1) count += bits & 1;
      this.triggerModifierState(modifier, {
        targetId: weakpoint.id,
        position,
        current: count,
        required: bucketCount,
      }, nextMask);
    }
    return accepted;
  }

  private hitObjectiveTarget(targetId: string, position: Vec2, impact: HeroImpactContext): void {
    const target = this.state.objective.targets.find((entry) => entry.id === targetId);
    if (!target?.active || target.failed) return;
    const authoredTarget = this.stage.spawns.find((entry) => entry.kind === "prop" && entry.id === target.sourceId);
    if (authoredTarget?.interaction?.mode === "assembly" && this.state.projectile) {
      if (this.state.projectile.objectiveContactIds.includes(target.id)) return;
      this.state.projectile.objectiveContactIds.push(target.id);
    }
    if (!this.acceptOrderedObjectiveContact(target.sourceId, position)) return;
    this.reduceSuctionFromAuthoredAnchor(target.sourceId, position);
    target.hitCount += 1;
    if (this.hasModifier("sequence", "singleShotAllRings")) {
      const modifier = this.modifierState("singleShotAllRings");
      const next = Math.round(modifier?.value ?? 0) + 1;
      if (modifier) this.triggerModifierState(modifier, { targetId: target.id, position, current: next }, next);
    }
    this.emit("objectiveTargetHit", {
      actorId: this.activePartyMember().id,
      targetId: target.id,
      position,
      current: this.state.objective.current,
      required: this.state.objective.required,
    });

    if (this.state.objective.type === "protect") {
      if (this.hasModifier("status", "allyContactCleansesSleep")) {
        target.completed = true;
        target.active = false;
        this.setPropState(target, "awakened");
      } else if (this.isForbiddenObjectiveTarget(target)) {
        target.failed = true;
        target.active = false;
        target.hp = 0;
        this.setPropState(target, "failed");
        if (this.hasModifier("objective", "forbiddenTargetContactFailsStage")) {
          this.triggerModifier("forbiddenTargetContactFailsStage", { targetId: target.id, position }, 1);
        }
        this.failObjective(target.id, position);
        return;
      } else if (this.stage.hazards.some(
        (hazard) => hazard.parameters.healsOnAllyContact === true
          && Math.hypot(target.position.x - hazard.x, target.position.y - hazard.y) <= hazard.radius,
      )) {
        target.hp = Math.min(target.maxHp, target.hp + 20);
        this.setPropState(target, "protected");
      }
    } else if (this.state.objective.type === "break-parts") {
      const roll = this.rollHeroDamage(1, 0, impact);
      const capped = capHeroContactDamage({ rawDamage: roll.damage, targetMaxHp: target.maxHp, target: "objective" });
      const hpBefore = target.hp;
      target.hp = Math.max(0, target.hp - capped.damage);
      this.emit("objectiveTargetDamaged", {
        actorId: this.activePartyMember().id,
        targetId: target.id,
        amount: hpBefore - target.hp,
        hpBefore,
        hpAfter: target.hp,
        position,
        critical: roll.critical,
        impactGrade: roll.grade,
        speedRatio: roll.speedRatio,
        incidence: roll.incidence,
        damageMultiplier: roll.multiplier,
        damageCapped: capped.capped,
      });
      if (target.hp <= 0) {
        target.completed = true;
        target.active = false;
        this.setPropState(target, "broken");
        this.advanceOrderedObjectiveSequence(target.sourceId, position);
      } else {
        // Multi-hit destructibles and magical bonds expose their intermediate
        // art state while remaining an active objective collider.
        this.setPropState(target, "idle");
      }
    } else if (this.state.objective.type === "assemble") {
      const authored = this.stage.spawns.find((entry) => entry.kind === "prop" && entry.id === target.sourceId);
      const assembly = authored?.interaction?.mode === "assembly" ? authored.interaction : undefined;
      const requiredHits = Math.max(1, Math.round(assembly?.hitsRequired ?? target.maxHp));
      const progress = Math.min(1, target.hitCount / requiredHits);
      if (authored && assembly?.destination) {
        const destination = vec2(
          clamp(assembly.destination.x, target.radius, this.stage.arena.width - target.radius),
          clamp(assembly.destination.y, target.radius, this.stage.arena.height - target.radius),
        );
        target.position = lerpVec(
          vec2(authored.x, authored.y),
          destination,
          progress,
        );
      }
      target.hp = Math.max(0, requiredHits - target.hitCount);
      target.completed = target.hitCount >= requiredHits;
      target.active = !target.completed;
      this.setPropState(target, target.completed ? "awakened" : "idle");
    } else if (this.state.objective.type === "seal") {
      if (target.hitCount >= this.state.objective.required) target.completed = true;
    } else if (this.state.objective.type === "escape") {
      target.completed = true;
      target.active = false;
    }
    this.refreshObjectiveProgress(target.id, position);
    this.applyObjectiveCompletionModifiers(position);
    this.checkVictory();
  }

  private syncWeakpointObjective(weakpoint: BattleWeakpointState, position: Vec2): void {
    const targets = this.objectiveTargetsFor(weakpoint.id).filter((target) => target.kind === "bossPart");
    for (const target of targets) {
      const wasCompleted = target.completed;
      target.hitCount += 1;
      target.hp = weakpoint.hp;
      if (this.state.objective.type === "seal") {
        if (target.hitCount >= this.state.objective.required) target.completed = true;
      } else if (weakpoint.broken) {
        target.completed = true;
        target.active = false;
      }
      if (!wasCompleted && target.completed) {
        this.advanceOrderedObjectiveSequence(target.sourceId, position);
      }
      if (!wasCompleted && target.completed && this.hasModifier("sequence", "exactHeadChainCount")) {
        const modifier = this.modifierState("exactHeadChainCount");
        const next = Math.round(modifier?.value ?? 0) + 1;
        if (modifier) this.triggerModifierState(modifier, { targetId: target.id, position, current: next }, next);
      }
      this.emit("objectiveTargetHit", {
        actorId: this.activePartyMember().id,
        targetId: target.id,
        position,
        current: this.state.objective.current,
        required: this.state.objective.required,
      });
    }
    if (targets.length > 0) {
      this.refreshObjectiveProgress(weakpoint.id, position);
      this.applyObjectiveCompletionModifiers(position);
    }
  }

  private applyObjectiveCompletionModifiers(position?: Vec2): void {
    if (this.hasModifier("boss", "forepawsOpenSafeLane")) {
      const forepaws = this.state.enemies.flatMap((enemy) => enemy.weakpoints).filter(
        (weakpoint) => weakpoint.partId.includes("forepaw"),
      );
      if (
        forepaws.length >= 2
        && forepaws.every((weakpoint) => weakpoint.broken)
        && (this.modifierState("forepawsOpenSafeLane")?.triggerCount ?? 0) === 0
      ) {
        for (const hazard of this.state.hazards.filter((entry) => entry.type === "whirlpool")) {
          const baseForce = Number(hazard.parameters.safeLaneBaseForce ?? hazard.parameters.force ?? 0);
          hazard.parameters.safeLaneBaseForce = baseForce;
          hazard.parameters.force = baseForce * 0.5;
        }
        this.triggerModifier("forepawsOpenSafeLane", { position }, 1);
      }
    }
    if (this.state.objective.type === "seal" && this.state.objective.current > 0) {
      const nextPhase = Math.min(this.state.objective.required, this.state.objective.current + 1);
      this.setStagePhase(nextPhase, undefined, position, "seal-progress");
    }
  }

  private refreshObjectiveProgress(targetId?: string, position?: Vec2): void {
    const objective = this.state.objective;
    const previous = objective.current;
    const previousRequired = objective.required;
    if (objective.type === "defeat-all") {
      objective.required = Math.max(1, this.state.enemies.length);
      objective.current = this.state.enemies.filter((enemy) => !enemy.alive).length;
    } else if (objective.type === "survive" || this.state.victoryRule.type === "protectTargets") {
      objective.current = Math.min(objective.required, this.state.completedTurns);
    } else if (objective.type === "seal") {
      objective.current = Math.min(
        objective.required,
        objective.targets.reduce((sum, target) => sum + target.hitCount, 0),
      );
    } else {
      objective.current = objective.targets.filter((target) => target.completed).length;
    }
    objective.failed = objective.targets.some((target) => target.failed);
    objective.completed = !objective.failed && objective.current >= objective.required;
    if (this.stage.id === "r01-s03") {
      this.setStagePhase(Math.min(3, Math.max(1, objective.current + 1)), undefined, position, "bond-progress");
    }
    if (this.stage.id === "r01-s04") {
      const firstThreshold = Math.ceil(objective.required / 3);
      const secondThreshold = Math.ceil(objective.required * 2 / 3);
      const phase = objective.current >= secondThreshold ? 3 : objective.current >= firstThreshold ? 2 : 1;
      this.setStagePhase(phase, undefined, position, "survival-progress");
    }
    if (objective.current !== previous || objective.required !== previousRequired) {
      this.emit("objectiveProgressed", {
        targetId,
        position,
        current: objective.current,
        required: objective.required,
      });
    }
  }

  private failObjective(targetId?: string, position?: Vec2): void {
    if (this.state.objective.failed) return;
    this.state.objective.failed = true;
    this.emit("objectiveFailed", {
      targetId,
      position,
      current: this.state.objective.current,
      required: this.state.objective.required,
    });
    this.endDefeat("objectiveFailed");
  }

  private isNearAuthoredWall(position: Vec2, predicate: (id: string, material: string) => boolean, margin = 38): boolean {
    return this.stage.walls.some((wall) => {
      if (!predicate(wall.id, wall.material)) return false;
      const state = this.state.walls.find((entry) => entry.id === wall.id);
      if (state?.broken || state?.active === false) return false;
      const shifted = (point: Vec2) => add(point, state?.offset ?? vec2(0, 0));
      if (wall.shape === "circle") {
        const center = shifted(vec2(wall.x, wall.y));
        return Math.hypot(position.x - center.x, position.y - center.y) <= (wall.radius ?? 0) + margin;
      }
      const a = shifted(vec2(wall.x, wall.y));
      const b = shifted(vec2(wall.x2 ?? wall.x, wall.y2 ?? wall.y));
      const radius = (wall.shape === "capsule" ? wall.radius ?? 0 : 0) + margin;
      return distanceToSegmentSquared(position, a, b) <= radius * radius;
    });
  }

  /** A rolling boulder can cross the same body during a launch and its
   * end-of-turn move, but authoritative damage applies once per body/turn. */
  private claimBoulderDamage(hazardId: string, targetId: string): boolean {
    if (this.boulderDamageTurn !== this.state.turnNumber) {
      this.boulderDamageTurn = this.state.turnNumber;
      this.boulderDamageKeys.clear();
    }
    const key = `${hazardId}:${targetId}`;
    if (this.boulderDamageKeys.has(key)) return false;
    this.boulderDamageKeys.add(key);
    return true;
  }

  private damageHeroWithBoulder(hazard: BattleHazardState, actor: BattlePartyMemberState, amount: number): boolean {
    if (!actor.alive || !this.claimBoulderDamage(hazard.id, actor.id)) return false;
    actor.hp = Math.max(0, actor.hp - amount);
    this.emit("heroDamaged", { actorId: hazard.id, targetId: actor.id, amount, position: actor.position });
    if (actor.hp <= 0) {
      actor.alive = false;
      this.emit("heroDefeated", { actorId: hazard.id, targetId: actor.id, position: actor.position });
      this.ensureFatherSonCoreAccessible();
    }
    return true;
  }

  private damageEnemyWithBoulder(hazard: BattleHazardState, enemy: BattleEnemyState, amount: number): boolean {
    if (!enemy.alive || !this.claimBoulderDamage(hazard.id, enemy.id)) return false;
    enemy.hp = Math.max(this.minimumEnemyHp(enemy), enemy.hp - amount);
    this.emit("enemyHit", {
      actorId: hazard.id,
      targetId: enemy.id,
      amount,
      position: enemy.position,
      effectKind: "boulder",
    });
    if (enemy.hp <= 0) this.defeatEnemy(enemy);
    return true;
  }

  private sweepBoulderDamage(hazard: BattleHazardState, previous: Vec2): void {
    if (!this.hasModifier("hazard", "boulderDamagesAllTeams")) return;
    const amount = Math.max(1, Math.round(Number(hazard.parameters.damage ?? 35)));
    let hit = false;
    for (const actor of this.state.party) {
      const contactRadius = hazard.radius + this.effectivePartyRadius(actor);
      if (
        actor.alive
        && distanceToSegmentSquared(actor.position, previous, hazard.position) <= contactRadius * contactRadius
      ) hit = this.damageHeroWithBoulder(hazard, actor, amount) || hit;
    }
    for (const enemy of this.state.enemies) {
      const shrinkMultiplier = this.hasEffect(enemy.id, "shrink-enemy")
        ? Math.max(0.25, 1 - this.effectValue(enemy.id, "shrink-enemy") / 100)
        : 1;
      const contactRadius = hazard.radius + enemy.radius * shrinkMultiplier;
      if (
        enemy.alive
        && distanceToSegmentSquared(enemy.position, previous, hazard.position) <= contactRadius * contactRadius
      ) hit = this.damageEnemyWithBoulder(hazard, enemy, amount) || hit;
    }
    if (hit) this.triggerModifier("boulderDamagesAllTeams", { actorId: hazard.id, position: hazard.position, amount });
    if (this.state.party.every((member) => !member.alive)) this.endDefeat("partyDefeated");
  }

  private triggerHazard(projectile: BattleProjectileState, contact: BattleTrajectoryContact): void {
    const hazardId = contact.targetId;
    const position = contact.position;
    const lethalContact = hazardId.endsWith("#lethal");
    const baseHazardId = lethalContact ? hazardId.slice(0, -"#lethal".length) : hazardId;
    const hazard = this.state.hazards.find((entry) => entry.id === baseHazardId);
    if (!hazard?.active) return;
    if (hazard.parameters.pulseActive === false) return;
    this.emit("hazardTriggered", {
      actorId: projectile.actorId,
      targetId: hazard.id,
      position,
      effectKind: hazard.type,
    });
    if (hazard.type === "one-way-wall") {
      if (contact.response !== "bounce") return;
      const incomingVelocity = this.velocityAfterContact(projectile);
      const restitution = clamp(Number(hazard.parameters.restitution ?? 1), 0, 2);
      const reflectedVelocity = reflectVelocity(incomingVelocity, contact.normal, restitution, 0);
      const start = this.clearRetraceStart(
        projectile,
        position,
        reflectedVelocity,
        contact.colliderId,
        contact.normal,
      );
      this.retraceProjectileFrom(projectile, start, reflectedVelocity, new Set());
      return;
    }
    if (hazard.type === "whirlpool" && lethalContact) {
      const actor = this.state.party.find((member) => member.id === projectile.actorId && member.alive);
      if (!actor) return;
      const safe = this.isNearAuthoredWall(actor.position, (id) => id.includes("safe") || id.includes("anchor"), actor.radius + 24);
      if (safe) return;
      const amount = actor.hp;
      actor.hp = 0;
      actor.alive = false;
      this.emit("heroDamaged", { actorId: hazard.id, targetId: actor.id, amount, position: actor.position });
      this.emit("heroDefeated", { actorId: hazard.id, targetId: actor.id, position: actor.position });
      this.ensureFatherSonCoreAccessible();
      if (this.state.party.every((member) => !member.alive)) this.endDefeat("partyDefeated");
      return;
    }
    if (hazard.type === "moving-bumper" && this.hasModifier("hazard", "boulderDamagesAllTeams")) {
      const actor = this.state.party.find((member) => member.id === projectile.actorId && member.alive);
      const amount = Math.max(1, Math.round(Number(hazard.parameters.damage ?? 35)));
      if (actor) this.damageHeroWithBoulder(hazard, actor, amount);
      const contactedEnemies = this.state.enemies.filter((enemy) => enemy.alive && Math.hypot(
        enemy.position.x - hazard.position.x,
        enemy.position.y - hazard.position.y,
      ) <= enemy.radius + hazard.radius);
      for (const enemy of contactedEnemies) this.damageEnemyWithBoulder(hazard, enemy, amount);
      this.triggerModifier("boulderDamagesAllTeams", { actorId: hazard.id, position, amount });
      if (this.state.party.every((member) => !member.alive)) this.endDefeat("partyDefeated");
      if (!actor?.alive) return;
    }
    if (hazard.type === "moving-bumper" && hazard.parameters.onContactRadiusMultiplier !== undefined) {
      const actor = this.state.party.find((member) => member.id === projectile.actorId && member.alive);
      if (!actor) return;
      const multiplier = clamp(Number(hazard.parameters.onContactRadiusMultiplier), 0.45, 1.8);
      const duration = Math.max(1, Math.round(Number(hazard.parameters.durationTurns ?? 1)));
      this.applyStatus(hazard.id, projectile.actorId, "radius-multiplier", multiplier, duration, true);
      if (this.hasModifier("status", "sizeChangesCollider")) {
        this.triggerModifier("sizeChangesCollider", {
          actorId: projectile.actorId,
          targetId: hazard.id,
          position,
          amount: multiplier,
          duration,
        }, multiplier);
      }
      const contactVelocity = this.velocityAfterContact(projectile);
      const start = this.clearRetraceStart(
        projectile,
        position,
        contactVelocity,
        contact.colliderId,
        contact.normal,
      );
      this.retraceProjectileFrom(projectile, start, contactVelocity, new Set());
      return;
    }
    if (hazard.type === "portal") {
      const pairId = String(hazard.parameters.pairId ?? "");
      const pair = this.state.hazards.find((entry) => entry.id === pairId && entry.type === "portal");
      if (this.hasModifier("trajectory", "portalElementChangesWallCollision")) {
        this.state.effects = this.state.effects.filter((effect) => !(
          effect.targetId === projectile.actorId
          && effect.kind.startsWith("portal-affinity-")
        ));
        const exitElement = String(pair?.parameters.element ?? hazard.parameters.element ?? "earth");
        const affinityKind = exitElement === "spirit"
          ? "portal-affinity-spirit"
          : "portal-affinity-earth";
        this.applyStatus(pair?.id ?? hazard.id, projectile.actorId, affinityKind, 1, 1, true);
        this.triggerModifier("portalElementChangesWallCollision", {
          actorId: projectile.actorId,
          targetId: pair?.id ?? hazard.id,
          position,
        });
      }
      if (pair) {
        const contactVelocity = this.velocityAfterContact(projectile);
        const rotation = Number(pair.parameters.rotation ?? hazard.parameters.rotation ?? 0) * Math.PI / 180;
        const cosine = Math.cos(rotation);
        const sine = Math.sin(rotation);
        const velocity = vec2(
          contactVelocity.x * cosine - contactVelocity.y * sine,
          contactVelocity.x * sine + contactVelocity.y * cosine,
        );
        const direction = normalize(velocity, vec2(0, -1));
        const actor = this.state.party.find((member) => member.id === projectile.actorId);
        const clearance = pair.radius + (actor ? this.effectivePartyRadius(actor) : 1) + 3;
        const start = add(pair.position, scale(direction, clearance));
        this.retraceProjectileFrom(
          projectile,
          start,
          velocity,
          new Set([`hazard:${hazard.id}`, `hazard:${pair.id}`]),
        );
      }
      return;
    }
    if (hazard.type === "slow-field") {
      const multiplier = clamp(Number(hazard.parameters.speedMultiplier ?? 0.7), 0.1, 1);
      this.applyStatus(hazard.id, projectile.actorId, "slow-field", multiplier, 1, true);
      if (this.hasModifier("status", "sleepStackThreshold")) {
        const stacks = this.effectValue(projectile.actorId, "sleep-stack") + Number(hazard.parameters.sleepStacks ?? 1);
        const threshold = this.modifierNumber("status", "sleepStackThreshold", 3);
        this.applyStatus(hazard.id, projectile.actorId, "sleep-stack", stacks, 3, true);
        this.triggerModifier("sleepStackThreshold", { actorId: projectile.actorId, targetId: projectile.actorId, current: stacks, required: threshold }, stacks);
        if (stacks >= threshold) this.applyStatus(hazard.id, projectile.actorId, "stun", 1, 1, true);
      }
      if (this.hasModifier("status", "wineAffectsBothTeams")) {
        const attackDown = Math.max(0, Number(hazard.parameters.enemyAttackDown ?? 25));
        for (const enemy of this.state.enemies.filter((entry) => entry.alive && Math.hypot(
          entry.position.x - hazard.position.x,
          entry.position.y - hazard.position.y,
        ) <= hazard.radius + entry.radius)) {
          enemy.attackCountdown += 1;
          this.applyStatus(
            hazard.id,
            enemy.id,
            "wine-slow",
            attackDown,
            Math.max(1, enemy.attackCountdown),
          );
        }
        this.triggerModifier("wineAffectsBothTeams", { actorId: projectile.actorId, targetId: hazard.id, position });
      }
      const adjustedVelocity = scale(this.velocityAfterContact(projectile), multiplier);
      const start = add(position, scale(normalize(adjustedVelocity, vec2(0, -1)), 3));
      this.retraceProjectileFrom(
        projectile,
        start,
        adjustedVelocity,
        new Set([contact.colliderId]),
      );
      return;
    }
    if (hazard.type === "wave-front") {
      const actor = this.state.party.find((member) => member.id === projectile.actorId && member.alive);
      if (!actor || hazard.parameters.armed !== true) return;
      const amount = Math.max(1, Math.round(Number(hazard.parameters.damage ?? 24)));
      const actionId = `${hazard.id}:wave-contact:${this.state.turnNumber}:${this.state.eventSequence + 1}`;
      this.damageHero({ id: hazard.id }, actor, amount, {
        actionId,
        sourceKind: "hazard",
        attackKind: "wave-front",
        intentKind: "area",
        effectKind: "wave-front",
      });
      hazard.parameters.lastContactTurn = this.state.turnNumber;
      hazard.parameters.lastContactActorId = actor.id;
      if (!actor.alive) {
        if (this.state.party.every((member) => !member.alive)) this.endDefeat("partyDefeated");
        return;
      }
      const axis = String(hazard.parameters.axis ?? "y");
      const direction = Math.sign(Number(hazard.parameters.direction ?? 1)) || 1;
      const force = Math.max(0, Number(hazard.parameters.force ?? 180));
      const forceX = Number(hazard.parameters.forceX ?? (axis === "x" ? force * direction : 0));
      const forceY = Number(hazard.parameters.forceY ?? (axis === "y" ? force * direction : 0));
      const adjustedVelocity = add(this.velocityAfterContact(projectile), vec2(forceX, forceY));
      const start = add(position, scale(
        normalize(adjustedVelocity, vec2(0, direction)),
        this.effectivePartyRadius(actor) + 3,
      ));
      this.retraceProjectileFrom(projectile, start, adjustedVelocity, new Set([contact.colliderId]));
      return;
    }
    if (hazard.type === "current" || hazard.type === "wind-vector" || hazard.type === "whirlpool") {
      const actor = this.state.party.find((member) => member.id === projectile.actorId);
      if (
        hazard.parameters.spiritOnly === true
        && actor
        && this.heroById[actor.definitionId]?.element !== "spirit"
      ) return;
      const forceMultiplier = hazard.type === "whirlpool"
        ? 1 - clamp(this.relicValue("whirlpool-resistance") / 100, 0, 1)
        : 1 - clamp(this.relicValue("wind-force-reduction") / 100, 0, 1);
      const vectorMagnitude = (hazard.type === "whirlpool"
        ? Number(hazard.parameters.force ?? 100)
        : Math.hypot(Number(hazard.parameters.forceX ?? 0), Number(hazard.parameters.forceY ?? 0)))
        * forceMultiplier;
      this.applyStatus(hazard.id, projectile.actorId, "wind-vector", Math.max(6, vectorMagnitude / 8), 1, true);
      let adjustedVelocity = this.velocityAfterContact(projectile);
      if (hazard.type === "whirlpool") {
        const toward = normalize(vec2(hazard.position.x - position.x, hazard.position.y - position.y));
        adjustedVelocity = add(
          adjustedVelocity,
          scale(toward, Number(hazard.parameters.force ?? 0) * forceMultiplier),
        );
      } else {
        const rotation = hazard.phase * Number(hazard.parameters.rotateEachTurn ?? 0) * Math.PI / 180;
        const sign = Number(hazard.parameters.directionSign ?? 1);
        const forceX = Number(hazard.parameters.forceX ?? 0) * sign * forceMultiplier;
        const forceY = Number(hazard.parameters.forceY ?? 0) * sign * forceMultiplier;
        adjustedVelocity = add(adjustedVelocity, vec2(
          forceX * Math.cos(rotation) - forceY * Math.sin(rotation),
          forceX * Math.sin(rotation) + forceY * Math.cos(rotation),
        ));
      }
      const start = add(position, scale(
        normalize(adjustedVelocity, vec2(0, -1)),
        (actor ? this.effectivePartyRadius(actor) : 1) + 3,
      ));
      this.retraceProjectileFrom(projectile, start, adjustedVelocity, new Set([`hazard:${hazard.id}`]));
      if (hazard.type === "whirlpool" && this.hasModifier("hazard", "charybdisSupportHazard")) {
        this.applyStatus(hazard.id, projectile.actorId, "slow-field", 0.7, 1, true);
        this.triggerModifier("charybdisSupportHazard", { actorId: projectile.actorId, targetId: hazard.id, position });
      }
      return;
    }
    if (hazard.type === "lightning" || hazard.type === "sound-wave") {
      const actor = this.state.party.find((member) => member.id === projectile.actorId);
      if (!actor?.alive) return;
      if (hazard.type === "sound-wave" && isSoundWaveContactSafe(hazard.position, hazard.parameters, position)) return;
      if (hazard.type === "lightning") {
        if (hazard.parameters.armed !== true || this.hasEffect(actor.id, "lightning-grounded")) return;
        const needsBronzeSafety = hazard.parameters.safeNearBronze === true || hazard.parameters.redirectToBronze === true;
        if (needsBronzeSafety && this.isNearAuthoredWall(
          actor.position,
          (_id, material) => material === "bronze",
          actor.radius + 34,
        )) return;
      }
      const amount = Math.max(1, Math.round(Number(hazard.parameters.damage ?? 25)));
      const actionId = `${hazard.id}:hazard:${this.state.turnNumber}:${this.state.eventSequence + 1}`;
      this.damageHero({ id: hazard.id }, actor, amount, {
        actionId,
        sourceKind: "hazard",
        attackKind: hazard.type,
        intentKind: "area",
        effectKind: hazard.type,
      });
      if (this.state.party.every((member) => !member.alive)) this.endDefeat("partyDefeated");
      if (hazard.type === "sound-wave" && this.hasModifier("trajectory", "exactSoundWaveCollision")) {
        this.triggerModifier("exactSoundWaveCollision", { actorId: projectile.actorId, targetId: hazard.id, position, amount });
      }
    }
  }

  private nearestLivingEnemies(position: Vec2, count: number): BattleEnemyState[] {
    return this.state.enemies.filter((enemy) => enemy.alive).sort((left, right) => {
      const leftDistance = (left.position.x - position.x) ** 2 + (left.position.y - position.y) ** 2;
      const rightDistance = (right.position.x - position.x) ** 2 + (right.position.y - position.y) ** 2;
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    }).slice(0, Math.max(0, count));
  }

  private enemiesInSkillShape(
    position: Vec2,
    direction: Vec2,
    shape: "line" | "cone" | "cross" | "orbit",
  ): BattleEnemyState[] {
    const forward = normalize(direction, vec2(0, -1));
    const side = vec2(-forward.y, forward.x);
    return this.state.enemies.filter((enemy) => {
      if (!enemy.alive) return false;
      const offset = vec2(enemy.position.x - position.x, enemy.position.y - position.y);
      const along = offset.x * forward.x + offset.y * forward.y;
      const lateral = Math.abs(offset.x * side.x + offset.y * side.y);
      const radial = Math.hypot(offset.x, offset.y);
      if (shape === "line") return along >= -enemy.radius && along <= 440 && lateral <= 34 + enemy.radius;
      if (shape === "cone") return along >= 0 && radial <= 380 + enemy.radius && along / Math.max(1, radial) >= Math.cos(Math.PI / 5);
      if (shape === "cross") {
        return radial <= 320 + enemy.radius && (lateral <= 30 + enemy.radius || Math.abs(along) <= 30 + enemy.radius);
      }
      return radial <= 175 + enemy.radius;
    }).sort((left, right) => {
      const leftDistance = Math.hypot(left.position.x - position.x, left.position.y - position.y);
      const rightDistance = Math.hypot(right.position.x - position.x, right.position.y - position.y);
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    });
  }

  private dealSkillDamage(
    sourceId: string,
    enemy: BattleEnemyState,
    amount: number,
    effectKind: string,
    position: Vec2,
  ): void {
    if (!enemy.alive) return;
    const damage = Math.max(1, Math.round(amount));
    const hpBefore = enemy.hp;
    enemy.hp = Math.max(this.minimumEnemyHp(enemy), enemy.hp - damage);
    const applied = Math.max(0, hpBefore - enemy.hp);
    this.registerCombo();
    this.emit("enemyHit", {
      actorId: sourceId,
      targetId: enemy.id,
      amount: applied,
      hpBefore,
      hpAfter: enemy.hp,
      position,
      combo: this.state.comboCount,
      effectKind,
    });
    if (enemy.hp <= 0) this.defeatEnemy(enemy);
    this.updateBossPhase(enemy);
  }

  private pushEnemyFrom(
    enemy: BattleEnemyState,
    origin: Vec2,
    distance: number,
    sourceId: string,
    effectKind: string,
  ): number {
    if (!enemy.alive || distance <= 0) return 0;
    const resistance = enemy.behaviorId === "heavy"
      ? clamp(this.enemyBehaviorNumber(enemy, "pushResistance", 0.55), 0, 0.95)
      : 0;
    const impulse = Math.max(0, distance * (1 - resistance));
    const direction = normalize(vec2(enemy.position.x - origin.x, enemy.position.y - origin.y), enemy.facing);
    const trace = traceRicochet({
      position: enemy.position,
      velocity: scale(direction, impulse),
      duration: 1,
      moverRadius: enemy.radius,
      colliders: this.enemyObstacleColliders(enemy, enemy.id),
      maxBounces: 0,
      maxCollisions: 8,
      minSpeed: 0,
      defaultRestitution: 0,
      defaultFriction: 0,
    });
    const travelled = Math.hypot(
      trace.finalPosition.x - enemy.position.x,
      trace.finalPosition.y - enemy.position.y,
    );
    if (travelled <= STEP_EPSILON) return 0;
    this.setEnemyPosition(enemy, trace.finalPosition);
    this.emit("enemyMoved", {
      actorId: sourceId,
      targetId: enemy.id,
      position: enemy.position,
      amount: travelled,
      effectKind,
      path: trace.points.map((point) => ({ ...point })),
    });
    return travelled;
  }

  private triggerFriendshipSkill(
    actorId: string,
    allyId: string,
    position: Vec2,
    direction: Vec2,
    lastHitEnemyId?: string,
  ): void {
    const hero = this.heroById[allyId];
    if (!hero) return;
    const skill = hero.friendshipSkill;
    for (const effect of skill.effects) {
      this.emit("allySkillTriggered", {
        actorId: allyId,
        targetId: actorId,
        position,
        skillId: `${hero.id}:friendship`,
        skillName: skill.name,
        effectKind: effect.kind,
        amount: effect.value,
        duration: effect.durationTurns,
      });

      const duration = Math.max(1, effect.durationTurns ?? 1);
      if (["nearest-barrage", "line-pierce", "push-wave", "cross-slash", "orbiting-blade", "follow-up-shot"].includes(effect.kind)) {
        let targets: BattleEnemyState[];
        if (effect.kind === "line-pierce") targets = this.enemiesInSkillShape(position, direction, "line");
        else if (effect.kind === "push-wave") targets = this.enemiesInSkillShape(position, direction, "cone");
        else if (effect.kind === "cross-slash") targets = this.enemiesInSkillShape(position, direction, "cross");
        else if (effect.kind === "orbiting-blade") targets = this.enemiesInSkillShape(position, direction, "orbit");
        else if (effect.kind === "follow-up-shot") {
          const previous = this.state.enemies.find((enemy) => enemy.id === lastHitEnemyId && enemy.alive);
          targets = previous ? [previous] : this.nearestLivingEnemies(position, 1);
        } else targets = this.nearestLivingEnemies(position, 3);
        for (const enemy of targets) {
          this.dealSkillDamage(allyId, enemy, effect.value, effect.kind, position);
          if (effect.kind === "push-wave" && enemy.alive) {
            this.pushEnemyFrom(enemy, position, Math.max(36, effect.value * 1.7), allyId, effect.kind);
          }
        }
        continue;
      }
      if (effect.kind === "chain-bounce") {
        const base = Math.max(1, Math.round(hero.stats.attack * 0.55));
        for (const enemy of this.nearestLivingEnemies(position, Math.max(1, Math.round(effect.value)))) {
          this.dealSkillDamage(allyId, enemy, base, effect.kind, position);
        }
        continue;
      }
      if (effect.kind === "projectile-guard") {
        for (const member of this.state.party.filter((entry) => entry.alive)) {
          this.applyStatus(allyId, member.id, "projectile-guard", effect.value, duration, true);
        }
        continue;
      }
      if (effect.kind === "bind") {
        for (const enemy of this.nearestLivingEnemies(position, 2)) {
          this.applyStatus(allyId, enemy.id, "bind", effect.value, duration);
        }
        continue;
      }
      if (effect.kind === "regeneration") {
        this.applyStatus(allyId, actorId, "regeneration", effect.value, duration, true);
        const actor = this.state.party.find((member) => member.id === actorId);
        if (actor?.alive) actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.round(effect.value)));
        continue;
      }
      if (effect.kind === "temporary-wall") {
        const wallHp = Math.max(1, Math.round(100 * (
          1 + Math.max(0, this.relicValue("temporary-wall-hp")) / 100
        )));
        this.applyStatus(allyId, actorId, "projectile-guard", 40, duration, true);
        this.applyStatus(allyId, actorId, effect.kind, effect.value, duration, true);
        this.state.hazards.push({
          id: `friend-wall:${allyId}:${this.state.eventSequence}`,
          type: "moving-bumper",
          origin: { ...position },
          position: { ...position },
          radius: 38,
          active: true,
          phase: 0,
          remainingTurns: duration,
          spawnedBy: allyId,
          parameters: {
            shape: "segment",
            length: Math.max(180, effect.value * 5),
            angle: Math.atan2(direction.y, direction.x) + Math.PI / 2,
            distance: 0,
            periodTurns: 999,
            fixed: true,
            restitution: 0.92,
            createdTurn: this.state.turnNumber,
            hp: wallHp,
            maxHp: wallHp,
          },
        });
        continue;
      }
      if (effect.kind === "mark-weakpoint" || effect.kind === "shrink-enemy") {
        const target = this.nearestLivingEnemies(position, 1)[0];
        if (target) this.applyStatus(allyId, target.id, effect.kind, effect.value, duration);
        continue;
      }
      if (effect.kind === "wind-vector" || effect.kind === "wall-phase") {
        this.applyStatus(allyId, actorId, effect.kind, effect.value, duration, true);
        continue;
      }
      if (effect.kind === "telegraph-extend") {
        for (const enemy of this.state.enemies.filter((entry) => entry.alive)) {
          enemy.attackCountdown += Math.max(1, Math.round(effect.value));
          this.applyStatus(allyId, enemy.id, effect.kind, effect.value, duration);
        }
      }
    }
    this.checkVictory();
  }

  private emitActiveSkillEffect(
    member: BattlePartyMemberState,
    hero: HeroDefinition,
    effect: DataEffect,
    targetId?: string,
    position?: Vec2,
    amount = effect.value,
  ): void {
    this.emit("activeSkillEffect", {
      actorId: member.id,
      targetId,
      position: position ?? member.position,
      skillId: `${hero.id}:active`,
      skillName: hero.activeSkill.name,
      effectKind: effect.kind,
      amount,
      duration: effect.durationTurns,
    });
  }

  private applyActiveSkillEffect(
    member: BattlePartyMemberState,
    hero: HeroDefinition,
    effect: DataEffect,
    command: BattleActiveSkillCommand,
  ): void {
    const duration = Math.max(1, effect.durationTurns ?? 1);
    const position = command.position ?? member.position;
    this.emitActiveSkillEffect(member, hero, effect, command.targetId, position);

    if (["preview-extend", "velocity-multiplier", "trajectory-perfect", "weakpoint-multiplier"].includes(effect.kind)) {
      this.applyStatus(member.id, member.id, effect.kind, effect.value, duration);
      return;
    }
    if (effect.kind === "ally-launch") {
      const candidates = this.state.party.filter((entry) => entry.alive && entry.id !== member.id);
      const ally = candidates.find((entry) => entry.id === command.targetId) ?? candidates.sort((left, right) => {
        const leftAttack = this.heroById[left.definitionId]?.stats.attack ?? 0;
        const rightAttack = this.heroById[right.definitionId]?.stats.attack ?? 0;
        return rightAttack - leftAttack || left.id.localeCompare(right.id);
      })[0];
      const target = this.nearestLivingEnemies(position, 1)[0];
      if (!ally) return;
      const destination = target?.position ?? command.secondaryPosition ?? command.position
        ?? vec2(ally.position.x, Math.max(ally.radius, ally.position.y - 260));
      const launchDirection = normalize(vec2(destination.x - ally.position.x, destination.y - ally.position.y), vec2(0, -1));
      const allyHero = this.heroById[ally.definitionId];
      const launchSpeed = clamp(620 + (allyHero?.stats.speed ?? 100) * 2.2, 680, 920);
      const velocity = scale(launchDirection, launchSpeed);
      const trace = traceRicochet({
        position: ally.position,
        velocity,
        duration: 1.05,
        moverRadius: this.effectivePartyRadius(ally),
        colliders: this.buildColliders(ally.id, velocity),
        maxBounces: 3,
        maxCollisions: 18,
        minSpeed: this.state.config.minProjectileSpeed,
        defaultRestitution: clamp(allyHero?.restitution ?? 0.9, 0, 2),
        defaultFriction: this.state.config.defaultFriction,
      });
      const projectile: BattleProjectileState = {
        actorId: ally.id,
        elapsed: 0,
        contactIndex: 0,
        lastBounceIndex: 0,
        position: { ...ally.position },
        velocity: { ...velocity },
        trajectory: sanitizeTrajectory(trace),
        friendshipTriggerKeys: [],
        objectiveContactIds: [],
        enteredHazardIds: [],
        rewardedHazardExitIds: [],
      };
      const hitEnemyIds = new Set<string>();
      const originalActiveIndex = this.state.activePartyIndex;
      const allyIndex = this.state.party.findIndex((entry) => entry.id === ally.id);
      if (allyIndex >= 0) this.state.activePartyIndex = allyIndex;
      try {
        // Resolve the launched ally through the same authoritative contact
        // pipeline as a normal shot: walls, objectives, hazards, portals and
        // friendship contacts may all alter the remaining trace.
        while (projectile.contactIndex < projectile.trajectory.contacts.length && ally.alive) {
          const contact = projectile.trajectory.contacts[projectile.contactIndex]!;
          projectile.elapsed = contact.elapsedTime;
          projectile.position = { ...contact.position };
          ally.position = { ...contact.position };
          projectile.contactIndex += 1;
          const parsed = targetFromColliderId(contact.colliderId);
          if (parsed.kind === "enemy") hitEnemyIds.add(parsed.id);
          if (parsed.kind === "weakpoint") {
            const owner = this.state.enemies.find((entry) => entry.weakpoints.some((weakpoint) => weakpoint.id === parsed.id));
            if (owner) hitEnemyIds.add(owner.id);
          }
          this.processContact(projectile, contact);
          if (this.state.phase === "victory" || this.state.phase === "defeat") break;
        }
        // The authored value is the active-skill bonus on top of the launched
        // ally's normal impact formula, once per enemy crossed.
        for (const enemyId of hitEnemyIds) {
          const enemy = this.state.enemies.find((entry) => entry.id === enemyId && entry.alive);
          if (enemy) this.dealSkillDamage(ally.id, enemy, effect.value, effect.kind, enemy.position);
        }
      } finally {
        this.state.activePartyIndex = originalActiveIndex;
      }
      const landingPosition = ally.alive && this.state.phase !== "victory" && this.state.phase !== "defeat"
        ? projectile.trajectory.finalPosition
        : projectile.position;
      const landingRadius = this.effectivePartyRadius(ally);
      ally.position = {
        x: clamp(landingPosition.x, landingRadius, this.stage.arena.width - landingRadius),
        y: clamp(landingPosition.y, landingRadius, this.stage.arena.height - landingRadius),
      };
      this.emit("allyLaunched", {
        actorId: member.id,
        targetId: ally.id,
        position: ally.position,
        path: projectile.trajectory.points.map((point) => ({ ...point })),
        duration: projectile.trajectory.totalDuration,
        effectKind: effect.kind,
        amount: hitEnemyIds.size,
        skillId: `${hero.id}:active`,
        skillName: hero.activeSkill.name,
      });
      return;
    }
    if (effect.kind === "shield-break") {
      for (const target of this.state.enemies.filter((entry) => entry.alive && entry.behaviorId === "shield")) {
        this.applyStatus(member.id, target.id, "shield-break", effect.value, duration);
      }
      return;
    }
    if (effect.kind === "stun") {
      const target = this.state.enemies.find((entry) => entry.alive && this.enemyById[entry.definitionId]?.boss)
        ?? this.nearestLivingEnemies(position, 1)[0];
      if (target) this.applyStatus(member.id, target.id, "stun", effect.value, duration);
      return;
    }
    if (effect.kind === "reveal-weakpoint") {
      for (const target of this.state.enemies.filter((entry) => entry.alive && entry.weakpoints.length > 0)) {
        this.applyStatus(member.id, target.id, "reveal-weakpoint", effect.value, duration);
        this.applyStatus(member.id, target.id, "mark-weakpoint", 50, duration);
      }
      return;
    }
    if (effect.kind === "heal") {
      for (const target of this.state.party.filter((entry) => entry.alive)) {
        const amount = Math.max(1, Math.round(target.maxHp * effect.value / 100));
        target.hp = Math.min(target.maxHp, target.hp + amount);
      }
      return;
    }
    if (effect.kind === "countdown-delay") {
      for (const target of this.state.enemies.filter((entry) => entry.alive)) {
        target.attackCountdown += Math.max(1, Math.round(effect.value));
      }
      return;
    }
    if (effect.kind === "cleanse") {
      const partyIds = new Set(this.state.party.map((entry) => entry.id));
      this.state.effects = this.state.effects.filter(
        (entry) => !(partyIds.has(entry.targetId) && NEGATIVE_PARTY_STATUS_KINDS.has(entry.kind)),
      );
      return;
    }
    if (effect.kind === "speed-up") {
      for (const target of this.state.party.filter((entry) => entry.alive)) {
        this.applyStatus(member.id, target.id, effect.kind, effect.value, duration);
      }
      return;
    }
    if (effect.kind === "temporary-bumper") {
      const wallHp = Math.max(1, Math.round(100 * (
        1 + Math.max(0, this.relicValue("temporary-wall-hp")) / 100
      )));
      this.state.hazards.push({
        id: `active-bumper:${member.id}:${member.activeSkill.uses}`,
        type: "moving-bumper",
        origin: { ...position },
        position: { ...position },
        radius: 42,
        active: true,
        phase: 0,
        remainingTurns: duration,
        spawnedBy: member.id,
        parameters: {
          axis: "x",
          distance: 0,
          periodTurns: 999,
          restitution: effect.value,
          createdTurn: this.state.turnNumber,
          hp: wallHp,
          maxHp: wallHp,
        },
      });
      return;
    }
    if (effect.kind === "damage-redirect") {
      const target = this.state.party.filter((entry) => entry.alive).sort(
        (left, right) => left.hp / left.maxHp - right.hp / right.maxHp,
      )[0];
      if (target) this.applyStatus(member.id, target.id, effect.kind, effect.value, duration);
      return;
    }
    if (effect.kind === "afterimage-strikes") {
      const strikes = Math.max(1, Math.round(effect.value));
      for (let index = 0; index < strikes; index += 1) {
        const target = this.nearestLivingEnemies(position, 1)[0];
        if (!target) break;
        this.dealSkillDamage(member.id, target, hero.stats.attack * (0.54 - index * 0.025), effect.kind, target.position);
      }
      return;
    }
    if (effect.kind === "mirror-clone") {
      const cloneCount = Math.max(1, Math.round(effect.value));
      const targets = this.nearestLivingEnemies(position, cloneCount);
      for (const target of targets) {
        this.dealSkillDamage(member.id, target, hero.stats.attack * 0.62, effect.kind, target.position);
        target.attackCountdown += 1;
      }
      // The copies stay on the caster's path and briefly make enemy targeting
      // unreliable, represented authoritatively as projectile guard.
      this.applyStatus(member.id, member.id, "projectile-guard", Math.min(45, 15 + cloneCount * 6), duration, true);
      return;
    }
    if (effect.kind === "radial-launch") {
      for (const target of this.state.enemies.filter((entry) => entry.alive)) {
        this.dealSkillDamage(member.id, target, effect.value, effect.kind, target.position);
      }
      return;
    }
    if (effect.kind === "revive") {
      const target = this.state.party.find((entry) => !entry.alive);
      if (target) {
        target.alive = true;
        target.hp = Math.max(1, Math.round(target.maxHp * effect.value / 100));
      }
      return;
    }
    if (effect.kind === "arena-beam") {
      const marked = this.state.enemies.filter(
        (entry) => entry.alive && (this.hasEffect(entry.id, "mark-weakpoint") || this.hasEffect(entry.id, "reveal-weakpoint")),
      );
      const targets = marked.length > 0 ? marked : this.state.enemies.filter((entry) => entry.alive);
      for (const target of targets) this.dealSkillDamage(member.id, target, effect.value, effect.kind, target.position);
      return;
    }
    if (effect.kind === "portal-pair") {
      const first = command.position ?? add(member.position, vec2(-100, 0));
      const second = command.secondaryPosition ?? add(member.position, vec2(100, 0));
      const baseId = `active-portal:${member.id}:${member.activeSkill.uses}`;
      this.state.hazards.push(
        {
          id: `${baseId}:a`, type: "portal", origin: { ...first }, position: { ...first }, radius: 34,
          active: true, phase: 0, remainingTurns: duration, spawnedBy: member.id,
          parameters: { pairId: `${baseId}:b`, rotation: 0, createdTurn: this.state.turnNumber },
        },
        {
          id: `${baseId}:b`, type: "portal", origin: { ...second }, position: { ...second }, radius: 34,
          active: true, phase: 0, remainingTurns: duration, spawnedBy: member.id,
          parameters: { pairId: `${baseId}:a`, rotation: 0, createdTurn: this.state.turnNumber },
        },
      );
    }
  }

  private nextRandom(): number {
    this.state.rng.state = (this.state.rng.state + 0x6d2b79f5) >>> 0;
    let value = this.state.rng.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    this.state.rng.draws += 1;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  private applyRelicContactFollowUp(primaryEnemyId: string, position: Vec2): void {
    const projectile = this.state.projectile;
    const chainPercent = Math.max(0, this.relicValue("chain-lightning", "max"));
    if (!projectile || chainPercent <= 0) return;
    projectile.relicDamageContacts = (projectile.relicDamageContacts ?? 0) + 1;
    if (projectile.relicDamageContacts % 3 !== 0) return;

    const target = this.state.enemies
      .filter((enemy) => enemy.alive && enemy.id !== primaryEnemyId)
      .sort((left, right) => {
        const leftDistance = (left.position.x - position.x) ** 2 + (left.position.y - position.y) ** 2;
        const rightDistance = (right.position.x - position.x) ** 2 + (right.position.y - position.y) ** 2;
        return leftDistance - rightDistance || left.id.localeCompare(right.id);
      })[0];
    if (!target) return;

    const hero = this.activeHeroDefinition();
    const damage = Math.max(1, Math.round(
      hero.stats.attack * classDamageMultiplier(hero.ricochetClass) * chainPercent / 100,
    ));
    const hpBefore = target.hp;
    target.hp = Math.max(this.minimumEnemyHp(target), target.hp - damage);
    const applied = Math.max(0, hpBefore - target.hp);
    this.registerCombo();
    this.emit("enemyHit", {
      actorId: this.activePartyMember().id,
      targetId: target.id,
      amount: applied,
      hpBefore,
      hpAfter: target.hp,
      critical: false,
      position: target.position,
      combo: this.state.comboCount,
      effectKind: "relic-chain-lightning",
    });
    if (target.hp <= 0) this.defeatEnemy(target);
    this.updateBossPhase(target);
  }

  private rollHeroDamage(
    multiplier = 1,
    bonusCriticalChancePercent = 0,
    impact?: HeroImpactContext,
  ): HeroDamageRoll {
    const hero = this.activeHeroDefinition();
    const variance = 1 + (this.nextRandom() * 2 - 1) * this.state.config.damageVariance;
    const critical = this.hasEffect(this.activePartyMember().id, "trajectory-perfect")
      || this.nextRandom() < clamp(
        this.state.config.criticalChance + bonusCriticalChancePercent / 100,
        0,
        1,
      );
    const criticalMultiplier = critical ? this.state.config.criticalMultiplier : 1;
    const effectiveMass = hero.mass * (
      hero.ricochetClass === "heavy" ? 1 + Math.max(0, this.relicValue("mass")) / 100 : 1
    );
    const physical = resolveHeroImpactFormula({
      ricochetClass: hero.ricochetClass,
      mass: effectiveMass,
      impactSpeed: impact?.impactSpeed ?? 1,
      referenceSpeed: impact?.referenceSpeed ?? 1,
      incidence: impact?.incidence ?? 1,
      ricochetCount: impact?.ricochetCount ?? 0,
      comboCount: impact?.comboCount ?? this.state.comboCount,
    });
    const damage = Math.max(1, Math.round(
      hero.stats.attack * classDamageMultiplier(hero.ricochetClass)
        * physical.multiplier * multiplier * variance * criticalMultiplier,
    ));
    return { damage, critical, ...physical };
  }

  private registerCombo(): void {
    this.state.comboCount += 1;
    this.state.totalHits += 1;
    this.state.bestCombo = Math.max(this.state.bestCombo, this.state.comboCount);
  }

  private enemyCarriesIncompleteObjectivePart(enemy: BattleEnemyState): boolean {
    if (this.state.objective.type !== "break-parts" && this.state.objective.type !== "seal") return false;
    return enemy.weakpoints.some((weakpoint) => this.state.objective.targets.some(
      (target) => target.kind === "bossPart"
        && !target.completed
        && (target.id === weakpoint.id || target.sourceId === weakpoint.partId),
    ));
  }

  private minimumEnemyHp(enemy: BattleEnemyState): number {
    const definition = this.enemyById[enemy.definitionId];
    if (!definition?.boss) return this.enemyCarriesIncompleteObjectivePart(enemy) ? 1 : 0;
    if (this.hasModifier("boss", "cannotBeKilled") || this.hasModifier("boss", "survivalBoss")) return 1;
    const authoredMinimum = this.modifierNumber("boss", "minimumHp", 0);
    return Math.max(authoredMinimum, this.enemyCarriesIncompleteObjectivePart(enemy) ? 1 : 0);
  }

  private updateBossPhase(enemy: BattleEnemyState): void {
    const definition = this.enemyById[enemy.definitionId];
    if (!definition?.boss || enemy.maxHp <= 0) return;
    if (this.stage.id === "r01-s03" || this.stage.id === "r01-s04") return;
    const hpPercent = enemy.hp / enemy.maxHp * 100;
    const thresholdStates = this.state.modifiers.filter(
      (modifier) => modifier.flag === "phaseHpThresholdPercent",
    ).sort((left, right) => Number(right.parameter?.value ?? 0) - Number(left.parameter?.value ?? 0));
    let crossed = 0;
    for (const modifier of thresholdStates) {
      const threshold = Number(modifier.parameter?.value ?? 0);
      if (hpPercent > threshold) continue;
      crossed += 1;
      if (modifier.triggerCount === 0) {
        this.triggerModifierState(modifier, { actorId: enemy.id, targetId: enemy.id, position: enemy.position }, threshold);
      }
    }
    if (thresholdStates.length === 0 && this.stage.boss?.phaseIds.length) {
      const phaseCount = Math.max(1, this.stage.boss.phaseIds.length);
      crossed = Math.min(phaseCount - 1, Math.floor((100 - hpPercent) / (100 / phaseCount)));
    }
    const nextPhase = Math.max(1, crossed + 1);
    this.setStagePhase(nextPhase, enemy.id, enemy.position, "boss-hp");
  }

  private setStagePhase(nextPhase: number, actorId?: string, position?: Vec2, effectKind?: string): void {
    const phase = Math.max(1, Math.round(nextPhase));
    if (phase <= this.state.stagePhase) return;
    const boss = actorId ? undefined : this.state.enemies.find(
      (enemy) => enemy.alive && this.enemyById[enemy.definitionId]?.boss,
    );
    this.state.stagePhase = phase;
    this.emit("stagePhaseChanged", {
      actorId: actorId ?? boss?.id,
      targetId: actorId ?? boss?.id,
      position: position ?? boss?.position,
      current: phase,
      effectKind,
    });
    this.applyStagePhaseMechanics();
  }

  private applyStagePhaseMechanics(): void {
    if (this.hasModifier("wall", "pillarsShiftInPhaseTwo") && this.state.stagePhase >= 2) {
      for (const [index, wall] of this.state.walls.entries()) {
        if (!wall.id.includes("pillar")) continue;
        wall.offset = vec2(index % 2 === 0 ? 55 : -55, 0);
        this.emitWallMoved(wall, "boss-phase-pillar-shift");
      }
      this.triggerModifier("pillarsShiftInPhaseTwo", { current: this.state.stagePhase }, this.state.stagePhase);
    }
    if (this.hasModifier("formation", "furnitureRearrangesEachPhase")) {
      for (const wall of this.state.walls) {
        wall.rotation += Math.PI / 12;
        this.emitWallMoved(wall, "boss-phase-furniture-rotation");
      }
      this.triggerModifier("furnitureRearrangesEachPhase", { current: this.state.stagePhase }, this.state.stagePhase);
    }
    if (this.hasModifier("hazard", "lightningPatternChangesPerPhase")) {
      for (const hazard of this.state.hazards.filter((entry) => entry.type === "lightning")) {
        const baseDamage = Number(hazard.parameters.baseDamage ?? hazard.parameters.damage ?? 25);
        hazard.parameters.baseDamage = baseDamage;
        hazard.parameters.damage = Math.round(baseDamage * (1 + (this.state.stagePhase - 1) * 0.2));
        hazard.phase = this.state.stagePhase - 1;
      }
      this.triggerModifier("lightningPatternChangesPerPhase", { current: this.state.stagePhase }, this.state.stagePhase);
    }
    if (this.hasModifier("hazard", "windSpeedRisesPerPhase")) {
      for (const hazard of this.state.hazards.filter((entry) => entry.type === "wind-vector" || entry.type === "current")) {
        const baseX = Number(hazard.parameters.baseForceX ?? hazard.parameters.forceX ?? 0);
        const baseY = Number(hazard.parameters.baseForceY ?? hazard.parameters.forceY ?? 0);
        hazard.parameters.baseForceX = baseX;
        hazard.parameters.baseForceY = baseY;
        hazard.parameters.forceX = baseX * (1 + (this.state.stagePhase - 1) * 0.18);
        hazard.parameters.forceY = baseY * (1 + (this.state.stagePhase - 1) * 0.18);
      }
      this.triggerModifier("windSpeedRisesPerPhase", { current: this.state.stagePhase }, this.state.stagePhase);
    }
    if (this.hasModifier("boss", "finalBoss") && this.state.stagePhase > 1) {
      for (const enemy of this.state.enemies.filter((entry) => entry.alive)) {
        enemy.attackCountdown = Math.max(1, enemy.attackCountdown - 1);
      }
      this.triggerModifier("finalBoss", { current: this.state.stagePhase }, this.state.stagePhase);
    }
  }

  private enemyIncomingDamageMultiplier(enemy: BattleEnemyState, contactPosition: Vec2): number {
    const hitDirection = normalize(vec2(
      contactPosition.x - enemy.position.x,
      contactPosition.y - enemy.position.y,
    ));
    const facing = normalize(enemy.facing, vec2(0, 1));
    const facingDot = hitDirection.x * facing.x + hitDirection.y * facing.y;
    if (facingDot <= -0.25 && this.hasModifier("boss", "eyeOpensAfterRearHit")) {
      for (const target of this.state.objective.targets.filter((entry) => entry.sourceId.includes("eye"))) {
        target.active = true;
      }
      this.triggerModifier("eyeOpensAfterRearHit", { targetId: enemy.id, position: contactPosition }, 1);
    }
    if (facingDot <= -0.25 && this.hasModifier("formation", "rearHitBreaksFormation")) {
      for (const shield of this.state.enemies.filter((entry) => entry.alive && entry.behaviorId === "shield")) {
        this.applyStatus(enemy.id, shield.id, "formation-broken", 1, 3);
      }
      this.triggerModifier("rearHitBreaksFormation", { targetId: enemy.id, position: contactPosition }, 1);
      this.emit("formationChanged", { targetId: enemy.id, position: contactPosition, effectKind: "rearHitBreaksFormation" });
    }
    const rearCritical = facingDot <= -0.25 && this.hasModifier("trajectory", "rearHitCritical");
    const rearRelicMultiplier = facingDot <= -0.25
      ? 1 + Math.max(0, this.relicValue("rear-hit-damage")) / 100
      : 1;
    if (rearCritical) this.triggerModifier("rearHitCritical", { targetId: enemy.id, position: contactPosition });
    if (enemy.behaviorId !== "shield" || this.hasEffect(enemy.id, "shield-break") || this.hasEffect(enemy.id, "formation-broken")) {
      return (rearCritical ? 1.5 : 1) * rearRelicMultiplier;
    }
    const shieldArc = clamp(this.enemyBehaviorNumber(enemy, "shieldArc", 120), 30, 180);
    const frontThreshold = Math.cos(shieldArc * Math.PI / 360);
    if (facingDot >= frontThreshold) {
      const authoredReduction = this.enemyBehaviorNumber(enemy, "frontReduction", 0.65);
      const behaviorReduction = authoredReduction <= 1 ? authoredReduction * 100 : authoredReduction;
      const reduction = this.hasModifier("formation", "shieldFrontDamageReductionPercent")
        ? this.modifierNumber("formation", "shieldFrontDamageReductionPercent", behaviorReduction)
        : behaviorReduction;
      if (this.hasModifier("formation", "shieldFrontDamageReductionPercent")) {
        this.triggerModifier("shieldFrontDamageReductionPercent", { targetId: enemy.id, position: contactPosition, amount: reduction }, reduction);
      }
      return clamp(1 - reduction / 100, 0.1, 0.75);
    }
    if (facingDot <= -frontThreshold) {
      const rearMultiplier = Math.max(1, this.enemyBehaviorNumber(enemy, "rearMultiplier", 1.5));
      return (rearCritical ? Math.max(2, rearMultiplier) : rearMultiplier) * rearRelicMultiplier;
    }
    return 0.85;
  }

  private damageEnemy(
    enemyId: string,
    multiplier: number | null,
    position: Vec2,
    impact: HeroImpactContext,
  ): void {
    const enemy = this.state.enemies.find((entry) => entry.id === enemyId);
    if (!enemy?.alive) return;
    const definition = this.enemyById[enemy.definitionId];
    const markMultiplier = this.hasEffect(enemy.id, "mark-weakpoint")
      ? 1 + this.effectValue(enemy.id, "mark-weakpoint") / 100
      : 1;
    const behaviorMultiplier = this.enemyIncomingDamageMultiplier(enemy, position);
    const bossMultiplier = definition?.boss
      ? 1 + Math.max(0, this.relicValue("boss-damage")) / 100
      : 1;
    const roll = this.rollHeroDamage(
      (multiplier ?? 1) * markMultiplier * behaviorMultiplier * bossMultiplier,
      0,
      impact,
    );
    const capped = this.minimumEnemyHp(enemy) > 0
      ? { damage: roll.damage, capped: false, cap: roll.damage }
      : capHeroContactDamage({
        rawDamage: roll.damage,
        targetMaxHp: enemy.maxHp,
        target: "enemy",
        boss: definition?.boss,
        elite: enemy.elite,
      });
    const hpBefore = enemy.hp;
    enemy.hp = Math.max(this.minimumEnemyHp(enemy), enemy.hp - capped.damage);
    const applied = Math.max(0, hpBefore - enemy.hp);
    this.registerCombo();
    this.emit("enemyHit", {
      actorId: this.activePartyMember().id,
      targetId: enemy.id,
      amount: applied,
      hpBefore,
      hpAfter: enemy.hp,
      critical: roll.critical,
      position,
      combo: this.state.comboCount,
      impactGrade: roll.grade,
      speedRatio: roll.speedRatio,
      incidence: roll.incidence,
      damageMultiplier: roll.multiplier,
      damageCapped: capped.capped,
    });
    let heavyStaggered = enemy.behaviorId !== "heavy";
    if (enemy.behaviorId === "heavy" && enemy.alive) {
      const threshold = Math.max(1, Math.round(this.enemyBehaviorNumber(enemy, "staggerThreshold", 1)));
      const stackId = `${this.activePartyMember().id}:${enemy.id}:heavy-impact-stack`;
      const stack = this.state.effects.find((effect) => effect.id === stackId);
      const next = (stack?.value ?? 0) + 1;
      if (next >= threshold) {
        if (stack) this.state.effects = this.state.effects.filter((effect) => effect !== stack);
        this.applyStatus(this.activePartyMember().id, enemy.id, "stun", 1, 1);
        this.emit("enemyBehavior", {
          actorId: this.activePartyMember().id,
          targetId: enemy.id,
          position,
          amount: threshold,
          effectKind: "heavy-staggered",
        });
        heavyStaggered = true;
      } else if (stack) {
        stack.value = next;
        stack.remainingTurns = Math.max(stack.remainingTurns, 3);
      } else {
        this.state.effects.push({
          id: stackId,
          sourceId: this.activePartyMember().id,
          targetId: enemy.id,
          kind: "heavy-impact-stack",
          value: next,
          remainingTurns: 3,
          appliedTurn: this.state.turnNumber,
          deferUntilNextTurn: false,
        });
      }
    }
    if (
      this.hasModifier("objective", "exitUnlocksAfterBruteStaggers")
      && enemy.behaviorId === "heavy"
      && heavyStaggered
      && (this.modifierState("exitUnlocksAfterBruteStaggers")?.value ?? 0) < this.modifierNumber(
        "objective", "exitUnlocksAfterBruteStaggers", 1,
      )
    ) {
      const modifier = this.modifierState("exitUnlocksAfterBruteStaggers");
      const next = Math.round(modifier?.value ?? 0) + 1;
      if (modifier) this.triggerModifierState(modifier, { targetId: enemy.id, position, current: next }, next);
      if (next >= this.modifierNumber("objective", "exitUnlocksAfterBruteStaggers", 1)) {
        for (const target of this.state.objective.targets.filter((entry) => entry.kind === "exit")) target.active = true;
      }
    }
    if (enemy.hp <= 0) this.defeatEnemy(enemy);
    this.applyRelicContactFollowUp(enemy.id, position);
    this.updateBossPhase(enemy);
    this.checkVictory();
  }

  private damageWeakpoint(
    weakpointId: string,
    position: Vec2,
    precisionMultiplier = 1,
    impact: HeroImpactContext,
  ): void {
    const enemy = this.state.enemies.find((entry) => entry.weakpoints.some((weakpoint) => weakpoint.id === weakpointId));
    const weakpoint = enemy?.weakpoints.find((entry) => entry.id === weakpointId);
    if (!enemy?.alive || !weakpoint || weakpoint.broken) return;
    this.reduceSuctionFromAuthoredAnchor(weakpoint.partId, position);
    const objectiveTarget = this.objectiveTargetsFor(weakpoint.id).find((target) => target.kind === "bossPart");
    if (objectiveTarget && !this.acceptOrderedObjectiveContact(objectiveTarget.sourceId, position)) return;
    if (this.state.objective.type === "seal" && !this.acceptSealContact(weakpoint, position)) return;
    const activeMultiplier = this.hasEffect(this.activePartyMember().id, "weakpoint-multiplier")
      ? 1 + this.effectValue(this.activePartyMember().id, "weakpoint-multiplier") / 100
      : 1;
    const weakpointMultiplier = 1 + Math.max(0, this.relicValue("weakpoint-damage")) / 100;
    const partBreakMultiplier = weakpoint.breakable
      ? 1 + Math.max(0, this.relicValue("part-break-damage")) / 100
      : 1;
    const bossMultiplier = this.enemyById[enemy.definitionId]?.boss
      ? 1 + Math.max(0, this.relicValue("boss-damage")) / 100
      : 1;
    const firstWeakpointCritical = !this.relicEffectUsed("first-weakpoint-critical")
      ? Math.max(0, this.relicValue("first-weakpoint-critical", "max"))
      : 0;
    const roll = this.rollHeroDamage(
      weakpoint.damageMultiplier * activeMultiplier * weakpointMultiplier * partBreakMultiplier * bossMultiplier
        * Math.max(1, precisionMultiplier),
      firstWeakpointCritical,
      impact,
    );
    if (firstWeakpointCritical > 0) this.markRelicEffectUsed("first-weakpoint-critical");
    const enemyHpBefore = enemy.hp;
    const weakpointHpBefore = weakpoint.hp;
    const definition = this.enemyById[enemy.definitionId];
    const enemyDamage = this.minimumEnemyHp(enemy) > 0
      ? { damage: roll.damage, capped: false, cap: roll.damage }
      : capHeroContactDamage({
        rawDamage: roll.damage,
        targetMaxHp: enemy.maxHp,
        target: "enemy",
        boss: definition?.boss,
        elite: enemy.elite,
      });
    const partDamage = capHeroContactDamage({
      rawDamage: roll.damage,
      targetMaxHp: weakpoint.maxHp,
      target: "weakpoint",
      boss: definition?.boss,
      elite: enemy.elite,
    });
    enemy.hp = Math.max(this.minimumEnemyHp(enemy), enemy.hp - enemyDamage.damage);
    const isSealTarget = this.state.objective.type === "seal" && Boolean(objectiveTarget);
    const exactHeadTarget = this.hasModifier("sequence", "exactHeadChainCount")
      && objectiveTarget?.sourceId === "scylla-heads";
    if (weakpoint.breakable && !isSealTarget) {
      weakpoint.hp = exactHeadTarget ? 0 : Math.max(0, weakpoint.hp - partDamage.damage);
    }
    const appliedToEnemy = Math.max(0, enemyHpBefore - enemy.hp);
    const appliedToPart = Math.max(0, weakpointHpBefore - weakpoint.hp);
    this.registerCombo();
    this.emit("weakpointHit", {
      actorId: this.activePartyMember().id,
      targetId: weakpoint.id,
      amount: Math.max(appliedToEnemy, appliedToPart),
      hpBefore: enemyHpBefore,
      hpAfter: enemy.hp,
      critical: roll.critical,
      position,
      combo: this.state.comboCount,
      impactGrade: roll.grade,
      speedRatio: roll.speedRatio,
      incidence: roll.incidence,
      damageMultiplier: roll.multiplier,
      damageCapped: enemyDamage.capped || partDamage.capped,
    });
    if (weakpoint.breakable && !isSealTarget && weakpoint.hp <= 0) {
      weakpoint.broken = true;
      this.emit("weakpointBroken", {
        actorId: this.activePartyMember().id,
        targetId: weakpoint.id,
        position,
      });
    }
    if (enemy.hp <= 0) this.defeatEnemy(enemy);
    this.applyRelicContactFollowUp(enemy.id, position);
    this.updateBossPhase(enemy);
    this.syncWeakpointObjective(weakpoint, position);
    this.applyObjectiveCompletionModifiers(position);
    this.checkVictory();
  }

  private createReinforcementState(
    definition: EnemyDefinition,
    id: string,
    position: Vec2,
    level: number,
    parentId: string,
    generation: number,
    hpScale = 1,
    radiusScale = 1,
  ): BattleEnemyState {
    const baseMaxHp = enemyMaxHp(definition, level, false, this.state.config);
    const maxHp = Math.max(1, Math.round(baseMaxHp * hpScale));
    return {
      id,
      definitionId: definition.id,
      spawnId: id,
      level,
      elite: false,
      hp: maxHp,
      maxHp,
      position: { ...position },
      radius: Math.max(6, definition.radius * radiusScale),
      behaviorId: definition.behaviorId,
      facing: vec2(0, 1),
      generation,
      parentId,
      splitUsed: generation > 0,
      summonCount: 0,
      attackCountdown: Math.max(1, definition.attackCountdown),
      alive: true,
      weakpoints: [],
    };
  }

  private spawnSplitChildren(enemy: BattleEnemyState): void {
    const definition = this.enemyById[enemy.definitionId];
    if (!definition || definition.boss || enemy.behaviorId !== "splitter" || enemy.splitUsed) return;
    enemy.splitUsed = true;
    const childGeneration = enemy.generation + 1;
    const childCount = Math.max(1, Math.min(6, Math.round(this.enemyBehaviorNumber(enemy, "childCount", 2))));
    const healthRatio = clamp(this.enemyBehaviorNumber(enemy, "childHealthRatio", 0.38), 0.1, 0.8);
    const splitImpulse = Math.max(enemy.radius * 0.75, this.enemyBehaviorNumber(enemy, "splitImpulse", enemy.radius * 0.75));
    for (let index = 0; index < childCount; index += 1) {
      const suffix = childCount === 2 ? (index === 0 ? "a" : "b") : `${index + 1}`;
      const childId = `${enemy.id}:split:${suffix}`;
      if (this.state.enemies.some((entry) => entry.id === childId)) continue;
      const angle = -Math.PI / 2 + index * Math.PI * 2 / childCount;
      const child = this.createReinforcementState(
        definition,
        childId,
        vec2(
          clamp(enemy.position.x + Math.cos(angle) * splitImpulse, definition.radius * 0.68, this.stage.arena.width - definition.radius * 0.68),
          clamp(enemy.position.y + Math.sin(angle) * splitImpulse, definition.radius * 0.68, this.stage.arena.height - definition.radius * 0.68),
        ),
        enemy.level,
        enemy.id,
        childGeneration,
        healthRatio,
        0.68,
      );
      this.state.enemies.push(child);
      this.emit("enemySpawned", {
        actorId: enemy.id,
        targetId: child.id,
        position: child.position,
        effectKind: "splitter",
      });
    }
  }

  private defeatEnemy(enemy: BattleEnemyState): void {
    if (!enemy.alive) return;
    this.spawnSplitChildren(enemy);
    enemy.alive = false;
    enemy.hp = 0;
    this.emit("enemyDefeated", {
      actorId: this.activePartyMember().id,
      targetId: enemy.id,
      position: enemy.position,
    });
    this.refreshObjectiveProgress(enemy.id, enemy.position);
  }

  private brokenWeakpointCount(): number {
    return this.state.enemies.reduce(
      (total, enemy) => total + enemy.weakpoints.filter((weakpoint) => weakpoint.broken).length,
      0,
    );
  }

  private checkVictory(allowSurvive = true): boolean {
    if (this.state.phase === "victory" || this.state.phase === "defeat") return this.state.phase === "victory";
    let reason: BattleOutcomeReason | null = null;
    if (this.state.victoryRule.type === "defeatAll" && this.state.enemies.every((enemy) => !enemy.alive)) {
      reason = "allEnemiesDefeated";
    }
    if (
      this.state.victoryRule.type === "breakWeakpoints"
      && this.brokenWeakpointCount() >= this.state.victoryRule.required
    ) {
      reason = "weakpointsBroken";
    }
    if (
      allowSurvive
      && this.state.victoryRule.type === "surviveTurns"
      && this.state.completedTurns >= this.state.victoryRule.turns
    ) {
      reason = "survived";
    }
    if (
      this.state.victoryRule.type === "completeTargets"
      && this.state.objective.completed
    ) {
      const exactHeadChain = this.modifierState("exactHeadChainCount");
      const exactChainSatisfied = !exactHeadChain
        || (exactHeadChain.lastTurn === this.state.turnNumber
          && exactHeadChain.value >= this.modifierNumber("sequence", "exactHeadChainCount", 6));
      if (exactChainSatisfied) {
        if (this.state.victoryRule.objectiveType === "protect") reason = "protected";
        else if (this.state.victoryRule.objectiveType === "seal") reason = "sealed";
        else if (this.state.victoryRule.objectiveType === "escape") reason = "escaped";
        else reason = "targetsCompleted";
      }
    }
    if (
      allowSurvive
      && this.state.victoryRule.type === "protectTargets"
      && !this.state.objective.failed
      && this.state.completedTurns >= this.state.victoryRule.turns
      && this.state.objective.targets.filter((target) => !target.failed).length >= this.state.victoryRule.required
    ) {
      reason = "protected";
    }
    if (!reason) return false;
    this.refreshObjectiveProgress();
    this.state.objective.completed = true;
    this.state.phase = "victory";
    this.state.projectile = null;
    this.state.fixedAccumulator = 0;
    this.state.outcome = { victory: true, reason, turnNumber: this.state.turnNumber };
    this.emit("objectiveCompleted", {
      current: this.state.objective.current,
      required: this.state.objective.required,
    });
    this.emit("victory", { reason });
    return true;
  }

  private finishProjectileTurn(): void {
    const projectile = this.state.projectile;
    if (!projectile) return;
    const actor = this.activePartyMember();
    actor.position = { ...(projectile.teleportDestination ?? projectile.trajectory.finalPosition) };
    this.state.projectile = null;
    this.state.fixedAccumulator = 0;
    this.completePartyTurn(actor);
  }

  private completePartyTurn(actor: BattlePartyMemberState): void {
    this.state.completedTurns += 1;
    this.chargeActiveSkills(actor.id);
    this.refreshObjectiveProgress();
    this.emit("turnEnded", {
      actorId: actor.id,
      combo: this.state.comboCount,
      ricochets: this.state.ricochetCount,
    });
    this.enforceTurnEndSequences();
    this.advanceStageMechanics();
    // A scheduled environmental pulse can defeat the final hero while stage
    // mechanics advance. Do not continue into turn-limit or enemy retaliation.
    if (this.state.outcome?.victory === false) return;
    if (this.checkVictory(false)) return;
    if (
      this.state.victoryRule.type !== "surviveTurns"
      && this.state.victoryRule.type !== "protectTargets"
      && this.state.completedTurns >= this.stage.objective.turnLimit + Math.max(0, this.state.rescueTurnLimitBonus)
    ) {
      this.endDefeat("turnLimit");
      return;
    }
    let enemyPhaseResolved = false;
    if (this.state.enemies.some((enemy) => enemy.alive)) {
      if (this.hasModifier("enemy", "disguiseFirstShotNoAggro") && this.state.completedTurns === 1) {
        this.triggerModifier("disguiseFirstShotNoAggro", { actorId: actor.id, position: actor.position }, 1);
      } else {
        enemyPhaseResolved = true;
        const protectedHpBefore = this.state.objective.targets.reduce((sum, target) => sum + target.hp, 0);
        const enemyActions = this.resolveEnemyRetaliation();
        const protectedHpAfter = this.state.objective.targets.reduce((sum, target) => sum + target.hp, 0);
        if (this.state.phase !== "defeat" && protectedHpAfter >= protectedHpBefore) {
          this.damageProtectedMemory(enemyActions);
        }
      }
    }
    // Protect objectives are damaged by authored enemy attacks at their real
    // positions. Do not subtract abstract HP merely because an enemy acted.
    this.tickStatusEffects(actor.id, enemyPhaseResolved);
    if (this.state.phase === "defeat" || this.checkVictory(true)) return;
    this.advancePartyTurn();
  }

  private enforceTurnEndSequences(): void {
    const exactHeadChain = this.modifierState("exactHeadChainCount");
    if (
      exactHeadChain
      && exactHeadChain.value < this.modifierNumber("sequence", "exactHeadChainCount", 6)
    ) {
      this.resetObjectiveSequence("exactHeadChainCount", this.activePartyMember().position);
    }
    if (
      this.hasModifier("sequence", "singleShotAllRings")
      && !this.state.objective.completed
      && this.state.objective.current < this.state.objective.required
    ) {
      this.resetObjectiveSequence("singleShotAllRings", this.activePartyMember().position);
      if (this.hasModifier("sequence", "missResetsChain")) {
        this.resetObjectiveSequence("missResetsChain", this.activePartyMember().position);
      }
    }
  }

  private chargeActiveSkills(actingMemberId: string): void {
    for (const member of this.state.party) {
      if (!member.alive || member.activeSkill.ready) continue;
      // Every allied action advances the whole party. A strong combo gives the
      // acting hero one extra pip, so authored costs 9..17 always resolve in
      // at most 17 team turns (and commonly sooner) rather than 4x that long.
      const gain = 1 + (member.id === actingMemberId && this.state.comboCount >= 5 ? 1 : 0);
      member.activeSkill.charge = Math.min(member.activeSkill.requiredCharge, member.activeSkill.charge + gain);
      this.emit("activeSkillCharged", {
        actorId: member.id,
        amount: gain,
        current: member.activeSkill.charge,
        required: member.activeSkill.requiredCharge,
      });
      if (member.activeSkill.charge < member.activeSkill.requiredCharge) continue;
      member.activeSkill.ready = true;
      this.emit("activeSkillReady", {
        actorId: member.id,
        current: member.activeSkill.charge,
        required: member.activeSkill.requiredCharge,
      });
    }
  }

  private advanceStageMechanics(): void {
    for (const hazard of this.state.hazards) {
      if (!hazard.active) continue;
      hazard.phase += 1;
      const previous = { ...hazard.position };
      if (hazard.type === "wave-front") {
        const warningTurns = Math.max(0, Math.round(Number(hazard.parameters.warningTurns ?? 1)));
        const activeTurns = Math.max(1, Math.round(Number(hazard.parameters.activeTurns ?? 3)));
        const cycleLength = Math.max(1, warningTurns + activeTurns);
        const cycle = (hazard.phase - 1) % cycleLength;
        const armed = warningTurns === 0 || cycle >= warningTurns;
        const activeIndex = Math.max(0, cycle - warningTurns);
        const progress = activeTurns <= 1 ? 1 : clamp(activeIndex / (activeTurns - 1), 0, 1);
        const axis = String(hazard.parameters.axis ?? "y");
        const direction = Math.sign(Number(hazard.parameters.direction ?? 1)) || 1;
        const distance = Math.max(0, Number(hazard.parameters.distance
          ?? (axis === "x" ? this.stage.arena.width : this.stage.arena.height)));
        hazard.parameters.armed = armed;
        hazard.parameters.waveProgress = armed ? progress : 0;
        hazard.position = armed
          ? vec2(
            hazard.origin.x + (axis === "x" ? distance * progress * direction : 0),
            hazard.origin.y + (axis === "y" ? distance * progress * direction : 0),
          )
          : { ...hazard.origin };
        if (!armed) {
          this.emit("hazardWarning", {
            targetId: hazard.id,
            position: hazard.position,
            effectKind: "wave-front",
            duration: Math.max(1, warningTurns - cycle),
          });
        } else {
          this.resolveWaveFrontTurn(hazard);
        }
      } else if (hazard.type === "moving-bumper" || hazard.parameters.moving === true) {
        const period = Math.max(1, Number(hazard.parameters.periodTurns ?? 4));
        const distance = Number(hazard.parameters.distance ?? 120);
        // `periodTurns` is authored as the number of turns from center to the
        // opposite center crossing. A half-wave avoids period=2 sampling only
        // zeroes at integer turn boundaries.
        const wave = Math.sin((hazard.phase / period) * Math.PI);
        const axis = String(hazard.parameters.axis ?? "x");
        hazard.position = vec2(
          hazard.origin.x + (axis === "y" ? 0 : distance * wave),
          hazard.origin.y + (axis === "x" ? 0 : distance * wave * (axis === "diagonal" ? 0.7 : 1)),
        );
        if (hazard.type === "moving-bumper") this.sweepBoulderDamage(hazard, previous);
      }
      if (hazard.type === "current" || hazard.type === "wind-vector" || hazard.type === "whirlpool") {
        const pulseTurns = Math.max(1, Number(hazard.parameters.pulseTurns ?? 1));
        hazard.parameters.pulseActive = hazard.phase % pulseTurns === 0;
        if (hazard.parameters.reverseEachTurn === true) {
          hazard.parameters.directionSign = hazard.phase % 2 === 0 ? 1 : -1;
        }
      }
      if (hazard.type === "slow-field") {
        const baseRadius = Math.max(1, Number(hazard.parameters.baseRadius ?? hazard.radius));
        const expansion = Math.max(0, Number(hazard.parameters.expandsPerTurn ?? 0));
        hazard.radius = clamp(
          baseRadius + expansion * hazard.phase,
          1,
          Math.max(this.stage.arena.width, this.stage.arena.height) * 1.25,
        );
      }
      if (hazard.type === "sound-wave") {
        const baseRadius = Math.max(1, Number(hazard.parameters.baseRadius ?? hazard.radius));
        const expansion = Math.max(0, Number(hazard.parameters.expansion ?? 0));
        const period = Math.max(1, Math.round(Number(hazard.parameters.periodTurns ?? 1)));
        const expansionCycle = hazard.phase % (period + 1);
        const progress = Math.min(1, expansionCycle / period);
        hazard.radius = clamp(
          baseRadius + expansion * progress,
          1,
          Math.max(this.stage.arena.width, this.stage.arena.height) * 1.25,
        );
        hazard.parameters.gapAngle = hazard.phase * Number(hazard.parameters.rotatingGapDegrees ?? 0);
        const warningTurns = Math.max(0, Math.round(Number(hazard.parameters.warningTurns ?? 0)));
        const warningCycle = Math.max(1, warningTurns + 1);
        hazard.parameters.armed = warningTurns === 0 || hazard.phase % warningCycle === warningTurns;
        if (hazard.parameters.armed !== true) {
          this.emit("hazardWarning", {
            targetId: hazard.id,
            position: hazard.position,
            effectKind: "sound-wave",
            duration: warningTurns,
          });
        }
      }
      if (hazard.type === "lightning") {
        const warningTurns = Math.max(0, Number(hazard.parameters.warningTurns ?? 0));
        const cycle = Math.max(1, warningTurns + 1);
        hazard.parameters.armed = warningTurns === 0 || hazard.phase % cycle === warningTurns;
        if (hazard.parameters.armed !== true) {
          this.emit("hazardWarning", {
            targetId: hazard.id,
            position: hazard.position,
            effectKind: "lightning",
            duration: warningTurns,
          });
        }
        const strikes = Math.max(1, Number(hazard.parameters.strikes ?? 1));
        if (strikes > 1) {
          const strikeIndex = hazard.phase % strikes;
          const angle = strikeIndex / strikes * Math.PI * 2;
          const distance = Math.min(hazard.radius * 0.5, 130);
          hazard.position = add(hazard.origin, vec2(Math.cos(angle) * distance, Math.sin(angle) * distance));
          hazard.parameters.strikeIndex = strikeIndex;
        }
      }
      if (previous.x !== hazard.position.x || previous.y !== hazard.position.y) {
        this.emit("hazardMoved", { targetId: hazard.id, position: hazard.position, effectKind: hazard.type });
      }
      if (hazard.remainingTurns !== undefined) {
        if (Number(hazard.parameters.createdTurn ?? -1) !== this.state.turnNumber) hazard.remainingTurns -= 1;
        if (hazard.remainingTurns <= 0) hazard.active = false;
      }
    }
    this.state.hazards = this.state.hazards.filter((hazard) => hazard.active || hazard.spawnedBy === undefined);

    if (this.hasModifier("wall", "wallsRotateAfterShot")) {
      for (const wall of this.state.walls.filter((entry) => !entry.broken)) {
        wall.rotation += Math.PI / 12;
        this.emitWallMoved(wall, "turn-rotation");
      }
      this.triggerModifier("wallsRotateAfterShot", { current: this.state.completedTurns }, this.state.completedTurns);
    }
    if (this.hasModifier("wall", "gatesShiftAfterShot")) {
      const direction = this.state.completedTurns % 2 === 0 ? -1 : 1;
      for (const [index, wall] of this.state.walls.entries()) {
        wall.offset = vec2(direction * (index % 2 === 0 ? 55 : -55), 0);
        this.emitWallMoved(wall, "gate-shift");
      }
      this.triggerModifier("gatesShiftAfterShot", { current: this.state.completedTurns }, direction);
    }
    if (this.hasModifier("wall", "spiritWallsPhaseCadence")) {
      const cadence = Math.max(1, this.modifierNumber("wall", "spiritWallsPhaseCadence", 2));
      const active = Math.floor(this.state.completedTurns / cadence) % 2 === 0;
      for (const wall of this.state.walls) {
        const authored = this.stage.walls.find((entry) => entry.id === wall.id);
        if (authored?.material === "spirit") {
          wall.active = active;
          this.emitWallMoved(wall, "spirit-phase");
        }
      }
      this.triggerModifier("spiritWallsPhaseCadence", { current: active ? 1 : 0 }, active ? 1 : 0);
    }
    if (this.hasModifier("wall", "gateChangesSolidState")) {
      const active = this.state.completedTurns % 2 === 0;
      for (const wall of this.state.walls) {
        wall.active = active;
        this.emitWallMoved(wall, "gate-solid-state");
      }
      this.triggerModifier("gateChangesSolidState", { current: active ? 1 : 0 }, active ? 1 : 0);
    }
    if (this.hasModifier("hazard", "safeLaneShiftsEachTurn")) {
      const offset = (this.state.completedTurns % 3 - 1) * 90;
      for (const wall of this.state.walls.filter((entry) => entry.id.includes("safe") || entry.id.includes("lane"))) {
        wall.offset = vec2(offset, 0);
        this.emitWallMoved(wall, "safe-lane-shift");
      }
      for (const [index, hazard] of this.state.hazards.entries()) {
        const baseForce = Number(hazard.parameters.safeLaneBaseForce ?? hazard.parameters.force ?? 0);
        const baseForceX = Number(hazard.parameters.safeLaneBaseForceX ?? hazard.parameters.forceX ?? 0);
        hazard.parameters.safeLaneBaseForce = baseForce;
        hazard.parameters.safeLaneBaseForceX = baseForceX;
        const safeIndex = this.state.completedTurns % Math.max(1, this.state.hazards.length);
        if (baseForce !== 0) hazard.parameters.force = index === safeIndex ? baseForce * 0.35 : baseForce;
        if (baseForceX !== 0) hazard.parameters.forceX = index === safeIndex ? baseForceX * 0.35 : baseForceX;
      }
      this.triggerModifier("safeLaneShiftsEachTurn", { current: offset }, offset);
    }
    if (this.hasModifier("hazard", "movingBumperBeforeEnemyPhase")) {
      this.triggerModifier("movingBumperBeforeEnemyPhase", { current: this.state.completedTurns }, this.state.completedTurns);
    }
    const reinforcementTurn = this.state.config.reinforcementTurnOverride
      ?? this.modifierNumber("enemy", "reinforcementTurn", 0);
    const reinforcementModifier = this.modifierState("reinforcementTurn");
    if (reinforcementTurn > 0 && this.state.completedTurns === reinforcementTurn && reinforcementModifier?.triggerCount === 0) {
      this.spawnScriptedReinforcement(reinforcementModifier);
    }

    // Authored moving protected cattle use a forbidden-target sensor rather
    // than a moving prop definition. Move the visible/objective state with it.
    for (const target of this.state.objective.targets) {
      const movingSensor = this.state.hazards.find((hazard) => {
        if (hazard.type !== "forbidden-target" || hazard.parameters.moving !== true) return false;
        return Math.hypot(
          target.position.x - hazard.origin.x,
          target.position.y - hazard.origin.y,
        ) <= target.radius + hazard.radius;
      });
      if (!movingSensor) continue;
      const offset = Math.sin(movingSensor.phase * Math.PI / 2) * 70;
      target.position = vec2(movingSensor.origin.x + offset, target.position.y);
      movingSensor.position = vec2(target.position.x, movingSensor.position.y);
      const prop = this.state.props.find((entry) => entry.id === target.id);
      if (prop) prop.position = { ...target.position };
      this.emit("hazardMoved", { targetId: target.id, position: target.position, effectKind: "protected-target" });
      if (this.hasModifier("objective", "protectedTargetsMoveAfterShot")) {
        this.triggerModifier("protectedTargetsMoveAfterShot", { targetId: target.id, position: target.position }, offset);
      }
    }
  }

  private resolveWaveFrontTurn(hazard: BattleHazardState): void {
    const movementAxis = String(hazard.parameters.axis ?? "y");
    const length = Math.max(
      hazard.radius * 2,
      Number(hazard.parameters.length ?? (movementAxis === "x" ? this.stage.arena.height : this.stage.arena.width)),
    );
    const direction = Math.sign(Number(hazard.parameters.direction ?? 1)) || 1;
    const pushDistance = Math.max(0, Number(hazard.parameters.pushDistance ?? 34));
    const amount = Math.max(1, Math.round(Number(hazard.parameters.damage ?? 24)));
    for (const member of this.state.party.filter((entry) => entry.alive)) {
      const across = movementAxis === "x"
        ? Math.abs(member.position.y - hazard.position.y)
        : Math.abs(member.position.x - hazard.position.x);
      const toward = movementAxis === "x"
        ? Math.abs(member.position.x - hazard.position.x)
        : Math.abs(member.position.y - hazard.position.y);
      if (across > length / 2 + member.radius || toward > hazard.radius + member.radius) continue;
      if (
        Number(hazard.parameters.lastContactTurn ?? -1) === this.state.turnNumber
        && String(hazard.parameters.lastContactActorId ?? "") === member.id
      ) continue;
      const actionId = `${hazard.id}:wave-turn:${this.state.turnNumber}:${member.id}`;
      this.emit("hazardTriggered", {
        actionId,
        actorId: hazard.id,
        targetId: member.id,
        position: member.position,
        effectKind: "wave-front",
      });
      this.damageHero({ id: hazard.id }, member, amount, {
        actionId,
        sourceKind: "hazard",
        attackKind: "wave-front",
        intentKind: "area",
        effectKind: "wave-front",
      });
      if (!member.alive || pushDistance <= 0) continue;
      member.position = vec2(
        clamp(
          member.position.x + (movementAxis === "x" ? pushDistance * direction : 0),
          member.radius,
          this.stage.arena.width - member.radius,
        ),
        clamp(
          member.position.y + (movementAxis === "y" ? pushDistance * direction : 0),
          member.radius,
          this.stage.arena.height - member.radius,
        ),
      );
    }
    if (this.state.party.every((member) => !member.alive)) this.endDefeat("partyDefeated");
  }

  private spawnScriptedReinforcement(modifier: BattleStageModifierState): void {
    const preferred = firstAvailableNonBossEnemy(
      SCRIPTED_REINFORCEMENT_CANDIDATE_IDS,
      this.enemyById,
    )
      ?? Object.values(this.enemyById).find((definition) => !definition.boss);
    if (!preferred) return;
    const id = `stage-reinforcement:${this.state.completedTurns}`;
    if (this.state.enemies.some((enemy) => enemy.id === id)) return;
    const reinforcement = this.createReinforcementState(
      preferred,
      id,
      vec2(this.stage.arena.width / 2, Math.max(preferred.radius + 20, 90)),
      Math.max(1, ...this.state.enemies.map((enemy) => enemy.level)),
      "stage",
      1,
      0.8,
      0.9,
    );
    this.state.enemies.push(reinforcement);
    this.emit("enemySpawned", {
      actorId: "stage",
      targetId: reinforcement.id,
      position: reinforcement.position,
      effectKind: "reinforcementTurn",
    });
    this.refreshObjectiveProgress(reinforcement.id, reinforcement.position);
    this.triggerModifierState(modifier, {
      targetId: reinforcement.id,
      position: reinforcement.position,
      current: this.state.completedTurns,
    }, this.state.completedTurns);
  }

  private damageProtectedMemory(enemyActions: number): void {
    if (!this.hasModifier("objective", "protectedMemoryDamagedOnEnemyAction")) return;
    if (enemyActions <= 0) return;
    const amount = enemyActions * 10;
    for (const target of this.state.objective.targets.filter((entry) => entry.active && !entry.failed)) {
      target.hp = Math.max(0, target.hp - amount);
      this.triggerModifier("protectedMemoryDamagedOnEnemyAction", {
        targetId: target.id,
        position: target.position,
        amount,
        current: target.hp,
        required: target.maxHp,
      }, target.hp);
      this.setPropState(target, target.hp > 0 ? "protected" : "failed");
      if (target.hp <= 0) {
        target.failed = true;
        target.active = false;
        this.failObjective(target.id, target.position);
        return;
      }
    }
  }

  private tickStatusEffects(completedPartyId: string, enemyPhaseResolved: boolean): void {
    const partyIds = new Set(this.state.party.map((member) => member.id));
    for (const effect of this.state.effects) {
      if (effect.remainingTurns <= 0) continue;
      const targetsParty = partyIds.has(effect.targetId);
      const shouldTickParty = targetsParty
        && effect.targetId === completedPartyId
        && (!effect.deferUntilNextTurn || (effect.appliedTurn ?? 0) < this.state.turnNumber);
      const shouldTickEnemy = !targetsParty && enemyPhaseResolved;
      if (!shouldTickParty && !shouldTickEnemy) continue;
      if (effect.kind === "regeneration" && shouldTickParty) {
        const target = this.state.party.find((member) => member.id === effect.targetId && member.alive);
        if (target) target.hp = Math.min(target.maxHp, target.hp + Math.max(1, Math.round(effect.value)));
      }
      if (effect.kind === "burn" && shouldTickEnemy) {
        const target = this.state.enemies.find((enemy) => enemy.id === effect.targetId && enemy.alive);
        if (target) {
          const hpBefore = target.hp;
          target.hp = Math.max(this.minimumEnemyHp(target), target.hp - Math.max(1, Math.round(effect.value)));
          const applied = hpBefore - target.hp;
          this.emit("enemyHit", {
            actorId: effect.sourceId,
            targetId: target.id,
            position: target.position,
            amount: applied,
            hpBefore,
            hpAfter: target.hp,
            critical: false,
            effectKind: "relic-burn",
          });
          if (target.hp <= 0) this.defeatEnemy(target);
          this.updateBossPhase(target);
        }
      }
      effect.remainingTurns -= 1;
    }
    this.state.effects = this.state.effects.filter((effect) => effect.remainingTurns > 0);
  }

  private resolveEnemyRetaliation(): number {
    this.state.phase = "retaliation";
    let actions = 0;
    this.emit("enemyPhaseStarted", {
      amount: this.state.enemies.filter((enemy) => enemy.alive).length,
      effectKind: "retaliation",
    });
    for (const enemy of [...this.state.enemies]) {
      if (!enemy.alive) continue;
      enemy.attackCountdown -= 1;
      const intent = this.enemyIntentForResolution(enemy);
      this.emit("enemyTelegraph", {
        actorId: enemy.id,
        targetId: intent.primaryTargetId,
        targetIds: intent.targetIds,
        targetPosition: intent.targetPosition,
        amount: Math.max(0, enemy.attackCountdown),
        position: enemy.position,
        effectKind: enemy.behaviorId,
        attackKind: intent.attackKind,
        intentKind: intent.intentKind,
        range: intent.range,
        areaRadius: intent.areaRadius,
      });
      if (enemy.attackCountdown > 0) continue;
      const actionId = `${enemy.id}:${this.state.turnNumber}:${this.state.eventSequence + 1}`;
      this.emit("enemyActionStarted", {
        actionId,
        actorId: enemy.id,
        targetId: intent.primaryTargetId,
        targetIds: intent.targetIds,
        targetPosition: intent.targetPosition,
        position: enemy.position,
        attackKind: intent.attackKind,
        intentKind: intent.intentKind,
        effectKind: enemy.behaviorId,
        range: intent.range,
        areaRadius: intent.areaRadius,
      });
      if (this.hasEffect(enemy.id, "bind") || this.hasEffect(enemy.id, "stun")) {
        const blockReason = this.hasEffect(enemy.id, "stun") ? "stunned" : "bound";
        this.emit("enemyBehavior", {
          actionId,
          actorId: enemy.id,
          targetId: intent.primaryTargetId,
          targetIds: intent.targetIds,
          targetPosition: intent.targetPosition,
          position: enemy.position,
          effectKind: blockReason,
          attackKind: intent.attackKind,
          intentKind: "disabled",
          range: intent.range,
          areaRadius: intent.areaRadius,
        });
        this.emit("enemyActionResolved", {
          actionId,
          actorId: enemy.id,
          targetId: intent.primaryTargetId,
          targetIds: intent.targetIds,
          targetPosition: intent.targetPosition,
          position: enemy.position,
          attackKind: intent.attackKind,
          intentKind: "disabled",
          outcomeKind: "blocked",
          effectKind: blockReason,
          range: intent.range,
          areaRadius: intent.areaRadius,
        });
        const definition = this.enemyById[enemy.definitionId];
        enemy.attackCountdown = Math.max(1, definition?.attackCountdown ?? 1);
        continue;
      }
      const resolution = this.enemyAttack(enemy, actionId, intent);
      actions += 1;
      this.emit("enemyActionResolved", {
        actionId,
        actorId: enemy.id,
        targetId: resolution.targetIds[0] ?? intent.primaryTargetId,
        targetIds: [...resolution.targetIds],
        targetPosition: intent.targetPosition,
        position: enemy.position,
        amount: resolution.amount,
        attackKind: intent.attackKind,
        intentKind: intent.intentKind,
        outcomeKind: resolution.outcomeKind,
        effectKind: enemy.behaviorId,
        range: intent.range,
        areaRadius: intent.areaRadius,
      });
      if (this.state.outcome?.victory === false) {
        this.emit("enemyPhaseEnded", { amount: actions, effectKind: "retaliation" });
        return actions;
      }
      if (this.state.party.every((member) => !member.alive)) {
        this.emit("enemyPhaseEnded", { amount: actions, effectKind: "retaliation" });
        this.endDefeat("partyDefeated");
        return actions;
      }
      const definition = this.enemyById[enemy.definitionId];
      enemy.attackCountdown = resolution.outcomeKind === "summoned"
        ? Math.max(1, Math.round(this.enemyBehaviorNumber(enemy, "summonCooldown", definition?.attackCountdown ?? 1)))
        : Math.max(1, definition?.attackCountdown ?? 1);
    }
    this.refreshEnemyIntents();
    this.emit("enemyPhaseEnded", { amount: actions, effectKind: "retaliation" });
    return actions;
  }

  private closestLivingPartyMember(position: Vec2): BattlePartyMemberState | undefined {
    return this.state.party.filter((member) => member.alive).sort((left, right) => {
      const leftDistance = (left.position.x - position.x) ** 2 + (left.position.y - position.y) ** 2;
      const rightDistance = (right.position.x - position.x) ** 2 + (right.position.y - position.y) ** 2;
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    })[0];
  }

  private protectedObjectiveTargets(): BattleObjectiveTargetState[] {
    if (this.state.objective.type !== "protect" && this.state.victoryRule.type !== "protectTargets") return [];
    return this.state.objective.targets.filter((target) => target.active && !target.failed && !target.completed);
  }

  private enemySpatialTargets(enemy: BattleEnemyState): EnemySpatialTarget[] {
    const party: EnemySpatialTarget[] = this.state.party.filter((member) => member.alive).map((member) => ({
      id: member.id,
      position: member.position,
      radius: member.radius,
      kind: "party",
    }));
    const objectives: EnemySpatialTarget[] = this.protectedObjectiveTargets().map((target) => ({
      id: target.id,
      position: target.position,
      radius: target.radius,
      kind: "objective",
    }));
    // Protected props deliberately pull aggro. Party placement and temporary
    // walls can still block the path, making "protect" a spatial objective.
    return [...party, ...objectives].sort((left, right) => {
      const leftDistance = Math.hypot(left.position.x - enemy.position.x, left.position.y - enemy.position.y)
        * (left.kind === "objective" ? 0.72 : 1);
      const rightDistance = Math.hypot(right.position.x - enemy.position.x, right.position.y - enemy.position.y)
        * (right.kind === "objective" ? 0.72 : 1);
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    });
  }

  private bossPhaseId(enemy: BattleEnemyState): string | undefined {
    const definition = this.enemyById[enemy.definitionId];
    if (!definition?.boss || !this.stage.boss) return undefined;
    return this.stage.boss.phaseIds[Math.min(this.stage.boss.phaseIds.length - 1, Math.max(0, this.state.stagePhase - 1))];
  }

  private enemyBehaviorValue(
    enemy: BattleEnemyState,
    key: string,
    fallback: number | string | boolean,
  ): number | string | boolean {
    const definition = this.enemyById[enemy.definitionId];
    return definition?.attack.parameters?.[key]
      ?? this.enemyBehaviorById[enemy.behaviorId]?.parameters[key]
      ?? fallback;
  }

  private enemyBehaviorNumber(enemy: BattleEnemyState, key: string, fallback: number): number {
    const value = Number(this.enemyBehaviorValue(enemy, key, fallback));
    return Number.isFinite(value) ? value : fallback;
  }

  private buildEnemyIntent(enemy: BattleEnemyState): BattleEnemyIntentState {
    const definition = this.enemyById[enemy.definitionId];
    const phaseId = this.bossPhaseId(enemy);
    const attackKind = `${definition?.attack.kind ?? enemy.behaviorId}${phaseId ? `:${phaseId}` : ""}`;
    let range = Math.max(0, definition?.attack.range ?? 0);
    if (enemy.behaviorId === "heavy") {
      range = Math.max(range, this.enemyBehaviorNumber(enemy, "shockwaveRadius", range));
    }
    const attackTargets = this.enemySpatialTargets(enemy);
    const nearest = attackTargets[0];
    let intentKind: BattleEnemyIntentKind = "single-target";
    let targets: EnemySpatialTarget[] = nearest ? [nearest] : [];
    let nonPartyTargetId: string | undefined;
    const isEscalatedBoss = Boolean(phaseId && this.state.stagePhase >= 2);
    const effectiveAreaRadius = (): number => range + enemy.radius * (
      definition?.boss ? 1 + (this.state.stagePhase - 1) * 0.15 : 1
    );

    if (enemy.behaviorId === "support" && !isEscalatedBoss) {
      intentKind = "heal";
      const supportRange = Math.max(0, this.enemyBehaviorNumber(enemy, "supportRange", Number.POSITIVE_INFINITY));
      const ally = this.state.enemies.filter((entry) => entry.alive && Math.hypot(
        entry.position.x - enemy.position.x,
        entry.position.y - enemy.position.y,
      ) <= supportRange + entry.radius).sort(
        (left, right) => left.hp / left.maxHp - right.hp / right.maxHp || left.id.localeCompare(right.id),
      )[0];
      nonPartyTargetId = ally?.id;
      targets = [];
    } else if (enemy.behaviorId === "summoner"
      && this.state.enemies.filter((entry) => entry.alive && entry.parentId === enemy.id).length
        < Math.max(1, Math.round(this.enemyBehaviorNumber(enemy, "maximumMinions", 3)))
      && this.state.enemies.filter((entry) => entry.alive).length < 12
      && (!isEscalatedBoss || this.state.completedTurns % 2 === 0)) {
      intentKind = "summon";
      targets = [];
    } else if (enemy.behaviorId === "charger" || (definition?.boss && enemy.behaviorId === "shield" && this.state.stagePhase >= 3)) {
      intentKind = "charge";
    } else if (enemy.behaviorId === "shooter" || (definition?.boss && ["summoner", "support"].includes(enemy.behaviorId))) {
      const inRange = attackTargets.filter((target) => Math.hypot(
        target.position.x - enemy.position.x,
        target.position.y - enemy.position.y,
      ) <= range + target.radius);
      const count = definition?.boss ? Math.min(Math.max(1, this.state.stagePhase), inRange.length) : 1;
      targets = inRange.length > 0 ? inRange.slice(0, count) : (nearest ? [nearest] : []);
      intentKind = inRange.length > 0 ? "ranged" : "move";
    } else if (enemy.behaviorId === "heavy") {
      const radius = effectiveAreaRadius();
      const inRange = attackTargets.filter((target) => Math.hypot(
        target.position.x - enemy.position.x,
        target.position.y - enemy.position.y,
      ) <= radius + target.radius);
      targets = inRange.length > 0 ? inRange : (nearest ? [nearest] : []);
      intentKind = inRange.length > 0 ? "area" : "move";
    } else if (enemy.behaviorId === "splitter") {
      const radius = effectiveAreaRadius();
      targets = attackTargets.filter((target) => Math.hypot(
        target.position.x - enemy.position.x,
        target.position.y - enemy.position.y,
      ) <= radius + target.radius);
      intentKind = "area";
    } else if (enemy.behaviorId === "shield" && nearest && definition) {
      const distance = Math.hypot(nearest.position.x - enemy.position.x, nearest.position.y - enemy.position.y);
      const stoppingDistance = enemy.radius + nearest.radius + 4;
      const travel = Math.min(definition.stats.speed, Math.max(0, distance - stoppingDistance));
      const remainingDistance = Math.max(stoppingDistance, distance - travel);
      intentKind = remainingDistance <= range + enemy.radius + nearest.radius ? "single-target" : "move";
    }

    const effectBlock = this.hasEffect(enemy.id, "stun") ? "stun"
      : this.hasEffect(enemy.id, "bind") ? "bind"
        : undefined;
    const covered = intentKind === "ranged" && targets.length > 0
      && targets.every((target) => !this.traceEnemyProjectile(enemy, target).clear);
    const blockedBy = effectBlock ?? (covered ? "cover" : undefined);
    const targetIds = nonPartyTargetId ? [nonPartyTargetId] : targets.map((target) => target.id);
    const primaryTargetId = targetIds[0];
    const primarySpatialTarget = targets.find((target) => target.id === primaryTargetId);
    const primaryEnemyTarget = nonPartyTargetId
      ? this.state.enemies.find((entry) => entry.id === nonPartyTargetId)
      : undefined;
    const selectedTargetPosition = primarySpatialTarget?.position ?? primaryEnemyTarget?.position;
    const countdown = Math.max(0, Math.round(enemy.attackCountdown));
    const areaRadius = intentKind === "area" ? effectiveAreaRadius() : 0;
    const targetPosition = intentKind === "area" ? enemy.position : selectedTargetPosition;

    return {
      enemyId: enemy.id,
      behaviorId: enemy.behaviorId,
      attackKind,
      intentKind,
      status: blockedBy ? "blocked" : countdown <= 1 ? "ready" : "countdown",
      countdown,
      willActAfterCurrentTurn: countdown <= 1,
      primaryTargetId,
      targetIds,
      origin: { ...enemy.position },
      targetPosition: targetPosition ? { ...targetPosition } : undefined,
      range,
      areaRadius,
      blockedBy,
    };
  }

  /** Enemy target choice is announced during the player turn and then honored. */
  private enemyIntentForResolution(enemy: BattleEnemyState): BattleEnemyIntentState {
    const announced = this.state.enemyIntents.find((entry) => entry.enemyId === enemy.id);
    if (!announced) return this.buildEnemyIntent(enemy);
    const blockedBy = this.announcedIntentBlocker(enemy, announced);
    const countdown = Math.max(0, Math.round(enemy.attackCountdown));
    return {
      ...cloneJson(announced),
      origin: { ...enemy.position },
      targetPosition: announced.intentKind === "area" ? { ...enemy.position } : announced.targetPosition,
      countdown,
      willActAfterCurrentTurn: countdown <= 1,
      status: blockedBy ? "blocked" : countdown <= 1 ? "ready" : "countdown",
      blockedBy,
    };
  }

  private announcedIntentBlocker(
    enemy: BattleEnemyState,
    announced: BattleEnemyIntentState,
  ): BattleEnemyIntentBlockReason | undefined {
    if (this.hasEffect(enemy.id, "stun")) return "stun";
    if (this.hasEffect(enemy.id, "bind")) return "bind";
    if (announced.intentKind !== "ranged") return undefined;
    const announcedTargets = announced.targetIds
      .map((targetId) => this.enemySpatialTargetById(enemy, targetId))
      .filter((target): target is EnemySpatialTarget => Boolean(target));
    // Keep the announced target choice stable, but resolve cover against the
    // authoritative battlefield at the instant the action fires.
    return announcedTargets.length > 0
      && announcedTargets.every((target) => !this.traceEnemyProjectile(enemy, target).clear)
      ? "cover"
      : undefined;
  }

  /** Active skills may change countdowns, control, or cover without retargeting. */
  private refreshAnnouncedIntentStatuses(): void {
    this.state.enemyIntents = this.state.enemyIntents.flatMap((announced) => {
      const enemy = this.state.enemies.find((entry) => entry.id === announced.enemyId && entry.alive);
      if (!enemy) return [];
      const countdown = Math.max(0, Math.round(enemy.attackCountdown));
      const blockedBy = this.announcedIntentBlocker(enemy, announced);
      return [{
        ...cloneJson(announced),
        countdown,
        willActAfterCurrentTurn: countdown <= 1,
        status: blockedBy ? "blocked" as const : countdown <= 1 ? "ready" as const : "countdown" as const,
        blockedBy,
      }];
    });
  }

  private refreshEnemyIntents(): void {
    this.state.enemyIntents = this.state.enemies
      .filter((enemy) => enemy.alive)
      .map((enemy) => this.buildEnemyIntent(enemy));
  }

  private enemyDamageAmount(enemy: BattleEnemyState, definition: EnemyDefinition, multiplier = 1): number {
    const variance = 0.9 + this.nextRandom() * 0.2;
    const levelMultiplier = 1 + Math.max(0, enemy.level - 1) * this.state.config.enemyLevelAttackGrowth;
    const basePower = definition.attack.power > 0 ? definition.attack.power : definition.stats.attack * 0.65;
    const attackDown = clamp(this.effectValue(enemy.id, "wine-slow") / 100, 0, 0.8);
    return Math.max(1, Math.round(
      basePower * multiplier * levelMultiplier
      * (enemy.elite ? this.state.config.eliteAttackMultiplier : 1) * variance * (1 - attackDown),
    ));
  }

  private rawDamageHero(
    source: { readonly id: string },
    target: BattlePartyMemberState,
    amount: number,
    context: EnemyDamageContext,
  ): number {
    if (!target.alive || amount <= 0) return 0;
    const guardValue = this.effectValue(target.id, "projectile-guard");
    const guardReduction = guardValue > 0 ? (guardValue <= 1 ? 0.35 : clamp(guardValue / 100, 0, 0.75)) : 0;
    const stationaryReduction = context.sourceKind === "enemyAttack" && target.id !== this.activePartyMember().id
      ? clamp(this.relicValue("stationary-guard") / 100, 0, 0.75)
      : 0;
    const whirlpoolReduction = context.sourceKind === "hazard" && context.attackKind === "whirlpool"
      ? clamp(this.relicValue("whirlpool-resistance") / 100, 0, 1)
      : 0;
    const combinedReduction = 1
      - (1 - guardReduction) * (1 - stationaryReduction) * (1 - whirlpoolReduction);
    const applied = Math.max(1, Math.round(amount * (1 - combinedReduction)));
    const hpBefore = target.hp;
    target.hp = Math.max(0, target.hp - applied);
    this.emit("heroDamaged", {
      actionId: context.actionId,
      sourceKind: context.sourceKind,
      actorId: source.id,
      targetId: target.id,
      targetIds: [target.id],
      targetPosition: target.position,
      amount: applied,
      hpBefore,
      hpAfter: target.hp,
      mitigatedAmount: Math.max(0, amount - applied),
      position: target.position,
      attackKind: context.attackKind,
      intentKind: context.intentKind,
      outcomeKind: "hit",
      effectKind: context.effectKind,
    });
    if (target.hp > 0) return applied;
    const revivePercent = Math.max(0, this.relicValue("route-revive", "max"));
    if (revivePercent > 0 && !this.relicEffectUsed("route-revive")) {
      this.markRelicEffectUsed("route-revive");
      target.hp = Math.max(1, Math.round(target.maxHp * Math.min(100, revivePercent) / 100));
      target.alive = true;
      this.emit("statusEffectApplied", {
        actorId: target.id,
        targetId: target.id,
        effectKind: "relic-route-revive",
        amount: target.hp,
        duration: 1,
      });
      return applied;
    }
    target.alive = false;
    this.emit("heroDefeated", {
      actionId: context.actionId,
      sourceKind: context.sourceKind,
      actorId: source.id,
      targetId: target.id,
      targetIds: [target.id],
      targetPosition: target.position,
      position: target.position,
      attackKind: context.attackKind,
      intentKind: context.intentKind,
      effectKind: context.effectKind,
    });
    this.ensureFatherSonCoreAccessible();
    return applied;
  }

  private damageHero(
    source: { readonly id: string },
    target: BattlePartyMemberState,
    amount: number,
    context: EnemyDamageContext,
  ): number {
    const redirectValue = this.effectValue(target.id, "damage-redirect");
    const redirectTarget = redirectValue > 0
      ? this.state.party.filter((member) => member.alive && member.id !== target.id).sort((left, right) => right.hp - left.hp)[0]
      : undefined;
    if (!redirectTarget) {
      return this.rawDamageHero(source, target, amount, context) ?? 0;
    }
    const redirected = Math.max(1, Math.round(amount * clamp(redirectValue / 100, 0, 0.8)));
    const primaryDamage = this.rawDamageHero(source, target, Math.max(1, amount - redirected), context) ?? 0;
    const redirectedDamage = this.rawDamageHero(source, redirectTarget, redirected, {
      ...context,
      effectKind: "damage-redirect",
    }) ?? 0;
    return primaryDamage + redirectedDamage;
  }

  private moveEnemyToward(
    enemy: BattleEnemyState,
    target: EnemySpatialTarget,
    maximumDistance: number,
    behavior: string,
    actionId?: string,
    maxBounces = 0,
  ): number {
    const offset = vec2(target.position.x - enemy.position.x, target.position.y - enemy.position.y);
    const distance = Math.hypot(offset.x, offset.y);
    if (distance <= STEP_EPSILON) return 0;
    const direction = normalize(offset);
    enemy.facing = direction;
    if (enemy.behaviorId === "shield" && this.hasModifier("formation", "shieldFormationSharesFacing")) {
      for (const ally of this.state.enemies.filter((entry) => entry.alive && entry.behaviorId === "shield")) {
        ally.facing = { ...direction };
      }
      this.triggerModifier("shieldFormationSharesFacing", { actorId: enemy.id, targetId: target.id }, 1);
    }
    const traced = this.traceEnemyTravel(enemy, target, maximumDistance, maxBounces);
    const travel = traced.distance;
    if (travel <= 0) return distance;
    this.setEnemyPosition(enemy, traced.position);
    this.emit("enemyMoved", {
      actionId,
      actorId: enemy.id,
      targetId: target.id,
      targetIds: [target.id],
      targetPosition: target.position,
      amount: travel,
      position: enemy.position,
      effectKind: behavior,
      path: traced.path.map((point) => ({ ...point })),
    });
    if (traced.blockedBy) {
      this.emit("enemyProjectileBlocked", {
        actionId,
        actorId: enemy.id,
        targetId: target.id,
        targetPosition: target.position,
        position: enemy.position,
        effectKind: traced.blockedBy,
        intentKind: "move",
        outcomeKind: "blocked",
      });
    }
    return Math.hypot(target.position.x - enemy.position.x, target.position.y - enemy.position.y);
  }

  private setEnemyPosition(enemy: BattleEnemyState, position: Vec2): void {
    const delta = vec2(position.x - enemy.position.x, position.y - enemy.position.y);
    enemy.position = { ...position };
    if (Math.abs(delta.x) <= STEP_EPSILON && Math.abs(delta.y) <= STEP_EPSILON) return;
    for (const weakpoint of enemy.weakpoints) {
      weakpoint.position = add(weakpoint.position, delta);
      for (const target of this.state.objective.targets.filter(
        (entry) => entry.id === weakpoint.id || entry.sourceId === weakpoint.partId,
      )) {
        target.position = { ...weakpoint.position };
      }
    }
  }

  private summonDefinitionFor(definition: EnemyDefinition): EnemyDefinition | undefined {
    return firstAvailableNonBossEnemy(
      summonCandidateIdsForAttackKind(definition.attack.kind),
      this.enemyById,
    );
  }

  private summonMinion(
    enemy: BattleEnemyState,
    definition: EnemyDefinition,
    actionId?: string,
  ): BattleEnemyState | undefined {
    const maximumMinions = Math.max(1, Math.round(this.enemyBehaviorNumber(enemy, "maximumMinions", 3)));
    if (
      this.state.enemies.filter((entry) => entry.alive && entry.parentId === enemy.id).length >= maximumMinions
      || this.state.enemies.filter((entry) => entry.alive).length >= 12
    ) return undefined;
    const minionDefinition = this.summonDefinitionFor(definition);
    if (!minionDefinition) return undefined;
    enemy.summonCount += 1;
    const angle = (enemy.summonCount * 2.399963229728653) % (Math.PI * 2);
    const offset = enemy.radius + minionDefinition.radius + 14;
    const position = vec2(
      clamp(enemy.position.x + Math.cos(angle) * offset, minionDefinition.radius, this.stage.arena.width - minionDefinition.radius),
      clamp(enemy.position.y + Math.sin(angle) * offset, minionDefinition.radius, this.stage.arena.height - minionDefinition.radius),
    );
    const id = `${enemy.id}:summon:${enemy.summonCount}`;
    const minion = this.createReinforcementState(
      minionDefinition,
      id,
      position,
      enemy.level,
      enemy.id,
      enemy.generation + 1,
      0.72,
      0.88,
    );
    this.state.enemies.push(minion);
    this.emit("enemySpawned", {
      actionId,
      actorId: enemy.id,
      targetId: minion.id,
      targetIds: [minion.id],
      targetPosition: minion.position,
      position: minion.position,
      effectKind: "summoner",
    });
    this.refreshObjectiveProgress(minion.id, minion.position);
    return minion;
  }

  private enemySpatialTargetById(enemy: BattleEnemyState, id: string | undefined): EnemySpatialTarget | undefined {
    if (!id) return undefined;
    return this.enemySpatialTargets(enemy).find((target) => target.id === id);
  }

  private damageProtectedObjective(
    enemy: BattleEnemyState,
    target: BattleObjectiveTargetState,
    amount: number,
    context: EnemyDamageContext,
  ): number {
    if (!target.active || target.failed || amount <= 0) return 0;
    const hpBefore = target.hp;
    target.hp = Math.max(0, target.hp - Math.max(1, Math.round(amount)));
    const applied = hpBefore - target.hp;
    this.emit("objectiveTargetDamaged", {
      actionId: context.actionId,
      sourceKind: context.sourceKind,
      actorId: enemy.id,
      targetId: target.id,
      targetIds: [target.id],
      targetPosition: target.position,
      position: target.position,
      amount: applied,
      hpBefore,
      hpAfter: target.hp,
      attackKind: context.attackKind,
      intentKind: context.intentKind,
      outcomeKind: "hit",
      effectKind: context.effectKind,
    });
    this.setPropState(target, target.hp > 0 ? "protected" : "failed", context.actionId);
    if (target.hp <= 0) {
      target.failed = true;
      target.active = false;
      this.failObjective(target.id, target.position);
    }
    return applied;
  }

  private damageEnemySpatialTarget(
    enemy: BattleEnemyState,
    target: EnemySpatialTarget,
    amount: number,
    context: EnemyDamageContext,
  ): number {
    if (target.kind === "party") {
      const member = this.state.party.find((entry) => entry.id === target.id && entry.alive);
      return member ? this.damageHero(enemy, member, amount, context) : 0;
    }
    const objective = this.state.objective.targets.find((entry) => entry.id === target.id);
    return objective ? this.damageProtectedObjective(enemy, objective, amount, context) : 0;
  }

  private enemyAttack(
    enemy: BattleEnemyState,
    actionId: string,
    intent: BattleEnemyIntentState,
  ): EnemyActionResolution {
    const definition = this.enemyById[enemy.definitionId];
    if (!definition) return { outcomeKind: "noTarget", targetIds: [] };
    if (this.state.party.every((member) => !member.alive)) return { outcomeKind: "noTarget", targetIds: [] };
    const spatialTargets = this.enemySpatialTargets(enemy);
    const announcedTarget = this.enemySpatialTargetById(enemy, intent.primaryTargetId);
    const nearest = announcedTarget ?? spatialTargets[0];
    if (!nearest && intent.intentKind !== "heal" && intent.intentKind !== "summon") {
      return { outcomeKind: "noTarget", targetIds: [] };
    }
    const damageContext: EnemyDamageContext = {
      actionId,
      sourceKind: "enemyAttack",
      attackKind: intent.attackKind,
      intentKind: intent.intentKind,
      effectKind: this.bossPhaseId(enemy) ?? enemy.behaviorId,
    };
    const dealDamage = (target: EnemySpatialTarget, amount: number, duration?: number): number => {
      this.emit("enemyAttack", {
        actionId,
        sourceKind: "enemyAttack",
        actorId: enemy.id,
        targetId: target.id,
        targetIds: [target.id],
        targetPosition: target.position,
        amount,
        position: enemy.position,
        attackKind: intent.attackKind,
        intentKind: intent.intentKind,
        outcomeKind: "hit",
        effectKind: enemy.behaviorId,
        range: intent.range,
        areaRadius: intent.areaRadius,
        duration,
      });
      return this.damageEnemySpatialTarget(enemy, target, amount, damageContext);
    };
    this.emit("enemyBehavior", {
      actionId,
      actorId: enemy.id,
      targetId: intent.primaryTargetId ?? nearest?.id,
      targetIds: intent.targetIds,
      targetPosition: intent.targetPosition,
      position: enemy.position,
      effectKind: enemy.behaviorId,
      attackKind: intent.attackKind,
      intentKind: intent.intentKind,
      range: intent.range,
      areaRadius: intent.areaRadius,
    });

    if (intent.intentKind === "heal") {
      const supportRange = Math.max(0, this.enemyBehaviorNumber(enemy, "supportRange", Number.POSITIVE_INFINITY));
      const availableAllies = this.state.enemies.filter((entry) => entry.alive && Math.hypot(
        entry.position.x - enemy.position.x,
        entry.position.y - enemy.position.y,
      ) <= supportRange + entry.radius);
      const ally = availableAllies.find((entry) => entry.id === intent.primaryTargetId) ?? availableAllies.sort(
        (left, right) => left.hp / left.maxHp - right.hp / right.maxHp,
      )[0];
      let healedAmount = 0;
      if (ally) {
        const healRatio = Math.max(0, this.enemyBehaviorNumber(enemy, "healRatio", 0));
        const amount = Math.max(1, Math.round(healRatio > 0
          ? ally.maxHp * healRatio
          : definition.attack.power || definition.stats.attack * 0.8));
        const before = ally.hp;
        ally.hp = Math.min(ally.maxHp, ally.hp + amount);
        healedAmount = ally.hp - before;
        this.emit("enemyHealed", {
          actionId,
          actorId: enemy.id,
          targetId: ally.id,
          targetIds: [ally.id],
          targetPosition: ally.position,
          amount: healedAmount,
          hpBefore: before,
          hpAfter: ally.hp,
          position: ally.position,
          effectKind: "support",
          attackKind: intent.attackKind,
          intentKind: "heal",
          outcomeKind: "healed",
        });
      }
      const hasteTurns = Math.max(0, Math.round(this.enemyBehaviorNumber(enemy, "hasteTurns", 1)));
      for (const allyEnemy of this.state.enemies.filter((entry) => entry.alive && entry.id !== enemy.id && Math.hypot(
        entry.position.x - enemy.position.x,
        entry.position.y - enemy.position.y,
      ) <= supportRange + entry.radius)) {
        allyEnemy.attackCountdown = Math.max(1, allyEnemy.attackCountdown - hasteTurns);
      }
      return ally
        ? { outcomeKind: "healed", targetIds: [ally.id], amount: healedAmount }
        : { outcomeKind: "noTarget", targetIds: [] };
    }

    if (intent.intentKind === "summon") {
      const requested = Math.max(1, Math.round(this.enemyBehaviorNumber(enemy, "summonCount", 1)));
      const summoned: BattleEnemyState[] = [];
      for (let index = 0; index < requested; index += 1) {
        const minion = this.summonMinion(enemy, definition, actionId);
        if (!minion) break;
        summoned.push(minion);
      }
      if (summoned.length > 0) return { outcomeKind: "summoned", targetIds: summoned.map((entry) => entry.id) };
      // The player was shown a summon intent. If another summoner fills the
      // shared cap first, never replace that announced action with surprise
      // damage; the failed summon simply spends this enemy action.
      return { outcomeKind: "blocked", targetIds: [] };
    }

    if (intent.intentKind === "charge") {
      if (!nearest) return { outcomeKind: "noTarget", targetIds: [] };
      const distance = this.moveEnemyToward(
        enemy,
        nearest,
        Math.max(
          definition.stats.speed * 2.2,
          definition.attack.range * 0.65,
          this.enemyBehaviorNumber(enemy, "baseSpeed", 0),
        ),
        this.bossPhaseId(enemy) ?? "charger",
        actionId,
        Math.max(0, Math.round(this.enemyBehaviorNumber(enemy, "maxBounces", 0))),
      );
      if (distance <= definition.attack.range + enemy.radius + nearest.radius) {
        const strikePath = this.traceEnemyProjectile(enemy, nearest);
        if (!strikePath.clear) {
          this.damageTemporaryWall(
            strikePath.blockedBy,
            this.enemyDamageAmount(enemy, definition),
            strikePath.impact,
          );
          return { outcomeKind: "blocked", targetIds: [nearest.id] };
        }
        const amount = this.enemyDamageAmount(enemy, definition, definition.boss ? 1.08 + this.state.stagePhase * 0.06 : 1.08);
        const applied = dealDamage(nearest, amount, strikePath.duration);
        const knockback = Math.max(0, this.enemyBehaviorNumber(enemy, "contactKnockback", 0));
        if (knockback > 0 && nearest.kind === "party") {
          const member = this.state.party.find((entry) => entry.id === nearest.id && entry.alive);
          if (member) {
            const direction = normalize(vec2(member.position.x - enemy.position.x, member.position.y - enemy.position.y), enemy.facing);
            member.position = vec2(
              clamp(member.position.x + direction.x * knockback, member.radius, this.stage.arena.width - member.radius),
              clamp(member.position.y + direction.y * knockback, member.radius, this.stage.arena.height - member.radius),
            );
            this.emit("statusEffectApplied", {
              actorId: enemy.id,
              targetId: member.id,
              position: member.position,
              effectKind: "charger-knockback",
              amount: knockback,
              duration: 0,
            });
          }
        }
        return { outcomeKind: "hit", targetIds: [nearest.id], amount: applied };
      }
      return { outcomeKind: "moved", targetIds: [nearest.id] };
    }

    if (intent.intentKind === "ranged") {
      const targets = intent.targetIds
        .map((id) => this.enemySpatialTargetById(enemy, id))
        .filter((target): target is EnemySpatialTarget => Boolean(target));
      if (targets.length === 0) {
        if (!nearest) return { outcomeKind: "noTarget", targetIds: [] };
        this.moveEnemyToward(enemy, nearest, definition.stats.speed, "shooter-reposition", actionId);
        return { outcomeKind: "moved", targetIds: [nearest.id] };
      }
      let totalDamage = 0;
      const hitIds: string[] = [];
      for (const target of targets) {
        enemy.facing = normalize(vec2(target.position.x - enemy.position.x, target.position.y - enemy.position.y));
        const shot = this.traceEnemyProjectile(enemy, target);
        if (!shot.clear) {
          this.damageTemporaryWall(
            shot.blockedBy,
            this.enemyDamageAmount(enemy, definition),
            shot.impact,
          );
          this.emit("enemyProjectileBlocked", {
            actionId,
            actorId: enemy.id,
            targetId: target.id,
            targetIds: [target.id],
            targetPosition: target.position,
            position: shot.impact,
            attackKind: intent.attackKind,
            intentKind: "ranged",
            outcomeKind: "blocked",
            effectKind: shot.blockedBy,
          });
          continue;
        }
        const multiplier = definition.boss ? 0.82 + this.state.stagePhase * 0.08 : 1;
        totalDamage += dealDamage(target, this.enemyDamageAmount(enemy, definition, multiplier), shot.duration);
        hitIds.push(target.id);
      }
      return hitIds.length > 0
        ? { outcomeKind: "hit", targetIds: hitIds, amount: totalDamage }
        : { outcomeKind: "blocked", targetIds: targets.map((target) => target.id) };
    }

    if (intent.intentKind === "area") {
      const radius = Math.max(0, intent.areaRadius);
      const targets = this.enemySpatialTargets(enemy).filter((target) => Math.hypot(
        target.position.x - enemy.position.x,
        target.position.y - enemy.position.y,
      ) <= radius + target.radius);
      let totalDamage = 0;
      for (const target of targets) {
        const phasePower = definition.boss ? 1 + (this.state.stagePhase - 1) * 0.12 : 1;
        const amount = this.enemyDamageAmount(enemy, definition, (targets.length > 1 ? 0.86 : 1.15) * phasePower);
        totalDamage += dealDamage(target, amount);
      }
      return targets.length > 0
        ? { outcomeKind: "hit", targetIds: targets.map((target) => target.id), amount: totalDamage }
        : { outcomeKind: "noTarget", targetIds: [] };
    }

    // Shield units advance slowly, turn their protected front toward the
    // target, and only bash at authored melee range.
    if (!nearest) return { outcomeKind: "noTarget", targetIds: [] };
    const movementKind = enemy.behaviorId === "shooter" ? "shooter-reposition" : enemy.behaviorId;
    const distance = this.moveEnemyToward(enemy, nearest, definition.stats.speed, movementKind, actionId);
    if (distance <= definition.attack.range + enemy.radius + nearest.radius) {
      const strikePath = this.traceEnemyProjectile(enemy, nearest);
      if (!strikePath.clear) {
        this.damageTemporaryWall(
          strikePath.blockedBy,
          this.enemyDamageAmount(enemy, definition),
          strikePath.impact,
        );
        return { outcomeKind: "blocked", targetIds: [nearest.id] };
      }
      const amount = this.enemyDamageAmount(enemy, definition);
      return { outcomeKind: "hit", targetIds: [nearest.id], amount: dealDamage(nearest, amount) };
    }
    return { outcomeKind: "moved", targetIds: [nearest.id] };
  }

  private advancePartyTurn(): void {
    const count = this.state.party.length;
    for (let offset = 1; offset <= count; offset += 1) {
      const index = (this.state.activePartyIndex + offset) % count;
      if (!this.state.party[index]?.alive) continue;
      this.state.activePartyIndex = index;
      this.state.turnNumber += 1;
      this.state.phase = "awaitingAim";
      this.state.aim = null;
      this.applyRelicRegeneration();
      this.emit("turnStarted", { actorId: this.state.party[index]!.id });
      return;
    }
    this.endDefeat("partyDefeated");
  }

  private applyRelicRegeneration(): void {
    const amount = Math.max(0, Math.round(this.relicValue("regeneration")));
    if (amount <= 0) return;
    const target = this.state.party.filter((member) => member.alive).sort(
      (left, right) => left.hp / left.maxHp - right.hp / right.maxHp || left.id.localeCompare(right.id),
    )[0];
    if (!target || target.hp >= target.maxHp) return;
    const hpBefore = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    this.emit("statusEffectApplied", {
      actorId: this.relicEffect("regeneration")?.sourceId ?? "relic",
      targetId: target.id,
      position: target.position,
      effectKind: "relic-regeneration",
      amount: target.hp - hpBefore,
      hpBefore,
      hpAfter: target.hp,
      duration: 1,
    });
  }

  private endDefeat(reason: Extract<BattleOutcomeReason, "partyDefeated" | "objectiveFailed" | "turnLimit">): void {
    if (this.state.phase === "victory" || this.state.phase === "defeat") return;
    this.state.phase = "defeat";
    this.state.projectile = null;
    this.state.fixedAccumulator = 0;
    this.state.outcome = { victory: false, reason, turnNumber: this.state.turnNumber };
    this.emit("defeat", { reason });
  }

  private emit(
    type: BattleEventType,
    detail: Partial<Omit<BattleEvent, "sequence" | "type" | "battleTime" | "turnNumber">> = {},
  ): void {
    this.state.eventSequence += 1;
    this.events.push({
      sequence: this.state.eventSequence,
      type,
      battleTime: this.state.battleTime,
      turnNumber: this.state.turnNumber,
      ...cloneJson(detail),
    });
  }
}

export function createBattleRuntime(setup: BattleSetup): BattleRuntime {
  return new BattleRuntime(setup);
}

export function restoreBattleRuntime(setup: BattleSetup, snapshot: BattleSnapshot | string): BattleRuntime {
  return new BattleRuntime(setup, typeof snapshot === "string" ? parseBattleSnapshot(snapshot) : snapshot);
}
