import { describe, expect, it } from "vitest";

import { craftRaidKey, RAID_KEY_CRAFT_COST, selectTitle, titleDescription, titleDisplayName } from "../../src/core/meta";
import { createDefaultSave } from "../../src/state";

describe("earnable raid keys", () => {
  it("crafts a raid key from repeatable Scylla campaign loot and gold", () => {
    const save = createDefaultSave();
    save.resources.gold = RAID_KEY_CRAFT_COST.gold;
    save.resources.materials[RAID_KEY_CRAFT_COST.materialId] = RAID_KEY_CRAFT_COST.materialAmount;
    const result = craftRaidKey(save);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.save.endgame.raidKeys).toBe(1);
    expect(result.save.resources.gold).toBe(0);
    expect(result.save.resources.materials[RAID_KEY_CRAFT_COST.materialId]).toBe(0);
  });

  it("does not mutate resources when crafting requirements are missing", () => {
    const save = createDefaultSave();
    save.resources.gold = 999;
    save.resources.materials[RAID_KEY_CRAFT_COST.materialId] = 100;
    const before = JSON.stringify(save);
    expect(craftRaidKey(save)).toMatchObject({ ok: false, code: "insufficient_gold" });
    expect(JSON.stringify(save)).toBe(before);
  });

  it("makes earned title rewards selectable and player-facing", () => {
    const save = createDefaultSave();
    save.inventory.skinIds.push("title:oracle-sixfold");
    const selected = selectTitle(save, "title:oracle-sixfold");
    expect(selected.inventory.selectedTitleId).toBe("title:oracle-sixfold");
    expect(titleDisplayName(selected.inventory.selectedTitleId)).toBe("여섯 운명을 읽은 자");
    expect(selectTitle(selected, "title:not-owned").inventory.selectedTitleId).toBeNull();
    expect(titleDisplayName("title:strait-bond")).toBe("해협의 인연");
    expect(titleDescription("title:strait-bond")).toContain("인연 20");
    expect(titleDisplayName("title:scylla-confidant")).toBe("스킬라의 벗");
  });
});
