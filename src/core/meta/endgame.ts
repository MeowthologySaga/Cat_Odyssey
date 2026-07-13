import { ENDGAME, HERO_BY_ID, STAGES } from "../../data";
import type { GameSaveV1 } from "../../state/saveSchema";
import { normalizeMetaSave } from "./compat";
import { getTotalCampaignStars } from "./campaign";
import type {
  EndgameGateCollection,
  EndgameGateStatus,
  EndgameModeId,
  PartyValidationIssue,
} from "./types";

export const STORM_ROUTE_STAR_GATE = 60 as const;
export const SCYLLA_RAID_ROSTER_GATE = 12 as const;

export function getEndgameGates(input: GameSaveV1): EndgameGateCollection {
  const save = normalizeMetaSave(input);
  const completedStages = save.progress.completedStageIds.length;
  const totalStars = getTotalCampaignStars(save);
  const campaignComplete =
    save.progress.campaignComplete && completedStages === STAGES.length;
  const ownedHeroes = save.roster.ownedHeroIds.length;
  const scyllaCleared = save.progress.completedStageIds.includes("r08-s05");

  const oracleReasons = campaignComplete ? [] : ["메인 캠페인 43개 스테이지를 완료해야 합니다."];
  const stormReasons = [
    ...(campaignComplete ? [] : ["메인 캠페인을 완료해야 합니다."]),
    ...(totalStars >= STORM_ROUTE_STAR_GATE
      ? []
      : [`캠페인 별 ${STORM_ROUTE_STAR_GATE}개가 필요합니다.`]),
  ];
  const raidReasons = [
    ...(campaignComplete ? [] : ["메인 캠페인을 완료해야 합니다."]),
    ...(scyllaCleared ? [] : ["스킬라·카리브디스 해협을 돌파해야 합니다."]),
    ...(ownedHeroes >= SCYLLA_RAID_ROSTER_GATE
      ? []
      : [`서로 겹치지 않는 3개 토벌대를 위해 영웅 ${SCYLLA_RAID_ROSTER_GATE}명이 필요합니다.`]),
  ];

  return {
    oracleTower: gate("oracleTower", oracleReasons, {
      campaignComplete,
      completedStages,
      requiredStages: STAGES.length,
    }),
    stormRoute: gate("stormRoute", stormReasons, {
      campaignComplete,
      totalStars,
      requiredStars: STORM_ROUTE_STAR_GATE,
    }),
    scyllaRaid: gate("scyllaRaid", raidReasons, {
      campaignComplete,
      scyllaCleared,
      ownedHeroes,
      requiredHeroes: SCYLLA_RAID_ROSTER_GATE,
    }),
  };
}

export function isEndgameUnlocked(input: GameSaveV1, mode: EndgameModeId): boolean {
  const gates = getEndgameGates(input);
  return gates[mode].unlocked;
}

export interface RaidSquadValidation {
  readonly valid: boolean;
  readonly parties: readonly (readonly string[])[];
  readonly issues: readonly PartyValidationIssue[];
}

export function validateScyllaRaidSquads(
  input: GameSaveV1,
  parties: readonly (readonly string[])[],
): RaidSquadValidation {
  const save = normalizeMetaSave(input);
  const issues: PartyValidationIssue[] = [];
  if (parties.length !== ENDGAME.raid.partiesRequired) {
    issues.push({
      code: "party_size",
      message: `Raid requires ${ENDGAME.raid.partiesRequired} parties.`,
    });
  }
  const allHeroes = new Set<string>();
  for (const [partyIndex, party] of parties.entries()) {
    if (party.length !== ENDGAME.raid.heroesPerParty) {
      issues.push({
        code: "party_size",
        message: `Raid party ${partyIndex + 1} requires ${ENDGAME.raid.heroesPerParty} heroes.`,
      });
    }
    for (const heroId of party) {
      if (!HERO_BY_ID[heroId]) {
        issues.push({ code: "unknown_hero", heroId, message: `Unknown hero: ${heroId}` });
      } else if (!save.roster.ownedHeroIds.includes(heroId)) {
        issues.push({ code: "hero_not_owned", heroId, message: `Hero is not owned: ${heroId}` });
      }
      if (allHeroes.has(heroId)) {
        issues.push({
          code: "duplicate_hero",
          heroId,
          message: `Hero appears in more than one raid party: ${heroId}`,
        });
      }
      allHeroes.add(heroId);
    }
  }
  return { valid: issues.length === 0, parties: parties.map((party) => [...party]), issues };
}

function gate(
  id: EndgameModeId,
  reasons: readonly string[],
  progress: Readonly<Record<string, number | boolean>>,
): EndgameGateStatus {
  return { id, unlocked: reasons.length === 0, reasons: [...reasons], progress: { ...progress } };
}
