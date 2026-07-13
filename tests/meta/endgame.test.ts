import { describe, expect, it } from "vitest";

import { HEROES, STAGES } from "../../src/data";
import {
  completeCampaignStage,
  getEndgameGates,
  initializeStarterRoster,
  validateScyllaRaidSquads,
} from "../../src/core/meta";
import { createDefaultSave, type GameSaveV1 } from "../../src/state";

function completeCampaign(stars: 1 | 2 | 3): GameSaveV1 {
  let save = initializeStarterRoster(createDefaultSave());
  for (const stage of STAGES) {
    const result = completeCampaignStage(save, { stageId: stage.id, stars });
    if (!result.ok) throw new Error(`${stage.id}: ${result.message}`);
    save = result.save;
  }
  return save;
}

describe("endgame unlock gates", () => {
  it("keeps all endgame modes locked before campaign completion", () => {
    const gates = getEndgameGates(initializeStarterRoster(createDefaultSave()));
    expect(gates.oracleTower.unlocked).toBe(false);
    expect(gates.stormRoute.unlocked).toBe(false);
    expect(gates.scyllaRaid.unlocked).toBe(false);
  });

  it("unlocks Oracle at campaign completion and Storm at 60 stars", () => {
    const oneStar = completeCampaign(1);
    let gates = getEndgameGates(oneStar);
    expect(gates.oracleTower.unlocked).toBe(true);
    expect(gates.stormRoute.unlocked).toBe(false);
    expect(gates.stormRoute.progress.totalStars).toBe(43);

    const threeStar = completeCampaign(3);
    gates = getEndgameGates(threeStar);
    expect(gates.oracleTower.unlocked).toBe(true);
    expect(gates.stormRoute.unlocked).toBe(true);
  });

  it("unlocks and validates the three-party Scylla raid with twelve unique heroes", () => {
    const save = completeCampaign(3);
    save.roster.ownedHeroIds = HEROES.map((hero) => hero.id);
    const gates = getEndgameGates(save);
    expect(gates.scyllaRaid.unlocked).toBe(true);

    const heroIds = HEROES.slice(0, 12).map((hero) => hero.id);
    const valid = validateScyllaRaidSquads(save, [
      heroIds.slice(0, 4),
      heroIds.slice(4, 8),
      heroIds.slice(8, 12),
    ]);
    expect(valid).toMatchObject({ valid: true, issues: [] });

    const invalid = validateScyllaRaidSquads(save, [
      heroIds.slice(0, 4),
      heroIds.slice(3, 7),
      heroIds.slice(8, 12),
    ]);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toContain("duplicate_hero");
  });
});
