import type { EnemyBehaviorDefinition, EnemyDefinition, HeroDefinition, StageDefinition } from "../../data/types";
import type { CollisionResponse, TraceTermination, Vec2 } from "../../simulation";
import type { StageModifierCategory, StageModifierParameter } from "./stageModifiers";

export const BATTLE_SNAPSHOT_VERSION = 1 as const;

export type BattlePhase =
  | "awaitingAim"
  | "aiming"
  | "projectile"
  | "retaliation"
  | "victory"
  | "defeat";

export type BattleActionBlockReason = "stun";

/** Render-safe explanation for why the current hero can or cannot act. */
export interface BattleActionAvailability {
  actorId: string;
  allowed: boolean;
  reason?: BattleActionBlockReason;
}

export type BattleOutcomeReason =
  | "allEnemiesDefeated"
  | "weakpointsBroken"
  | "targetsCompleted"
  | "protected"
  | "sealed"
  | "escaped"
  | "survived"
  | "partyDefeated"
  | "objectiveFailed"
  | "turnLimit";

export interface AimCommand {
  readonly direction: Vec2;
  /** Normalized pull strength in [0, 1]. */
  readonly power: number;
}

export interface AimState {
  direction: Vec2;
  power: number;
}

export interface BattleRuntimeConfig {
  /** Authoritative simulation quantum in seconds. */
  fixedStep: number;
  maxAdvanceSteps: number;
  maxProjectileDuration: number;
  maxBounces: number;
  maxCollisions: number;
  minLaunchSpeed: number;
  maxLaunchSpeed: number;
  minProjectileSpeed: number;
  defaultFriction: number;
  enemyHitCooldown: number;
  weakpointHitCooldown: number;
  allyHitCooldown: number;
  damageVariance: number;
  criticalChance: number;
  criticalMultiplier: number;
  enemyLevelHpGrowth: number;
  enemyLevelAttackGrowth: number;
  eliteHpMultiplier: number;
  eliteAttackMultiplier: number;
  weakpointHpRatio: number;
  weakpointDamageMultiplier: number;
  /** Endgame/runtime variants may override an authored reinforcement due turn. */
  reinforcementTurnOverride?: number;
}

export type BattleVictoryRule =
  | { readonly type: "defeatAll" }
  | { readonly type: "breakWeakpoints"; readonly required: number }
  | { readonly type: "surviveTurns"; readonly turns: number }
  | {
    readonly type: "completeTargets";
    readonly objectiveType: "break-parts" | "assemble" | "protect" | "seal" | "escape";
    readonly required: number;
    readonly targetIds: readonly string[];
  }
  | { readonly type: "protectTargets"; readonly required: number; readonly turns: number; readonly targetIds: readonly string[] };

export interface BattleWeakpointSetup {
  readonly id: string;
  readonly enemyInstanceId: string;
  readonly partId?: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly maxHp?: number;
  readonly damageMultiplier?: number;
  readonly breakable?: boolean;
}

export interface BattleSetup {
  readonly stage: StageDefinition;
  readonly party: readonly HeroDefinition[];
  readonly enemyCatalog: Readonly<Record<string, EnemyDefinition>>;
  /** Optional authored behavior parameters. Omitting this keeps custom/UGC setups compatible. */
  readonly enemyBehaviorCatalog?: Readonly<Record<string, EnemyBehaviorDefinition>>;
  readonly seed: number | string;
  readonly config?: Partial<BattleRuntimeConfig>;
  readonly victoryRule?: BattleVictoryRule;
  readonly partyPositions?: readonly Vec2[];
  readonly weakpoints?: readonly BattleWeakpointSetup[];
}

export interface BattlePartyMemberState {
  id: string;
  definitionId: string;
  hp: number;
  maxHp: number;
  position: Vec2;
  radius: number;
  alive: boolean;
  activeSkill: BattleActiveSkillChargeState;
}

export interface BattleActiveSkillChargeState {
  charge: number;
  requiredCharge: number;
  ready: boolean;
  uses: number;
}

export interface BattleWeakpointState {
  id: string;
  partId: string;
  enemyInstanceId: string;
  hp: number;
  maxHp: number;
  position: Vec2;
  radius: number;
  /** Authored boss-part geometry used by the authoritative sweep test. */
  collider: "circle" | "capsule" | "polygon";
  /** Capsule half-length or polygon half-width, in arena units. */
  halfExtent: number;
  /** World-space orientation in radians. */
  rotation: number;
  damageMultiplier: number;
  breakable: boolean;
  broken: boolean;
}

export interface BattleEnemyState {
  id: string;
  definitionId: string;
  spawnId: string;
  level: number;
  elite: boolean;
  hp: number;
  maxHp: number;
  position: Vec2;
  radius: number;
  behaviorId: EnemyDefinition["behaviorId"];
  facing: Vec2;
  generation: number;
  parentId?: string;
  splitUsed: boolean;
  summonCount: number;
  attackCountdown: number;
  alive: boolean;
  weakpoints: BattleWeakpointState[];
}

/**
 * A render-safe description of what an enemy is currently preparing to do.
 *
 * Unlike the short-lived event queue, intents remain available in every
 * snapshot. Presentation layers can therefore draw countdowns and target
 * markers immediately after loading/restoring a battle without guessing from
 * `behaviorId` or consuming simulation RNG to predict damage.
 */
export type BattleEnemyIntentKind =
  | "single-target"
  | "area"
  | "charge"
  | "ranged"
  | "heal"
  | "summon"
  | "move"
  | "disabled";

export type BattleEnemyIntentBlockReason = "bind" | "stun" | "cover";
export type BattleEnemyIntentStatus = "countdown" | "ready" | "blocked";

export interface BattleEnemyIntentState {
  enemyId: string;
  behaviorId: BattleEnemyState["behaviorId"];
  attackKind: string;
  intentKind: BattleEnemyIntentKind;
  status: BattleEnemyIntentStatus;
  /** Number of completed party turns before this action resolves. */
  countdown: number;
  /** True when the action will resolve after the current party turn. */
  willActAfterCurrentTurn: boolean;
  primaryTargetId?: string;
  targetIds: string[];
  origin: Vec2;
  targetPosition?: Vec2;
  range: number;
  /** Effective radius for area attacks; zero for non-area intents. */
  areaRadius: number;
  blockedBy?: BattleEnemyIntentBlockReason;
}

export type BattleObjectiveTargetKind = "prop" | "bossPart" | "exit" | "party";

/** Runtime representation of an objective target. `sourceId` is the id declared in stages.json. */
export interface BattleObjectiveTargetState {
  id: string;
  sourceId: string;
  kind: BattleObjectiveTargetKind;
  position: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  hitCount: number;
  active: boolean;
  completed: boolean;
  failed: boolean;
}

export interface BattleObjectiveProgressState {
  type: StageDefinition["objective"]["type"];
  current: number;
  required: number;
  turnLimit: number;
  completed: boolean;
  failed: boolean;
  targetIds: string[];
  targets: BattleObjectiveTargetState[];
}

export interface BattlePropState {
  id: string;
  origin: Vec2;
  position: Vec2;
  destination?: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  active: boolean;
  state: "idle" | "awakened" | "broken" | "protected" | "failed";
  /** Semantic presentation state resolved from authored interaction progress. */
  visualState: string;
  interactionMode?: "destructible" | "assembly" | "bond";
  progress: number;
  requiredProgress: number;
}

export interface BattleHazardState {
  id: string;
  type: StageDefinition["hazards"][number]["type"];
  origin: Vec2;
  position: Vec2;
  radius: number;
  active: boolean;
  phase: number;
  remainingTurns?: number;
  spawnedBy?: string;
  parameters: Record<string, number | string | boolean>;
}

export interface BattleWallState {
  id: string;
  hp: number;
  maxHp: number;
  breakable: boolean;
  broken: boolean;
  active: boolean;
  offset: Vec2;
  rotation: number;
}

export interface BattleStageModifierState {
  id: string;
  source: string;
  key: string;
  category: StageModifierCategory;
  flag: string;
  parameter?: StageModifierParameter;
  active: boolean;
  triggerCount: number;
  value: number;
  lastTurn: number;
}

export interface BattleStatusEffectState {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  value: number;
  remainingTurns: number;
  /** Turn sequence when applied; legacy snapshots may omit it. */
  appliedTurn?: number;
  /** Contact effects skip the applying turn and expire after the target's next turn. */
  deferUntilNextTurn?: boolean;
}

export type TrajectoryTargetKind = "wall" | "enemy" | "weakpoint" | "ally" | "objective" | "hazard" | "other";

export interface BattleTrajectorySegment {
  from: Vec2;
  to: Vec2;
  velocity: Vec2;
  startTime: number;
  endTime: number;
  collisionIds: string[];
}

export interface BattleTrajectoryContact {
  colliderId: string;
  targetKind: TrajectoryTargetKind;
  targetId: string;
  position: Vec2;
  contactPoint: Vec2;
  normal: Vec2;
  elapsedTime: number;
  response: CollisionResponse;
  hitAccepted: boolean;
  bounceIndex: number;
  simultaneous: boolean;
}

export interface BattleTrajectory {
  start: Vec2;
  initialVelocity: Vec2;
  finalPosition: Vec2;
  finalVelocity: Vec2;
  totalDuration: number;
  traceTermination: TraceTermination;
  bounceCount: number;
  points: Vec2[];
  segments: BattleTrajectorySegment[];
  contacts: BattleTrajectoryContact[];
}

export interface BattleProjectileState {
  actorId: string;
  elapsed: number;
  contactIndex: number;
  lastBounceIndex: number;
  position: Vec2;
  velocity: Vec2;
  trajectory: BattleTrajectory;
  teleportDestination?: Vec2;
  /** A friendship pair can trigger at most once during one launch. */
  friendshipTriggerKeys: string[];
  /** Assembly pieces may advance at most once during one launch. */
  objectiveContactIds: string[];
  /** Used by spatial follow-up friendship skills. */
  lastHitEnemyId?: string;
  /** Primary enemy/weakpoint contacts, excluding relic-created follow-up hits. */
  relicDamageContacts?: number;
  /** Weakpoint-only streak used by precision-chain relics. */
  precisionChain?: number;
  /** Pass-through contacts that already received a retained-speed boost. */
  pierceBoostContactIds?: string[];
  /** Hazards entered during this launch and exits already rewarded. */
  enteredHazardIds?: string[];
  rewardedHazardExitIds?: string[];
}

export interface BattleRngState {
  state: number;
  draws: number;
}

export interface BattleOutcome {
  victory: boolean;
  reason: BattleOutcomeReason;
  turnNumber: number;
}

export interface BattleSnapshot {
  snapshotVersion: typeof BATTLE_SNAPSHOT_VERSION;
  stageId: string;
  seed: number | string;
  config: BattleRuntimeConfig;
  victoryRule: BattleVictoryRule;
  phase: BattlePhase;
  battleTime: number;
  fixedAccumulator: number;
  turnNumber: number;
  completedTurns: number;
  /** Paid defeat rescue may extend only the ordinary stage turn deadline. */
  rescueTurnLimitBonus: number;
  activePartyIndex: number;
  party: BattlePartyMemberState[];
  enemies: BattleEnemyState[];
  enemyIntents: BattleEnemyIntentState[];
  objective: BattleObjectiveProgressState;
  props: BattlePropState[];
  hazards: BattleHazardState[];
  walls: BattleWallState[];
  effects: BattleStatusEffectState[];
  modifiers: BattleStageModifierState[];
  stagePhase: number;
  aim: AimState | null;
  projectile: BattleProjectileState | null;
  comboCount: number;
  bestCombo: number;
  ricochetCount: number;
  totalHits: number;
  rng: BattleRngState;
  eventSequence: number;
  outcome: BattleOutcome | null;
}

export type BattleEventType =
  | "battleStarted"
  | "turnStarted"
  | "aimChanged"
  | "aimCleared"
  | "launched"
  | "ricochet"
  | "allyContact"
  | "allySkillTriggered"
  | "allyLaunched"
  | "activeSkillCharged"
  | "activeSkillReady"
  | "activeSkillActivated"
  | "activeSkillEffect"
  | "statusEffectApplied"
  | "enemyHit"
  | "weakpointHit"
  | "weakpointBroken"
  | "enemyDefeated"
  | "enemyPhaseStarted"
  | "enemyPhaseEnded"
  | "enemyTelegraph"
  | "enemyActionStarted"
  | "enemyActionResolved"
  | "enemyProjectileBlocked"
  | "enemyMoved"
  | "enemyHealed"
  | "enemySpawned"
  | "enemyBehavior"
  | "objectiveTargetHit"
  | "objectiveTargetDamaged"
  | "objectiveProgressed"
  | "objectiveCompleted"
  | "objectiveFailed"
  | "propStateChanged"
  | "hazardMoved"
  | "hazardTriggered"
  | "hazardWarning"
  | "wallMoved"
  | "wallDamaged"
  | "wallBroken"
  | "modifierTriggered"
  | "stagePhaseChanged"
  | "sequenceReset"
  | "formationChanged"
  | "heroActionBlocked"
  | "turnEnded"
  | "enemyAttack"
  | "heroDamaged"
  | "heroDefeated"
  | "victory"
  | "defeat";

export type BattleEventSourceKind = "enemyAttack" | "hazard" | "status" | "objective";

export type BattleEnemyActionOutcome =
  | "hit"
  | "moved"
  | "healed"
  | "summoned"
  | "blocked"
  | "noTarget";

/** Events are deliberately JSON-safe so render/audio layers can queue or replay them. */
export interface BattleEvent {
  sequence: number;
  type: BattleEventType;
  battleTime: number;
  turnNumber: number;
  actorId?: string;
  targetId?: string;
  /** Stable id shared by every event produced by one enemy action. */
  actionId?: string;
  sourceKind?: BattleEventSourceKind;
  attackKind?: string;
  intentKind?: BattleEnemyIntentKind;
  outcomeKind?: BattleEnemyActionOutcome;
  targetIds?: string[];
  targetPosition?: Vec2;
  range?: number;
  areaRadius?: number;
  amount?: number;
  hpBefore?: number;
  hpAfter?: number;
  mitigatedAmount?: number;
  critical?: boolean;
  /** Contact truth used by presentation to distinguish a graze from a crushing hit. */
  impactGrade?: "glancing" | "solid" | "crushing";
  speedRatio?: number;
  incidence?: number;
  damageMultiplier?: number;
  damageCapped?: boolean;
  path?: Vec2[];
  position?: Vec2;
  offset?: Vec2;
  rotation?: number;
  active?: boolean;
  combo?: number;
  ricochets?: number;
  reason?: BattleOutcomeReason;
  skillId?: string;
  skillName?: string;
  effectKind?: string;
  current?: number;
  required?: number;
  duration?: number;
}

export interface BattleLaunchPreview {
  actorId: string;
  aim: AimState;
  trajectory: BattleTrajectory;
}

export interface BattleActiveSkillCommand {
  actorId?: string;
  targetId?: string;
  position?: Vec2;
  secondaryPosition?: Vec2;
}

export interface BattleActiveSkillPreview {
  actorId: string;
  skillId: string;
  skillName: string;
  charge: number;
  requiredCharge: number;
  ready: boolean;
  blockedReason?: "no_ally" | "no_fallen_ally";
  effects: HeroDefinition["activeSkill"]["effects"];
}
