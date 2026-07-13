import type { EnemyDefinition } from "../../data/types";

/**
 * Runtime summon fallback order. Keeping this outside BattleRuntime lets scene
 * preload planning use the exact same contract as authoritative simulation.
 */
export function summonCandidateIdsForAttackKind(attackKind: string): readonly string[] {
  if (attackKind.includes("foam-crab")) return ["foam-crab"];
  if (attackKind.includes("wisp") || attackKind.includes("soul")) return ["underworld-wisp"];
  if (attackKind.includes("formation")) return ["suitor-hoplon", "bronze-shieldcat"];
  if (attackKind.includes("storm") || attackKind.includes("maelstrom")) return ["storm-jelly"];
  if (attackKind.includes("illusion") || attackKind.includes("mirror")) return ["split-anemone"];
  return ["foam-crab", "storm-jelly", "underworld-wisp"];
}

/** Runtime fallback order for authored turn-based reinforcements. */
export const SCRIPTED_REINFORCEMENT_CANDIDATE_IDS = Object.freeze([
  "suitor-sniper",
  "suitor-hoplon",
  "foam-crab",
] as const);

export function firstAvailableNonBossEnemy(
  candidateIds: readonly string[],
  catalog: Readonly<Record<string, EnemyDefinition>>,
): EnemyDefinition | undefined {
  return candidateIds
    .map((id) => catalog[id])
    .find((candidate): candidate is EnemyDefinition => Boolean(candidate && !candidate.boss));
}
