import { describe, expect, it } from "vitest";

import { STAGES } from "../../src/data";
import {
  STORY_HERO_UNLOCKS_BY_STAGE,
  completeCampaignStageWithRewards,
  grantRepeatableStageRewards,
  initializeStarterRoster,
  normalizeMetaSave,
} from "../../src/core/meta";
import { createDefaultSave, normalizeSave, type GameSaveV1 } from "../../src/state";

describe("stage reward pipeline", () => {
  it("persists gold, full party XP, regular materials, and a first-clear material", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const first = completeCampaignStageWithRewards(save, { stageId: "r01-s01", stars: 3 });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);

    expect(first.rewards).toMatchObject({
      gold: 80,
      heroXp: 28,
      heroXpHeroIds: ["meow-dysseus"],
      materials: { "ogygian-timber": 3 },
      firstClear: { kind: "material", id: "voyage-knot", amount: 1, granted: true },
    });
    expect(first.save.resources.gold).toBe(80);
    expect(first.save.progress.claimedFirstClearStageIds).toContain("r01-s01");
    expect(first.save.resources.materials).toMatchObject({ "ogygian-timber": 3, "voyage-knot": 1 });
    for (const heroId of first.save.roster.partyHeroIds) {
      expect(first.save.roster.heroXp[heroId]).toBe(28);
    }

    const replay = completeCampaignStageWithRewards(first.save, { stageId: "r01-s01", stars: 1 });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.message);
    expect(replay.firstCompletion).toBe(false);
    expect(replay.rewards.firstClear).toBeUndefined();
    expect(replay.save.resources.gold).toBe(160);
    expect(replay.save.resources.materials).toMatchObject({ "ogygian-timber": 6, "voyage-knot": 1 });
    for (const heroId of replay.save.roster.partyHeroIds) {
      expect(replay.save.roster.heroXp[heroId]).toBe(56);
    }
  });

  it("grants hero, relic, and fragment first-clear rewards only once", () => {
    let save = initializeStarterRoster(createDefaultSave());
    save = clear(save, "r01-s01");
    save = clear(save, "r01-s02");

    const farewellTrial = completeCampaignStageWithRewards(save, { stageId: "r01-s03", stars: 2 });
    expect(farewellTrial.ok).toBe(true);
    if (!farewellTrial.ok) throw new Error(farewellTrial.message);
    expect(farewellTrial.rewards.firstClear).toMatchObject({ kind: "relic", id: "relic-calypso-thread" });
    expect(farewellTrial.save.inventory.relicIds).toContain("relic-calypso-thread");
    expect(farewellTrial.save.roster.ownedHeroIds).not.toContain("nausi-cat");

    const relic = completeCampaignStageWithRewards(farewellTrial.save, { stageId: "r01-s04", stars: 2 });
    expect(relic.ok).toBe(true);
    if (!relic.ok) throw new Error(relic.message);
    expect(relic.rewards.firstClear).toMatchObject({ kind: "relic", id: "relic-storm-compass" });
    expect(relic.save.inventory.relicIds).toContain("relic-storm-compass");

    save = clear(relic.save, "r02-s01");
    const fragment = completeCampaignStageWithRewards(save, { stageId: "r02-s02", stars: 2 });
    expect(fragment.ok).toBe(true);
    if (!fragment.ok) throw new Error(fragment.message);
    expect(fragment.rewards.firstClear).toMatchObject({ kind: "fragment", id: "orange-sailor", amount: 5 });
    expect(fragment.save.roster.heroShards["orange-sailor"]).toBe(5);
    expect(fragment.rewards.storyHeroes.map((hero) => hero.heroId)).toEqual([
      "orange-sailor",
      "tuxedo-sailor",
      "nausi-cat",
    ]);
    expect(fragment.save.roster.ownedHeroIds).toEqual(expect.arrayContaining([
      "orange-sailor",
      "tuxedo-sailor",
      "nausi-cat",
    ]));
    expect(fragment.save.roster.partyHeroIds).toEqual([
      "meow-dysseus",
      "orange-sailor",
      "tuxedo-sailor",
    ]);

    const replay = completeCampaignStageWithRewards(fragment.save, { stageId: "r02-s02", stars: 3 });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.message);
    expect(replay.rewards.firstClear).toBeUndefined();
    expect(replay.save.roster.heroShards["orange-sailor"]).toBe(5);
    expect(replay.save.inventory.relicIds.filter((id) => id === "relic-storm-compass")).toHaveLength(1);
  });

  it("boards the rescued crew and later story allies at their canonical stages", () => {
    let save = initializeStarterRoster(createDefaultSave());
    expect(save.roster.ownedHeroIds).not.toContain("orange-sailor");
    expect(save.roster.ownedHeroIds).not.toContain("tuxedo-sailor");
    expect(save.roster.ownedHeroIds).not.toContain("nausi-cat");
    expect(save.roster.ownedHeroIds).not.toContain("tele-meow-chus");
    expect(save.roster.ownedHeroIds).not.toContain("argos");

    let rescueReceipt: readonly string[] = [];
    let finalRaidKeys = 0;
    for (const stage of STAGES) {
      const result = completeCampaignStageWithRewards(save, { stageId: stage.id, stars: 1 });
      expect(result.ok, stage.id).toBe(true);
      if (!result.ok) throw new Error(result.message);
      save = result.save;
      if (stage.id === "r02-s02") {
        rescueReceipt = result.rewards.storyHeroes
          .filter((hero) => hero.newlyOwned)
          .map((hero) => hero.heroId);
      }
      if (stage.id === "r10-s05") finalRaidKeys = result.rewards.raidKeys ?? 0;
    }

    expect(rescueReceipt).toEqual(["orange-sailor", "tuxedo-sailor", "nausi-cat"]);
    const mappedStoryHeroes = [...new Set(Object.values(STORY_HERO_UNLOCKS_BY_STAGE).flat())];
    expect(save.roster.ownedHeroIds).toEqual(expect.arrayContaining(mappedStoryHeroes));
    expect(save.roster.ownedHeroIds).toEqual(
      expect.arrayContaining(["nausi-cat", "anticleia-ghost", "tiresias", "eumaeus", "tele-meow-chus", "argos", "purr-nelope"]),
    );
    expect(finalRaidKeys).toBe(1);
    expect(save.endgame.raidKeys).toBe(1);
  });

  it("round-trips formal XP and material inventories through save v1", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const result = completeCampaignStageWithRewards(save, { stageId: "r01-s01", stars: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const roundTrip = normalizeSave(JSON.parse(JSON.stringify(result.save)) as unknown);
    expect(roundTrip.roster.heroXp).toMatchObject({
      "meow-dysseus": 28,
    });
    expect(roundTrip.resources.materials).toMatchObject({ "ogygian-timber": 3, "voyage-knot": 1 });
  });

  it("supports repeatable endgame rewards without creating a first-clear claim", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const result = grantRepeatableStageRewards(save, {
      stageId: "r01-s01",
      goldMultiplier: 1.25,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.rewards).toMatchObject({ gold: 100, heroXp: 28, materials: { "ogygian-timber": 3 } });
    expect(result.rewards.firstClear).toBeUndefined();
    expect(result.save.resources.materials["voyage-knot"]).toBeUndefined();
  });

  it("applies equipped route-gold and first-clear-material relics to real receipts", () => {
    const save = initializeStarterRoster(createDefaultSave());
    save.inventory.relicIds = ["relic-inky-route-map", "relic-palace-key"];
    save.inventory.equippedRelicIds = ["relic-inky-route-map", "relic-palace-key"];
    save.inventory.relicLevels = { "relic-inky-route-map": 1, "relic-palace-key": 1 };

    const result = completeCampaignStageWithRewards(save, { stageId: "r01-s01", stars: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.rewards.gold).toBe(90);
    expect(result.rewards.firstClear).toMatchObject({
      kind: "material",
      id: "voyage-knot",
      amount: 2,
      granted: true,
    });
    expect(result.save.resources.materials["voyage-knot"]).toBe(2);
  });

  it("backfills unclaimed story rewards for a stage completed by an older build", () => {
    let save = initializeStarterRoster(createDefaultSave());
    for (const stageId of ["r01-s01", "r01-s02", "r01-s03", "r01-s04", "r02-s01"]) {
      save = clear(save, stageId);
    }
    save.progress.completedStageIds.push("r02-s02");
    expect(save.progress.claimedFirstClearStageIds).not.toContain("r02-s02");

    const recovered = completeCampaignStageWithRewards(save, { stageId: "r02-s02", stars: 2 });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) throw new Error(recovered.message);
    expect(recovered.firstCompletion).toBe(false);
    expect(recovered.rewards.firstClear).toMatchObject({ kind: "fragment", id: "orange-sailor" });
    expect(recovered.rewards.storyHeroes.map((hero) => hero.heroId)).toEqual([
      "orange-sailor",
      "tuxedo-sailor",
      "nausi-cat",
    ]);
    expect(recovered.save.progress.claimedFirstClearStageIds).toContain("r02-s02");
  });

  it("repairs every permanent story recruit from completed and claimed milestones", () => {
    const save = createDefaultSave();
    save.progress.completedStageIds = ["r02-s02", "r06-s03", "r10-s01", "r10-s02"];
    save.progress.claimedFirstClearStageIds = ["r06-s03", "r10-s01"];
    save.roster.ownedHeroIds = ["meow-dysseus"];

    const repaired = normalizeMetaSave(save);
    expect(repaired.roster.ownedHeroIds).toEqual(expect.arrayContaining([
      "orange-sailor",
      "tuxedo-sailor",
      "nausi-cat",
      "anticleia-ghost",
      "tele-meow-chus",
      "argos",
      "eumaeus",
    ]));
    for (const heroId of repaired.roster.ownedHeroIds) {
      expect(repaired.roster.heroLevels[heroId]).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not turn a repaired story hero into duplicate shards on first-clear settlement", () => {
    const save = createDefaultSave();
    save.progress.completedStageIds = ["r06-s01", "r06-s02", "r06-s03"];
    save.progress.claimedFirstClearStageIds = [];
    save.roster.ownedHeroIds = ["meow-dysseus"];

    const persistedRepair = normalizeMetaSave(save);
    expect(persistedRepair.roster.ownedHeroIds).toContain("anticleia-ghost");
    const result = completeCampaignStageWithRewards(persistedRepair, { stageId: "r06-s03", stars: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.rewards.firstClear).toMatchObject({
      kind: "hero",
      id: "anticleia-ghost",
      granted: true,
      newlyOwned: false,
    });
    expect(result.save.roster.heroShards["anticleia-ghost"] ?? 0).toBe(0);
  });

  it("never marks an invalid authored first-clear reward as claimed", () => {
    const reward = STAGES.find((stage) => stage.id === "r01-s01")!.rewards.firstClear as {
      kind: "material";
      id: string;
      amount: number;
    };
    const originalAmount = reward.amount;
    try {
      reward.amount = 0;
      const result = completeCampaignStageWithRewards(createDefaultSave(), {
        stageId: "r01-s01",
        stars: 3,
      });
      expect(result).toMatchObject({ ok: false, code: "invalid_amount" });
      expect(result.save.progress.completedStageIds).not.toContain("r01-s01");
      expect(result.save.progress.claimedFirstClearStageIds).not.toContain("r01-s01");
      expect(result.save.resources.gold).toBe(0);
    } finally {
      reward.amount = originalAmount;
    }
  });

  it("converts an already-owned first-clear relic into relic dust", () => {
    let save = initializeStarterRoster(createDefaultSave());
    for (const stageId of ["r01-s01", "r01-s02", "r01-s03"]) save = clear(save, stageId);
    save.inventory.relicIds.push("relic-storm-compass");

    const result = completeCampaignStageWithRewards(save, { stageId: "r01-s04", stars: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.rewards.firstClear).toMatchObject({
      granted: false,
      replacement: { kind: "relicDust", amount: 50 },
    });
    expect(result.save.resources.relicDust).toBe(50);
  });

  it("converts a new first-clear relic when the vault is full and records why", () => {
    let save = initializeStarterRoster(createDefaultSave());
    for (const stageId of ["r01-s01", "r01-s02", "r01-s03"]) save = clear(save, stageId);
    save.resources.vaultSlots = 1;
    save.inventory.relicIds = ["relic-cyclops-cup"];
    save.inventory.relicLevels = { "relic-cyclops-cup": 1 };

    const result = completeCampaignStageWithRewards(save, { stageId: "r01-s04", stars: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.rewards.firstClear).toMatchObject({
      granted: false,
      replacement: { kind: "relicDust", amount: 50, reason: "vault_full" },
    });
    expect(result.save.inventory.relicIds).toEqual(["relic-cyclops-cup"]);
    expect(result.save.resources.relicDust).toBe(50);
  });
});

function clear(save: GameSaveV1, stageId: string): GameSaveV1 {
  const result = completeCampaignStageWithRewards(save, { stageId, stars: 1 });
  if (!result.ok) throw new Error(result.message);
  return result.save;
}
