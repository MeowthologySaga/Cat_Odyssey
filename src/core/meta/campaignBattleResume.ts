import {
  ENEMY_BEHAVIOR_BY_ID,
  ENEMY_BY_ID,
  HERO_BY_ID,
  STAGE_BY_ID,
  type HeroDefinition,
} from "../../data";
import {
  cloneSave,
  type ActiveCampaignBattle,
  type GameSaveV1,
} from "../../state/saveSchema";
import {
  BATTLE_SNAPSHOT_VERSION,
  parseBattleSnapshot,
  type BattleSnapshot,
} from "../battle";
import { readPendingBattleRewardTicket } from "./battleRewardTickets";
import { readPendingCampaignVictorySettlement } from "./campaignVictorySettlement";

export const ACTIVE_CAMPAIGN_BATTLE_VERSION = 1 as const;

export interface RestorableCampaignBattle {
  readonly checkpoint: ActiveCampaignBattle;
  readonly snapshot: BattleSnapshot;
  readonly partyDefinitions: readonly HeroDefinition[];
}

/**
 * Only a quiet player-input boundary is safe to persist. Saving a projectile
 * or retaliation frame could replay only part of an enemy action after a
 * restart and would make reward settlement non-deterministic.
 */
export function isStableCampaignBattleBoundary(snapshot: BattleSnapshot): boolean {
  return snapshot.phase === "awaitingAim"
    && snapshot.projectile === null
    && snapshot.aim === null
    && snapshot.outcome === null
    && snapshot.fixedAccumulator === 0
    && Boolean(snapshot.objective)
    && !snapshot.objective?.completed
    && !snapshot.objective?.failed;
}

export function createCampaignBattleCheckpoint(
  snapshot: BattleSnapshot,
  partyDefinitions: readonly HeroDefinition[],
  savedAt = Date.now(),
): ActiveCampaignBattle {
  if (!isStableCampaignBattleBoundary(snapshot)) {
    throw new Error("Campaign battles can only be checkpointed at a stable player-input boundary.");
  }
  const deployedHeroIds = partyDefinitions.map((hero) => hero.id);
  const uniqueParty = [...new Set(deployedHeroIds)];
  const snapshotParty = snapshot.party.map((member) => member.definitionId);
  if (
    uniqueParty.length < 1
    || uniqueParty.length > 3
    || uniqueParty.length !== deployedHeroIds.length
    || !sameStrings(snapshotParty, uniqueParty)
  ) {
    throw new Error("Checkpoint party does not match the battle snapshot.");
  }
  return {
    version: ACTIVE_CAMPAIGN_BATTLE_VERSION,
    stageId: snapshot.stageId,
    deployedHeroIds: [...uniqueParty],
    partyDefinitions: JSON.stringify(partyDefinitions),
    contentRevision: campaignBattleContentRevision(snapshot.stageId),
    battleSnapshot: JSON.stringify(snapshot),
    savedAt: Math.max(0, Math.floor(savedAt)),
  };
}

/** Returns a fully validated ordinary-campaign checkpoint, never a partial one. */
export function readRestorableCampaignBattle(save: GameSaveV1): RestorableCampaignBattle | undefined {
  if (readPendingCampaignVictorySettlement(save)) return undefined;
  const checkpoint = save.recovery.activeCampaignBattle;
  if (!checkpoint || checkpoint.version !== ACTIVE_CAMPAIGN_BATTLE_VERSION) return undefined;
  if (!STAGE_BY_ID[checkpoint.stageId]) return undefined;
  if (checkpoint.contentRevision !== campaignBattleContentRevision(checkpoint.stageId)) return undefined;
  // A completed stage may have an unfinished replay checkpoint (most commonly
  // a run to improve its star record). The matching campaign reward ticket,
  // rather than first-completion state, is the authority for that live run.
  if (!readPendingBattleRewardTicket(save, checkpoint.stageId, "campaign")) return undefined;
  if (
    checkpoint.deployedHeroIds.length < 1
    || checkpoint.deployedHeroIds.length > 3
    || new Set(checkpoint.deployedHeroIds).size !== checkpoint.deployedHeroIds.length
    || checkpoint.deployedHeroIds.some((heroId) => !HERO_BY_ID[heroId] || !save.roster.ownedHeroIds.includes(heroId))
  ) {
    return undefined;
  }

  let snapshot: BattleSnapshot;
  let partyDefinitions: HeroDefinition[];
  try {
    snapshot = parseBattleSnapshot(checkpoint.battleSnapshot);
    const parsedParty = JSON.parse(checkpoint.partyDefinitions) as unknown;
    if (!Array.isArray(parsedParty) || parsedParty.some((entry) => !entry || typeof entry !== "object")) {
      return undefined;
    }
    partyDefinitions = parsedParty as HeroDefinition[];
  } catch {
    return undefined;
  }
  try {
    if (
      snapshot.snapshotVersion !== BATTLE_SNAPSHOT_VERSION
      || snapshot.stageId !== checkpoint.stageId
      || partyDefinitions.length !== checkpoint.deployedHeroIds.length
      || !sameStrings(partyDefinitions.map((hero) => hero.id), checkpoint.deployedHeroIds)
      || partyDefinitions.some((hero) => !validHeroDefinition(hero))
      || !isStableCampaignBattleBoundary(snapshot)
      || !sameStrings(snapshot.party.map((member) => member.definitionId), checkpoint.deployedHeroIds)
      || snapshot.party.some((member) => !validPartyMember(member))
      || snapshot.enemies.some((enemy) => !enemy || !ENEMY_BY_ID[enemy.definitionId])
      || !validRuntimeCollections(snapshot)
      || !Number.isFinite(snapshot.turnNumber)
      || snapshot.turnNumber < 1
      || !Number.isFinite(snapshot.completedTurns)
      || snapshot.completedTurns < 0
      || snapshot.activePartyIndex < 0
      || snapshot.activePartyIndex >= snapshot.party.length
      || !snapshot.party[snapshot.activePartyIndex]?.alive
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return {
    checkpoint: {
      ...checkpoint,
      deployedHeroIds: [...checkpoint.deployedHeroIds],
    },
    snapshot,
    partyDefinitions,
  };
}

export function writeCampaignBattleCheckpoint(
  input: GameSaveV1,
  checkpoint: ActiveCampaignBattle,
): GameSaveV1 {
  const save = cloneSave(input);
  save.recovery.activeCampaignBattle = {
    ...checkpoint,
    deployedHeroIds: [...checkpoint.deployedHeroIds],
  };
  return save;
}

export function clearCampaignBattleCheckpoint(input: GameSaveV1): GameSaveV1 {
  if (!input.recovery.activeCampaignBattle) return input;
  const save = cloneSave(input);
  save.recovery.activeCampaignBattle = null;
  return save;
}

/** Clears malformed, outdated, or orphaned-reward checkpoints. */
export function sanitizeCampaignBattleCheckpoint(input: GameSaveV1): GameSaveV1 {
  if (readPendingCampaignVictorySettlement(input)) return input;
  if (!input.recovery.activeCampaignBattle || readRestorableCampaignBattle(input)) return input;
  return clearCampaignBattleCheckpoint(input);
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

/** FNV-1a is sufficient here: it is a compatibility fingerprint, not a secret. */
export function campaignBattleContentRevision(stageId: string): string {
  const payload = JSON.stringify({
    stage: STAGE_BY_ID[stageId] ?? null,
    enemies: ENEMY_BY_ID,
    behaviors: ENEMY_BEHAVIOR_BY_ID,
    snapshotVersion: BATTLE_SNAPSHOT_VERSION,
  });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function validRuntimeCollections(snapshot: BattleSnapshot): boolean {
  return Array.isArray(snapshot.enemies)
    && Array.isArray(snapshot.enemyIntents)
    && Array.isArray(snapshot.objective?.targets)
    && Array.isArray(snapshot.props)
    && Array.isArray(snapshot.hazards)
    && Array.isArray(snapshot.walls)
    && Array.isArray(snapshot.effects)
    && Array.isArray(snapshot.modifiers)
    && Number.isFinite(snapshot.rng?.state)
    && Number.isFinite(snapshot.rng?.draws)
    && Number.isFinite(snapshot.eventSequence);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
