import {
  ENEMY_BEHAVIOR_BY_ID,
  ENEMY_BY_ID,
  ENDGAME,
  BLESSINGS,
  HERO_BY_ID,
  STAGE_BY_ID,
  type HeroDefinition,
} from "../../data";
import {
  cloneSave,
  type BattleRescueMode,
  type GameSaveV1,
  type JsonObject,
  type PendingBattleRescue,
} from "../../state/saveSchema";
import {
  BATTLE_SNAPSHOT_VERSION,
  parseBattleSnapshot,
  type BattleSnapshot,
} from "../battle";
import { assertNoWalletState } from "./compat";

export const BATTLE_RESCUE_VERSION = 1 as const;
export const BATTLE_RESCUE_HP_RATIO = 0.5 as const;
export const BATTLE_RESCUE_TURN_BONUS = 3 as const;

export type BattleRescueEndgameMode = "oracleTower" | "stormRoute" | "scyllaRaid";

export interface RestorableBattleRescue {
  readonly rescue: PendingBattleRescue;
  readonly partyDefinitions: readonly HeroDefinition[];
  readonly defeatedSnapshot: BattleSnapshot;
  readonly preparedSnapshot: BattleSnapshot;
}

export interface ConsumeBattleRescueSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly rescue: PendingBattleRescue;
}

export interface ConsumeBattleRescueFailure {
  readonly ok: false;
  readonly code: "battle_rescue_missing" | "battle_rescue_mismatch" | "battle_rescue_invalid";
  readonly message: string;
  readonly save: GameSaveV1;
}

export type ConsumeBattleRescueResult = ConsumeBattleRescueSuccess | ConsumeBattleRescueFailure;

export interface BattleRescueExpectation {
  readonly stageId?: string;
  readonly mode?: BattleRescueMode;
}

export function battleRescueMode(endgameMode?: BattleRescueEndgameMode): BattleRescueMode {
  if (endgameMode === "oracleTower") return "oracle";
  if (endgameMode === "stormRoute") return "storm";
  if (endgameMode === "scyllaRaid") return "raid";
  return "campaign";
}

export function battleRescueEndgameMode(mode: BattleRescueMode): BattleRescueEndgameMode | undefined {
  if (mode === "oracle") return "oracleTower";
  if (mode === "storm") return "stormRoute";
  if (mode === "raid") return "scyllaRaid";
  return undefined;
}

/**
 * Freezes every input needed to reproduce the paid rescue before the wallet is
 * touched. The party definitions are deliberately pre-mode definitions: endgame
 * rules are compiled exactly once again when the rescued runtime is restored.
 */
export function createBattleRescueReward(
  stageId: string,
  mode: BattleRescueMode,
  battleSnapshot: string,
  partyDefinitions: readonly HeroDefinition[],
): JsonObject {
  const stage = STAGE_BY_ID[stageId];
  if (!stage) throw new Error(`Unknown stage: ${stageId}`);
  if (!battleSnapshot.trim()) throw new Error("battleSnapshot is required for battle rescue.");
  const deployedHeroIds = partyDefinitions.map((hero) => hero.id);
  const maximumPartySize = mode === "raid" ? 4 : 3;
  if (
    deployedHeroIds.length < 1
    || deployedHeroIds.length > maximumPartySize
    || new Set(deployedHeroIds).size !== deployedHeroIds.length
    || partyDefinitions.some((hero) => !validHeroDefinition(hero))
  ) {
    throw new Error("A valid frozen battle party is required for battle rescue.");
  }
  const snapshot = parseBattleSnapshot(battleSnapshot);
  if (
    snapshot.stageId !== stageId
    || !isDefeatedSnapshot(snapshot)
    || !sameStrings(snapshot.party.map((member) => member.definitionId), deployedHeroIds)
    || snapshot.party.some((member) => !validPartyMember(member))
    || snapshot.enemies.some((enemy) => !validEnemy(enemy))
    || snapshot.enemyIntents.some((intent) => !validEnemyIntent(intent))
    || !validObjective(snapshot)
    || snapshot.props.some((prop) => !validProp(prop))
    || snapshot.hazards.some((hazard) => !validHazard(hazard))
    || snapshot.walls.some((wall) => !validWall(wall))
    || !validRuntimeCollections(snapshot)
  ) {
    throw new Error("The defeated battle snapshot does not match the rescue party.");
  }
  return {
    version: BATTLE_RESCUE_VERSION,
    stageId,
    mode,
    deployedHeroIds,
    partyDefinitions: JSON.stringify(partyDefinitions),
    contentRevision: battleRescueContentRevision(stageId, mode),
    battleSnapshot,
    hpRatio: BATTLE_RESCUE_HP_RATIO,
  };
}

/** Returns only a fully validated and already-prepared rescue, without consuming it. */
export function readRestorableBattleRescue(
  input: GameSaveV1,
  expectation: BattleRescueExpectation = {},
): RestorableBattleRescue | undefined {
  const rescue = input.recovery.pendingBattleRescue;
  if (!rescue || rescue.version !== BATTLE_RESCUE_VERSION) return undefined;
  if (expectation.stageId && rescue.stageId !== expectation.stageId) return undefined;
  if (expectation.mode && rescue.mode !== expectation.mode) return undefined;
  if (!STAGE_BY_ID[rescue.stageId]) return undefined;
  if (rescue.contentRevision !== battleRescueContentRevision(rescue.stageId, rescue.mode)) return undefined;
  const maximumPartySize = rescue.mode === "raid" ? 4 : 3;
  if (
    !rescue.purchaseId.trim()
    || rescue.deployedHeroIds.length < 1
    || rescue.deployedHeroIds.length > maximumPartySize
    || new Set(rescue.deployedHeroIds).size !== rescue.deployedHeroIds.length
    || rescue.deployedHeroIds.some((heroId) => !HERO_BY_ID[heroId])
    || !Number.isFinite(rescue.hpRatio)
    || rescue.hpRatio < 0.1
    || rescue.hpRatio > 1
    || !Number.isInteger(rescue.createdAt)
    || rescue.createdAt < 0
  ) return undefined;

  let defeatedSnapshot: BattleSnapshot;
  let partyDefinitions: HeroDefinition[];
  try {
    defeatedSnapshot = parseBattleSnapshot(rescue.battleSnapshot);
    const parsedParty = JSON.parse(rescue.partyDefinitions) as unknown;
    if (!Array.isArray(parsedParty)) return undefined;
    partyDefinitions = parsedParty as HeroDefinition[];
  } catch {
    return undefined;
  }
  if (
    partyDefinitions.length !== rescue.deployedHeroIds.length
    || !sameStrings(partyDefinitions.map((hero) => hero.id), rescue.deployedHeroIds)
    || partyDefinitions.some((hero) => !validHeroDefinition(hero))
    || defeatedSnapshot.snapshotVersion !== BATTLE_SNAPSHOT_VERSION
    || defeatedSnapshot.stageId !== rescue.stageId
    || !sameStrings(defeatedSnapshot.party.map((member) => member.definitionId), rescue.deployedHeroIds)
    || defeatedSnapshot.party.some((member) => !validPartyMember(member))
    || defeatedSnapshot.enemies.some((enemy) => !validEnemy(enemy))
    || defeatedSnapshot.enemyIntents.some((intent) => !validEnemyIntent(intent))
    || !validObjective(defeatedSnapshot)
    || defeatedSnapshot.props.some((prop) => !validProp(prop))
    || defeatedSnapshot.hazards.some((hazard) => !validHazard(hazard))
    || defeatedSnapshot.walls.some((wall) => !validWall(wall))
    || !validRuntimeCollections(defeatedSnapshot)
    || !isDefeatedSnapshot(defeatedSnapshot)
  ) return undefined;

  const preparedSnapshot = prepareDefeatedSnapshot(defeatedSnapshot, rescue.hpRatio);
  return {
    rescue: cloneRescue(rescue),
    partyDefinitions: partyDefinitions.map((hero) => structuredClone(hero)),
    defeatedSnapshot: structuredClone(defeatedSnapshot),
    preparedSnapshot,
  };
}

export function getPendingBattleRescue(input: GameSaveV1): PendingBattleRescue | undefined {
  const rescue = input.recovery.pendingBattleRescue;
  return rescue ? cloneRescue(rescue) : undefined;
}

/**
 * Consumes only the exact record that was validated and successfully restored by
 * the caller. Revalidation prevents stale scene data from clearing a replacement
 * or corrupted paid rescue.
 */
export function consumePreparedBattleRescue(
  input: GameSaveV1,
  prepared: RestorableBattleRescue,
): ConsumeBattleRescueResult {
  const save = cloneSave(input);
  const current = save.recovery.pendingBattleRescue;
  if (!current) {
    return failure(save, "battle_rescue_missing", "사용 가능한 전투 구조 기록이 없습니다.");
  }
  if (
    current.purchaseId !== prepared.rescue.purchaseId
    || current.stageId !== prepared.rescue.stageId
    || current.mode !== prepared.rescue.mode
    || current.contentRevision !== prepared.rescue.contentRevision
    || current.partyDefinitions !== prepared.rescue.partyDefinitions
    || !sameStrings(current.deployedHeroIds, prepared.rescue.deployedHeroIds)
    || current.battleSnapshot !== prepared.rescue.battleSnapshot
  ) {
    return failure(save, "battle_rescue_mismatch", "현재 전투와 구조 기록이 일치하지 않습니다.");
  }
  const revalidated = readRestorableBattleRescue(save, {
    stageId: current.stageId,
    mode: current.mode,
  });
  if (!revalidated || revalidated.rescue.purchaseId !== current.purchaseId) {
    return failure(save, "battle_rescue_invalid", "구조 기록이 손상되어 자동으로 소비하지 않았습니다.");
  }
  save.recovery.pendingBattleRescue = null;
  assertNoWalletState(save);
  return { ok: true, save, rescue: cloneRescue(current) };
}

/** FNV-1a compatibility fingerprint, not a security primitive. */
export function battleRescueContentRevision(stageId: string, mode: BattleRescueMode): string {
  const payload = JSON.stringify({
    stage: STAGE_BY_ID[stageId] ?? null,
    enemies: ENEMY_BY_ID,
    behaviors: ENEMY_BEHAVIOR_BY_ID,
    endgame: ENDGAME,
    blessings: BLESSINGS,
    snapshotVersion: BATTLE_SNAPSHOT_VERSION,
    rescueVersion: BATTLE_RESCUE_VERSION,
    mode,
  });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function prepareDefeatedSnapshot(input: BattleSnapshot, hpRatio: number): BattleSnapshot {
  const snapshot = structuredClone(input);
  const reason = snapshot.outcome!.reason;
  const previousBonus = Math.max(0, Math.floor(snapshot.rescueTurnLimitBonus ?? 0));
  snapshot.phase = "awaitingAim";
  snapshot.outcome = null;
  snapshot.projectile = null;
  snapshot.aim = null;
  snapshot.fixedAccumulator = 0;
  snapshot.comboCount = 0;
  snapshot.ricochetCount = 0;
  snapshot.rescueTurnLimitBonus = reason === "turnLimit"
    ? previousBonus + BATTLE_RESCUE_TURN_BONUS
    : previousBonus;
  for (const member of snapshot.party) {
    member.alive = true;
    member.hp = Math.max(1, Math.round(member.maxHp * hpRatio));
  }
  snapshot.activePartyIndex = Math.max(0, snapshot.party.findIndex((member) => member.alive));
  snapshot.objective.failed = false;
  snapshot.objective.completed = false;
  for (const target of snapshot.objective.targets) {
    if (!target.failed) continue;
    target.failed = false;
    target.active = true;
    target.hp = Math.max(1, Math.round(target.maxHp * hpRatio));
    const prop = snapshot.props.find((entry) => entry.id === target.id);
    if (prop) {
      prop.hp = target.hp;
      prop.active = true;
      prop.state = "protected";
    }
  }
  return snapshot;
}

function isDefeatedSnapshot(snapshot: BattleSnapshot): boolean {
  return snapshot.phase === "defeat"
    && snapshot.outcome?.victory === false
    && (snapshot.outcome.reason === "partyDefeated"
      || snapshot.outcome.reason === "objectiveFailed"
      || snapshot.outcome.reason === "turnLimit");
}

function validPartyMember(member: BattleSnapshot["party"][number]): boolean {
  return Boolean(member && typeof member === "object")
    && Boolean(HERO_BY_ID[member.definitionId])
    && Number.isFinite(member.hp)
    && Number.isFinite(member.maxHp)
    && member.maxHp > 0
    && member.hp >= 0
    && member.hp <= member.maxHp
    && Number.isFinite(member.position?.x)
    && Number.isFinite(member.position?.y)
    && Number.isFinite(member.activeSkill?.charge)
    && Number.isFinite(member.activeSkill?.requiredCharge);
}

function validHeroDefinition(hero: HeroDefinition): boolean {
  return Boolean(hero && typeof hero === "object")
    && Boolean(HERO_BY_ID[hero.id])
    && typeof hero.name === "string"
    && typeof hero.ricochetClass === "string"
    && Number.isFinite(hero.radius)
    && hero.radius > 0
    && Number.isFinite(hero.stats?.hp)
    && Number.isFinite(hero.stats?.attack)
    && Number.isFinite(hero.stats?.speed)
    && typeof hero.activeSkill?.name === "string"
    && Number.isFinite(hero.activeSkill?.chargeTurns)
    && Array.isArray(hero.activeSkill?.effects)
    && typeof hero.friendshipSkill?.name === "string"
    && Array.isArray(hero.friendshipSkill?.effects);
}

function validEnemy(enemy: BattleSnapshot["enemies"][number]): boolean {
  return Boolean(enemy && typeof enemy === "object")
    && Boolean(ENEMY_BY_ID[enemy.definitionId])
    && Boolean(ENEMY_BEHAVIOR_BY_ID[enemy.behaviorId])
    && Number.isFinite(enemy.hp)
    && Number.isFinite(enemy.maxHp)
    && enemy.maxHp > 0
    && enemy.hp >= 0
    && enemy.hp <= enemy.maxHp
    && Number.isFinite(enemy.position?.x)
    && Number.isFinite(enemy.position?.y)
    && Number.isFinite(enemy.facing?.x)
    && Number.isFinite(enemy.facing?.y)
    && Number.isFinite(enemy.radius)
    && enemy.radius > 0
    && Number.isFinite(enemy.attackCountdown)
    && Array.isArray(enemy.weakpoints)
    && enemy.weakpoints.every((weakpoint) =>
      Boolean(weakpoint && typeof weakpoint === "object")
      && Number.isFinite(weakpoint.hp)
      && Number.isFinite(weakpoint.maxHp)
      && weakpoint.maxHp > 0
      && weakpoint.hp >= 0
      && weakpoint.hp <= weakpoint.maxHp
      && Number.isFinite(weakpoint.position?.x)
      && Number.isFinite(weakpoint.position?.y)
      && Number.isFinite(weakpoint.radius)
      && weakpoint.radius > 0,
    );
}

function validEnemyIntent(intent: BattleSnapshot["enemyIntents"][number]): boolean {
  return Boolean(intent && typeof intent === "object")
    && Boolean(ENEMY_BEHAVIOR_BY_ID[intent.behaviorId])
    && Number.isFinite(intent.countdown)
    && Number.isFinite(intent.origin?.x)
    && Number.isFinite(intent.origin?.y)
    && Number.isFinite(intent.range)
    && Number.isFinite(intent.areaRadius)
    && Array.isArray(intent.targetIds);
}

function validObjective(snapshot: BattleSnapshot): boolean {
  const objective = snapshot.objective;
  return Boolean(objective && typeof objective === "object")
    && Number.isFinite(objective.current)
    && objective.current >= 0
    && Number.isFinite(objective.required)
    && objective.required >= 1
    && Number.isFinite(objective.turnLimit)
    && objective.turnLimit >= 1
    && Array.isArray(objective.targets)
    && objective.targets.every((target) =>
      Boolean(target && typeof target === "object")
      && Number.isFinite(target.position?.x)
      && Number.isFinite(target.position?.y)
      && Number.isFinite(target.radius)
      && target.radius > 0
      && Number.isFinite(target.hp)
      && Number.isFinite(target.maxHp)
      && target.maxHp > 0
      && target.hp >= 0
      && target.hp <= target.maxHp
      && Number.isFinite(target.hitCount)
      && target.hitCount >= 0,
    );
}

function validProp(prop: BattleSnapshot["props"][number]): boolean {
  return Boolean(prop && typeof prop === "object")
    && Number.isFinite(prop.position?.x)
    && Number.isFinite(prop.position?.y)
    && Number.isFinite(prop.origin?.x)
    && Number.isFinite(prop.origin?.y)
    && Number.isFinite(prop.radius)
    && prop.radius > 0
    && Number.isFinite(prop.hp)
    && Number.isFinite(prop.maxHp)
    && prop.maxHp > 0
    && prop.hp >= 0
    && prop.hp <= prop.maxHp;
}

function validHazard(hazard: BattleSnapshot["hazards"][number]): boolean {
  return Boolean(hazard && typeof hazard === "object")
    && Number.isFinite(hazard.position?.x)
    && Number.isFinite(hazard.position?.y)
    && Number.isFinite(hazard.origin?.x)
    && Number.isFinite(hazard.origin?.y)
    && Number.isFinite(hazard.radius)
    && hazard.radius > 0
    && Number.isFinite(hazard.phase);
}

function validWall(wall: BattleSnapshot["walls"][number]): boolean {
  return Boolean(wall && typeof wall === "object")
    && Number.isFinite(wall.hp)
    && Number.isFinite(wall.maxHp)
    && wall.maxHp > 0
    && wall.hp >= 0
    && wall.hp <= wall.maxHp
    && Number.isFinite(wall.offset?.x)
    && Number.isFinite(wall.offset?.y)
    && Number.isFinite(wall.rotation);
}

function validRuntimeCollections(snapshot: BattleSnapshot): boolean {
  return Array.isArray(snapshot.party)
    && Array.isArray(snapshot.enemies)
    && Array.isArray(snapshot.enemyIntents)
    && Boolean(snapshot.objective && typeof snapshot.objective === "object")
    && Array.isArray(snapshot.objective?.targets)
    && Array.isArray(snapshot.props)
    && Array.isArray(snapshot.hazards)
    && Array.isArray(snapshot.walls)
    && Array.isArray(snapshot.effects)
    && Array.isArray(snapshot.modifiers)
    && Number.isFinite(snapshot.rng?.state)
    && Number.isFinite(snapshot.rng?.draws)
    && Number.isFinite(snapshot.eventSequence)
    && Number.isFinite(snapshot.battleTime)
    && snapshot.battleTime >= 0
    && Number.isFinite(snapshot.turnNumber)
    && snapshot.turnNumber >= 1
    && Number.isFinite(snapshot.completedTurns)
    && snapshot.completedTurns >= 0
    && Number.isFinite(snapshot.rescueTurnLimitBonus)
    && snapshot.rescueTurnLimitBonus >= 0
    && Number.isFinite(snapshot.outcome?.turnNumber)
    && Number.isInteger(snapshot.activePartyIndex)
    && snapshot.activePartyIndex >= 0
    && snapshot.activePartyIndex < snapshot.party.length;
}

function cloneRescue(rescue: PendingBattleRescue): PendingBattleRescue {
  return { ...rescue, deployedHeroIds: [...rescue.deployedHeroIds] };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function failure(
  save: GameSaveV1,
  code: ConsumeBattleRescueFailure["code"],
  message: string,
): ConsumeBattleRescueFailure {
  return { ok: false, code, message, save };
}
