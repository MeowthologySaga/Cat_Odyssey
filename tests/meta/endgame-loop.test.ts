import { describe, expect, it } from "vitest";

import {
  STORM_EXTRA_ENTRY_MATERIAL_ID,
  STORM_WEEKLY_BATTLE_LIMIT,
  consumeEndgameEntryCost,
  grantEndgameStageRewards,
  initializeStarterRoster,
  prepareWeeklyStormState,
} from "../../src/core/meta";
import { createDefaultSave } from "../../src/state";

describe("weekly storm loop", () => {
  it("resets the basic run count when the ISO week changes", () => {
    const save = createDefaultSave();
    save.endgame.weeklyStormRuns = 5;
    const first = prepareWeeklyStormState(save, new Date("2026-07-06T00:00:00Z"));
    expect(first.reset).toBe(true);
    expect(first.save.endgame.weeklyStormRuns).toBe(0);
    first.save.endgame.weeklyStormRuns = 3;

    const sameWeek = prepareWeeklyStormState(first.save, new Date("2026-07-10T00:00:00Z"));
    expect(sameWeek.reset).toBe(false);
    expect(sameWeek.save.endgame.weeklyStormRuns).toBe(3);

    const nextWeek = prepareWeeklyStormState(sameWeek.save, new Date("2026-07-13T00:00:00Z"));
    expect(nextWeek.reset).toBe(true);
    expect(nextWeek.save.endgame.weeklyStormRuns).toBe(0);
  });

  it("consumes an extra entry only after the six basic battles are used", () => {
    const save = createDefaultSave();
    save.endgame.weeklyStormRuns = STORM_WEEKLY_BATTLE_LIMIT;
    expect(consumeEndgameEntryCost(save, "stormRoute")).toMatchObject({
      ok: false,
      code: "storm_entry_required",
    });
    save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] = 1;
    const paid = consumeEndgameEntryCost(save, "stormRoute");
    expect(paid.ok).toBe(true);
    if (!paid.ok) throw new Error(paid.message);
    expect(paid.consumed).toBe("stormExtraEntry");
    expect(paid.save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID]).toBe(0);
  });
});

describe("endgame entry costs and growth rewards", () => {
  it("does not consume a raid key until the confirmed entry-cost operation", () => {
    const save = createDefaultSave();
    save.endgame.raidKeys = 1;
    const before = JSON.stringify(save);
    expect(JSON.stringify(save)).toBe(before);
    const consumed = consumeEndgameEntryCost(save, "scyllaRaid");
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) throw new Error(consumed.message);
    expect(save.endgame.raidKeys).toBe(1);
    expect(consumed.save.endgame.raidKeys).toBe(0);
    const resumed = consumeEndgameEntryCost(consumed.save, "scyllaRaid");
    expect(resumed).toMatchObject({ ok: true, consumed: "none" });
    if (resumed.ok) expect(resumed.save.endgame.raidKeys).toBe(0);
  });

  it("never consumes a second Storm ticket while the same route is active", () => {
    const save = createDefaultSave();
    save.endgame.weeklyStormRuns = STORM_WEEKLY_BATTLE_LIMIT;
    save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] = 2;
    const first = consumeEndgameEntryCost(save, "stormRoute");
    expect(first).toMatchObject({ ok: true, consumed: "stormExtraEntry" });
    if (!first.ok) throw new Error(first.message);
    const resumed = consumeEndgameEntryCost(first.save, "stormRoute");
    expect(resumed).toMatchObject({ ok: true, consumed: "none" });
    if (resumed.ok) expect(resumed.save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID]).toBe(1);
  });

  it("persists Oracle floor materials in addition to scaled gold and hero XP", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const result = grantEndgameStageRewards(save, {
      mode: "oracleTower",
      stageId: "r01-s02",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.save.resources.gold).toBeGreaterThan(105);
    expect(result.save.resources.materials["oracle-dust"]).toBe(5);
    expect(result.rewards.endgameBonuses).toContainEqual({
      kind: "material",
      id: "oracle-dust",
      amount: 5,
      granted: true,
    });
  });

  it("turns the first Scylla reward tier into real gold, XP, scales, and fragments", () => {
    const save = initializeStarterRoster(createDefaultSave());
    const result = grantEndgameStageRewards(save, {
      mode: "scyllaRaid",
      stageId: "r08-s05",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.save.resources.gold).toBe(700);
    expect(result.save.resources.materials["raid-scale"]).toBe(4);
    expect(result.save.roster.heroShards["purr-ce"]).toBe(3);
    expect(result.rewards.heroXp).toBe(250);
  });
});
