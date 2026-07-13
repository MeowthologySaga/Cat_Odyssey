import type { GameSaveV1 } from "../../state/saveSchema";
import { assertNoWalletState, normalizeMetaSave } from "./compat";

export interface TitleDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly unlockCondition: string;
}

/** Canonical player-facing title catalog. Ownership remains save-derived. */
export const TITLE_CATALOG: readonly TitleDefinition[] = Object.freeze([
  {
    id: "title:oracle-sixfold",
    name: "여섯 운명을 읽은 자",
    description: "신탁탑에서 여섯 갈래 운명을 읽어 낸 선장",
    unlockCondition: "신탁탑 29층 돌파",
  },
  {
    id: "title:athenas-chosen",
    name: "아포나가 선택한 선장",
    description: "마지막 신탁을 증명해 아포나의 인정을 받은 선장",
    unlockCondition: "신탁탑 30층 돌파",
  },
  {
    id: "title:strait-bond",
    name: "해협의 인연",
    description: "스킬라 항해 인연 20을 달성한 해협의 동행자",
    unlockCondition: "스킬라 항해 인연 20 달성",
  },
  {
    id: "title:scylla-confidant",
    name: "스킬라의 벗",
    description: "스킬라 항해 인연 75를 달성한 오랜 벗",
    unlockCondition: "스킬라 항해 인연 75 달성",
  },
  {
    id: "title:star-voyager",
    name: "별을 좇는 항해자",
    description: "수많은 해역에서 별 30개를 모아 항로를 밝힌 항해자",
    unlockCondition: "캠페인 별 30개 달성",
  },
  {
    id: "title:wave-reader",
    name: "파도를 읽는 선장",
    description: "캠페인 별 60개를 모아 바다의 변화를 읽어 낸 선장",
    unlockCondition: "캠페인 별 60개 달성",
  },
  {
    id: "title:fate-ricocheter",
    name: "운명을 되튕긴 자",
    description: "캠페인 별 90개를 모아 불리한 운명마저 반사한 명사수",
    unlockCondition: "캠페인 별 90개 달성",
  },
  {
    id: "title:homecoming-navigator",
    name: "귀향의 별잡이",
    description: "캠페인 별 120개로 마지막 귀향길까지 밝혀 낸 항해사",
    unlockCondition: "캠페인 별 120개 달성",
  },
  {
    id: "title:all-stars-captain",
    name: "별바다의 정복자",
    description: "43개 해역의 별 129개를 모두 거머쥔 완전한 항해의 증표",
    unlockCondition: "모든 캠페인 스테이지 3성 달성 (129개)",
  },
]);

export const TITLE_BY_ID: Readonly<Record<string, TitleDefinition>> = Object.freeze(
  Object.fromEntries(TITLE_CATALOG.map((title) => [title.id, title])),
);

export function getOwnedTitleIds(input: GameSaveV1): readonly string[] {
  return input.inventory.skinIds.filter((id) => id.startsWith("title:"));
}

export function titleDisplayName(titleId: string | null): string | undefined {
  if (!titleId) return undefined;
  return TITLE_BY_ID[titleId]?.name ?? titleId.replace(/^title:/, "").replaceAll("-", " ");
}

export function titleDescription(titleId: string | null): string | undefined {
  if (!titleId) return undefined;
  return TITLE_BY_ID[titleId]?.description;
}

export function selectTitle(input: GameSaveV1, titleId: string | null): GameSaveV1 {
  const save = normalizeMetaSave(input);
  save.inventory.selectedTitleId = titleId && getOwnedTitleIds(save).includes(titleId) ? titleId : null;
  assertNoWalletState(save);
  return save;
}
