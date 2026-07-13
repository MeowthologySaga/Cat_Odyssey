import { describe, expect, it } from "vitest";

import { STAGES } from "../../src/data";
import {
  CAMPAIGN_STAR_MILESTONES,
  completeCampaignStageWithRewards,
  getCampaignStarMilestoneProgress,
  reconcileCampaignStarMilestones,
  TITLE_BY_ID,
} from "../../src/core/meta";
import { createDefaultSave, normalizeSave, type GameSaveV1 } from "../../src/state";

function saveWithTotalStars(total: number): GameSaveV1 {
  const save = createDefaultSave();
  let remaining = Math.max(0, Math.min(STAGES.length * 3, Math.floor(total)));
  for (const stage of STAGES) {
    const stars = Math.min(3, remaining);
    if (stars > 0) save.progress.stageStars[stage.id] = stars;
    remaining -= stars;
  }
  return save;
}

describe("campaign star milestones", () => {
  it("defines an ordered title-bearing mastery track through all 129 campaign stars", () => {
    expect(CAMPAIGN_STAR_MILESTONES.map((milestone) => milestone.requiredStars))
      .toEqual([30, 60, 90, 120, 129]);
    expect(new Set(CAMPAIGN_STAR_MILESTONES.map((milestone) => milestone.id)).size).toBe(5);
    expect(new Set(CAMPAIGN_STAR_MILESTONES.map((milestone) => milestone.titleId)).size).toBe(5);
    expect(CAMPAIGN_STAR_MILESTONES.every((milestone) => Boolean(TITLE_BY_ID[milestone.titleId])))
      .toBe(true);
    expect(JSON.stringify(CAMPAIGN_STAR_MILESTONES)).not.toMatch(/diamond|wallet/i);
  });

  it("reconciles every already-qualified legacy milestone exactly once after a save round-trip", () => {
    const legacy = saveWithTotalStars(129);
    const before = JSON.stringify(legacy);
    const first = reconcileCampaignStarMilestones(legacy);

    expect(JSON.stringify(legacy)).toBe(before);
    expect(first.totalStars).toBe(129);
    expect(first.receipts.map((receipt) => receipt.requiredStars)).toEqual([30, 60, 90, 120, 129]);
    expect(first.save.resources).toMatchObject({
      gold: 27_000,
      awakeningMaterials: 11,
      relicDust: 500,
      fateDust: 60,
    });
    expect(first.save.endgame.raidKeys).toBe(3);
    expect(first.save.inventory.skinIds).toEqual(expect.arrayContaining(
      CAMPAIGN_STAR_MILESTONES.map((milestone) => milestone.titleId),
    ));

    const restarted = normalizeSave(JSON.parse(JSON.stringify(first.save)) as unknown);
    const second = reconcileCampaignStarMilestones(restarted);
    expect(second.receipts).toEqual([]);
    expect(second.save.resources).toEqual(first.save.resources);
    expect(second.save.endgame.raidKeys).toBe(first.save.endgame.raidKeys);
    expect(JSON.stringify(second.save)).not.toMatch(/diamondBalance|walletBalance|diamonds/i);
  });

  it("claims the 30-star reward in ordinary campaign settlement and never repeats it on replay", () => {
    let save = createDefaultSave();
    let thresholdReceipt: ReturnType<typeof completeCampaignStageWithRewards> | undefined;
    for (const stage of STAGES.slice(0, 10)) {
      const result = completeCampaignStageWithRewards(save, { stageId: stage.id, stars: 3 });
      expect(result.ok, stage.id).toBe(true);
      if (!result.ok) throw new Error(result.message);
      save = result.save;
      thresholdReceipt = result;
    }
    if (!thresholdReceipt?.ok) throw new Error("30-star settlement was not reached");
    expect(thresholdReceipt.rewards.starMilestones).toMatchObject([
      { milestoneId: "campaign-stars-030", requiredStars: 30, totalStars: 30 },
    ]);
    expect(save.inventory.skinIds).toContain("title:star-voyager");

    const goldBeforeReplay = save.resources.gold;
    const replay = completeCampaignStageWithRewards(save, {
      stageId: STAGES[9]!.id,
      stars: 3,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.message);
    expect(replay.rewards.starMilestones).toBeUndefined();
    expect(replay.save.resources.gold).toBe(goldBeforeReplay + replay.rewards.gold);
  });

  it("exposes pure collection progress without silently claiming rewards", () => {
    const save = saveWithTotalStars(61);
    save.inventory.skinIds.push("title:star-voyager");
    const before = JSON.stringify(save);
    const progress = getCampaignStarMilestoneProgress(save);

    expect(progress).toHaveLength(5);
    expect(progress[0]).toMatchObject({ requiredStars: 30, reached: true, claimed: true, remainingStars: 0 });
    expect(progress[1]).toMatchObject({ requiredStars: 60, reached: true, claimed: false, remainingStars: 0 });
    expect(progress[2]).toMatchObject({ requiredStars: 90, reached: false, claimed: false, remainingStars: 29 });
    expect(progress[4]).toMatchObject({ requiredStars: 129, currentStars: 61, remainingStars: 68 });
    expect(JSON.stringify(save)).toBe(before);
  });
});
