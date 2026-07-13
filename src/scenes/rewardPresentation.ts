import type { CampaignStarMilestoneReceipt } from "../core/meta/campaignStarMilestones";
import { titleDisplayName } from "../core/meta/titles";

export interface RewardStarRevealPlan {
  readonly animate: boolean;
  readonly initialScale: number;
  readonly targetAngle: number;
  readonly duration: number;
  readonly delay: number;
}

export interface RewardMilestoneRevealPlan {
  readonly animate: boolean;
  readonly initialAlpha: number;
  readonly duration: number;
  readonly delay: number;
}

export interface RewardMilestoneBanner {
  readonly headline: string;
  readonly detail: string;
}

export function rewardStarRevealPlan(reducedMotion: boolean, index: number): RewardStarRevealPlan {
  if (reducedMotion) {
    return { animate: false, initialScale: 1, targetAngle: 0, duration: 0, delay: 0 };
  }
  return {
    animate: true,
    initialScale: 0,
    targetAngle: index % 2 ? 8 : -8,
    duration: 360,
    delay: 180 + Math.max(0, index) * 180,
  };
}

export function rewardMilestoneRevealPlan(reducedMotion: boolean): RewardMilestoneRevealPlan {
  return reducedMotion
    ? { animate: false, initialAlpha: 1, duration: 0, delay: 0 }
    : { animate: true, initialAlpha: 0, duration: 320, delay: 680 };
}

export function formatRewardMilestoneBanner(
  receipts: readonly CampaignStarMilestoneReceipt[] | undefined,
): RewardMilestoneBanner | undefined {
  if (!receipts?.length) return undefined;
  const newest = receipts.at(-1)!;
  const title = titleDisplayName(newest.titleId) ?? newest.titleId;
  const rewardTotals = receipts.reduce(
    (totals, receipt) => ({
      gold: totals.gold + (receipt.rewards.gold ?? 0),
      awakeningMaterials: totals.awakeningMaterials + (receipt.rewards.awakeningMaterials ?? 0),
      relicDust: totals.relicDust + (receipt.rewards.relicDust ?? 0),
      fateDust: totals.fateDust + (receipt.rewards.fateDust ?? 0),
      raidKeys: totals.raidKeys + (receipt.rewards.raidKeys ?? 0),
    }),
    { gold: 0, awakeningMaterials: 0, relicDust: 0, fateDust: 0, raidKeys: 0 },
  );
  const resources = [
    rewardTotals.gold ? `골드 +${rewardTotals.gold.toLocaleString()}` : "",
    rewardTotals.awakeningMaterials ? `각성석 +${rewardTotals.awakeningMaterials}` : "",
    rewardTotals.relicDust ? `유물 가루 +${rewardTotals.relicDust}` : "",
    rewardTotals.fateDust ? `운명 가루 +${rewardTotals.fateDust}` : "",
    rewardTotals.raidKeys ? `토벌 열쇠 +${rewardTotals.raidKeys}` : "",
  ].filter(Boolean);
  const visibleResources = resources.slice(0, 2);
  const hiddenResourceCount = resources.length - visibleResources.length;
  const resourceSummary = [
    ...visibleResources,
    ...(hiddenResourceCount > 0 ? [`외 ${hiddenResourceCount}종`] : []),
  ].join(" · ");
  return {
    headline: receipts.length > 1
      ? `별 항해 ${newest.requiredStars}★ 달성 · 마일스톤 ${receipts.length}개 연속 해금`
      : `별 항해 ${newest.requiredStars}★ 마일스톤 달성`,
    detail: `칭호 ‘${title}’${resourceSummary ? ` · ${resourceSummary}` : ""}`,
  };
}
