import type { GameSaveV1 } from "../../state/saveSchema";

export type MetaFailureCode =
  | "unknown_stage"
  | "stage_locked"
  | "unknown_hero"
  | "hero_not_owned"
  | "invalid_party"
  | "invalid_amount"
  | "level_cap"
  | "max_ascension"
  | "ascension_level_required"
  | "insufficient_gold"
  | "insufficient_shards"
  | "insufficient_awakening_materials"
  | "unknown_relic"
  | "relic_not_owned"
  | "relic_loadout_full"
  | "relic_already_equipped"
  | "relic_not_equipped"
  | "max_relic_level"
  | "insufficient_relic_dust"
  | "insufficient_materials"
  | "invalid_banner";

export interface MetaFailure {
  readonly ok: false;
  readonly code: MetaFailureCode;
  readonly message: string;
  readonly save: GameSaveV1;
}

export interface CampaignStageView {
  readonly stageId: string;
  readonly routeId: string;
  readonly unlocked: boolean;
  readonly completed: boolean;
  readonly stars: 0 | 1 | 2 | 3;
}

export interface CampaignRouteView {
  readonly routeId: string;
  readonly unlocked: boolean;
  readonly completedStages: number;
  readonly stageCount: number;
  readonly stars: number;
  readonly completed: boolean;
}

export interface HeroProgressView {
  readonly heroId: string;
  readonly owned: boolean;
  readonly level: number;
  readonly xp: number;
  readonly ascension: number;
  readonly levelCap: number;
  readonly shards: number;
}

export type PartyIssueCode =
  | "party_size"
  | "duplicate_hero"
  | "unknown_hero"
  | "hero_not_owned";

export interface PartyValidationIssue {
  readonly code: PartyIssueCode;
  readonly heroId?: string;
  readonly message: string;
}

export interface PartyValidationResult {
  readonly valid: boolean;
  readonly heroIds: readonly string[];
  readonly issues: readonly PartyValidationIssue[];
}

export interface SummonPullResult {
  readonly index: number;
  readonly heroId: string;
  readonly rarity: 3 | 4 | 5;
  readonly featured: boolean;
  readonly duplicate: boolean;
  /** Story heroes yield shards until their canonical story join has occurred. */
  readonly storyLocked: boolean;
  readonly heroGranted: boolean;
  readonly shardsGranted: number;
  readonly pityBefore: number;
  readonly pityAfter: number;
}

export interface SummonTransactionResult {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly bannerId: string;
  readonly seed: string;
  readonly pulls: readonly SummonPullResult[];
  readonly pityAfter: number;
  readonly guaranteedFeaturedAfter: boolean;
}

export interface UpgradeCost {
  readonly gold: number;
  readonly shards: number;
  readonly awakeningMaterials: number;
}

export interface UpgradeSuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly hero: HeroProgressView;
  readonly cost: UpgradeCost;
}

export type UpgradeResult = UpgradeSuccess | MetaFailure;

export type EndgameModeId = "oracleTower" | "stormRoute" | "scyllaRaid";

export interface EndgameGateStatus {
  readonly id: EndgameModeId;
  readonly unlocked: boolean;
  readonly reasons: readonly string[];
  readonly progress: Readonly<Record<string, number | boolean>>;
}

export interface EndgameGateCollection {
  readonly oracleTower: EndgameGateStatus;
  readonly stormRoute: EndgameGateStatus;
  readonly scyllaRaid: EndgameGateStatus;
}
