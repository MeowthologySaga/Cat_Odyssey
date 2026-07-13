import { describe, expect, it } from "vitest";

import {
  createBattleHeroDefinition,
  equipRelic,
  getBattleRelicModifiers,
  getLockedRelicMaterialIds,
  getRelicProgress,
  planRelicMaterialConsumption,
  refineMaterial,
  relicEffectLevelSummary,
  relicEffectSupport,
  setRelicMaterialLocked,
  unequipRelic,
  upgradeRelic,
} from "../../src/core/meta";
import { HERO_BY_ID, RELICS, RELIC_BY_ID } from "../../src/data";
import { createDefaultSave, normalizeSave } from "../../src/state";

describe("relic loadout and material sinks", () => {
  it("equips at most three owned relics and applies an immediate combat modifier", () => {
    let save = createDefaultSave();
    save.inventory.relicIds = [
      "relic-ithacan-bow",
      "relic-olive-bedpost",
      "relic-argos-collar",
      "relic-cyclops-cup",
    ];
    for (const relicId of save.inventory.relicIds.slice(0, 3)) {
      const result = equipRelic(save, relicId);
      expect("schemaVersion" in result).toBe(true);
      if (!("schemaVersion" in result)) throw new Error(result.message);
      save = result;
    }
    const full = equipRelic(save, "relic-cyclops-cup");
    expect(full).toMatchObject({ ok: false, code: "relic_loadout_full" });
    const modifiers = getBattleRelicModifiers(save);
    expect(modifiers.equippedRelicIds).toHaveLength(3);
    expect(modifiers.effects).toHaveLength(3);
    expect(modifiers.stats.hp + modifiers.stats.attack + modifiers.stats.speed).toBeGreaterThan(3);

    const unequipped = unequipRelic(save, "relic-olive-bedpost");
    expect("schemaVersion" in unequipped).toBe(true);
    if (!("schemaVersion" in unequipped)) throw new Error(unequipped.message);
    expect(unequipped.inventory.equippedRelicIds).not.toContain("relic-olive-bedpost");
  });

  it("spends gold, dust, and any voyage materials to refine a relic", () => {
    const save = createDefaultSave();
    save.inventory.relicIds = ["relic-ithacan-bow"];
    save.resources.gold = 10_000;
    save.resources.relicDust = 1_000;
    save.resources.materials = { "sea-ore": 2, "wind-silk": 8 };
    const result = upgradeRelic(save, "relic-ithacan-bow");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.relic.level).toBe(2);
    expect(result.save.resources.gold).toBeLessThan(save.resources.gold);
    expect(result.save.resources.relicDust).toBeLessThan(save.resources.relicDust);
    expect(Object.values(result.consumedMaterials).reduce((sum, value) => sum + value, 0)).toBe(2);
    expect(getRelicProgress(result.save, "relic-ithacan-bow")?.level).toBe(2);
  });

  it("turns otherwise unused material stacks into relic dust and round-trips the loadout", () => {
    const save = createDefaultSave();
    save.inventory.relicIds = ["relic-storm-compass"];
    save.inventory.equippedRelicIds = ["relic-storm-compass"];
    save.inventory.relicLevels = { "relic-storm-compass": 3 };
    save.resources.materials["storm-glass"] = 7;
    const refined = refineMaterial(save, "storm-glass", 5);
    expect(refined.ok).toBe(true);
    if (!refined.ok) throw new Error(refined.message);
    expect(refined.save.resources.materials["storm-glass"]).toBe(2);
    expect(refined.save.resources.relicDust).toBe(25);
    const roundTrip = normalizeSave(JSON.parse(JSON.stringify(refined.save)));
    expect(roundTrip.inventory.equippedRelicIds).toEqual(["relic-storm-compass"]);
    expect(roundTrip.inventory.relicLevels["relic-storm-compass"]).toBe(3);
  });

  it("embeds scaled runtime effects and reports every authored passive as connected", () => {
    const save = createDefaultSave();
    save.roster.ownedHeroIds = ["meow-dysseus"];
    save.inventory.relicIds = ["relic-ithacan-bow"];
    save.inventory.equippedRelicIds = ["relic-ithacan-bow"];
    save.inventory.relicLevels = { "relic-ithacan-bow": 3 };

    const battleHero = createBattleHeroDefinition(save, HERO_BY_ID["meow-dysseus"]!);
    expect(battleHero.runtimeRelicEffects).toContainEqual(expect.objectContaining({
      sourceId: "relic-ithacan-bow",
      sourceLevel: 3,
      kind: "weakpoint-damage",
      value: 16.8,
    }));
    expect(relicEffectLevelSummary(RELIC_BY_ID["relic-ithacan-bow"]!, 1)).toContain("+12% → +14.4%");
    expect(relicEffectLevelSummary(RELIC_BY_ID["relic-sea-foam-jar"]!, 1)).not.toContain("현재 미연결");
    const authoredKinds = [...new Set(RELICS.flatMap((relic) => relic.effects.map((effect) => effect.kind)))];
    expect(authoredKinds.filter((kind) => relicEffectSupport(kind) === "unsupported")).toEqual([]);
  });

  it("previews exact material consumption and never spends locked stacks", () => {
    let save = createDefaultSave();
    save.inventory.relicIds = ["relic-ithacan-bow"];
    save.resources.gold = 10_000;
    save.resources.relicDust = 1_000;
    save.resources.materials = { "voyage-knot": 1, "sea-ore": 5 };
    save = setRelicMaterialLocked(save, "voyage-knot", true);
    expect(getLockedRelicMaterialIds(save)).toEqual(["voyage-knot"]);
    expect(planRelicMaterialConsumption(save, 2)).toMatchObject({
      sufficient: true,
      availableUnits: 5,
      consumedMaterials: { "sea-ore": 2 },
    });
    const result = upgradeRelic(save, "relic-ithacan-bow");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.consumedMaterials).toEqual({ "sea-ore": 2 });
    expect(result.save.resources.materials).toMatchObject({ "voyage-knot": 1, "sea-ore": 3 });
  });
});
