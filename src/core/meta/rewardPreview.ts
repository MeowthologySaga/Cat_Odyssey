import { HERO_BY_ID, RELIC_BY_ID, STAGE_BY_ID } from "../../data";
import type { GameSaveV1 } from "../../state";
import { formatResourceAmount, resourceDisplayName } from "../../ui/resourceNames";
import { normalizeMetaSave } from "./compat";
import { FREE_RAID_KEY_STAGE_IDS, STORY_HERO_UNLOCKS_BY_STAGE } from "./rewards";
import { getRelicRewardModifiers } from "./relics";

export interface StageRewardPreview {
  readonly stageId: string;
  readonly repeatable: {
    readonly gold: number;
    readonly heroXp: number;
    readonly materials: Readonly<Record<string, number>>;
  };
  readonly firstClear: {
    readonly claimed: boolean;
    readonly kind: "hero" | "relic" | "fragment" | "material";
    readonly id: string;
    readonly name: string;
    readonly amount: number;
  };
  readonly storyHeroIds: readonly string[];
  readonly raidKeys: number;
}

export function getStageRewardPreview(
  input: GameSaveV1,
  stageId: string,
): StageRewardPreview | undefined {
  const stage = STAGE_BY_ID[stageId];
  if (!stage) return undefined;
  const save = normalizeMetaSave(input);
  const reward = stage.rewards.firstClear;
  const relicRewards = getRelicRewardModifiers(save);
  const name = reward.kind === "hero" || reward.kind === "fragment"
    ? HERO_BY_ID[reward.id]?.name ?? reward.id
    : reward.kind === "relic"
      ? RELIC_BY_ID[reward.id]?.name ?? reward.id
      : resourceDisplayName(reward.id);
  return {
    stageId,
    repeatable: {
      gold: Math.max(0, Math.round(stage.rewards.gold * relicRewards.goldMultiplier)),
      heroXp: stage.rewards.heroXp,
      materials: { ...stage.rewards.materials },
    },
    firstClear: {
      claimed: save.progress.claimedFirstClearStageIds.includes(stageId),
      kind: reward.kind,
      id: reward.id,
      name,
      amount: reward.kind === "material"
        ? Math.max(0, Math.ceil(reward.amount * relicRewards.firstClearMaterialMultiplier))
        : reward.amount,
    },
    storyHeroIds: [...(STORY_HERO_UNLOCKS_BY_STAGE[stageId] ?? [])],
    raidKeys: FREE_RAID_KEY_STAGE_IDS.has(stageId) && !save.progress.claimedFirstClearStageIds.includes(stageId) ? 1 : 0,
  };
}

export function formatMaterialRewards(materials: Readonly<Record<string, number>>): string {
  const entries = Object.entries(materials).filter(([, amount]) => amount > 0);
  return entries.length ? entries.map(([id, amount]) => formatResourceAmount(id, amount)).join(" · ") : "없음";
}

export function formatFirstClearPreview(preview: StageRewardPreview): string {
  if (preview.firstClear.claimed) return "첫 돌파 보상 수령 완료";
  const amount = preview.firstClear.kind === "hero" || preview.firstClear.kind === "relic"
    ? ""
    : ` ×${preview.firstClear.amount}`;
  const storyNames = preview.storyHeroIds
    // A fragment is currency for a hero, not the hero joining the crew. Only
    // an actual first-clear hero grant duplicates the story-unlock line.
    .filter((heroId) => preview.firstClear.kind !== "hero" || heroId !== preview.firstClear.id)
    .map((heroId) => HERO_BY_ID[heroId]?.name ?? heroId);
  return [
    `첫 돌파 · ${preview.firstClear.name}${amount}`,
    ...(storyNames.length ? [`스토리 승선 · ${storyNames.join(" · ")}`] : []),
    ...(preview.raidKeys ? [`무료 토벌 열쇠 ×${preview.raidKeys}`] : []),
  ].join("\n");
}
