export type ContentId = string;

export type ElementId = "sea" | "sun" | "moon" | "storm" | "earth" | "spirit";
export type Rarity = 3 | 4 | 5;
export type RicochetClass = "bounce" | "pierce" | "heavy" | "burst" | "support";

export interface StatBlock {
  readonly hp: number;
  readonly attack: number;
  readonly speed: number;
}

export interface DataEffect {
  readonly kind: string;
  readonly value: number;
  readonly target: string;
  readonly condition?: string;
  readonly durationTurns?: number;
}

/**
 * A save-scaled relic effect embedded in an immutable battle hero definition.
 *
 * Authored heroes do not declare these fields. The meta layer adds them while
 * building a party so the deterministic runtime can consume equipped relics
 * without importing save state or relying on a scene-only singleton.
 */
export interface RuntimeRelicEffect extends DataEffect {
  readonly sourceId: string;
  readonly sourceLevel: number;
}

export interface HeroDefinition {
  readonly id: ContentId;
  readonly canonicalRefId: ContentId;
  readonly name: string;
  readonly original: string;
  readonly epithet: string;
  readonly rarity: Rarity;
  readonly element: ElementId;
  readonly ricochetClass: RicochetClass;
  readonly radius: number;
  readonly mass: number;
  readonly restitution: number;
  readonly stats: StatBlock;
  readonly friendshipSkill: {
    readonly name: string;
    readonly effects: readonly DataEffect[];
  };
  readonly activeSkill: {
    readonly name: string;
    readonly chargeTurns: number;
    readonly effects: readonly DataEffect[];
  };
  readonly unlock: "starter" | "story" | "summon";
  readonly visualKey: string;
  readonly tags: readonly string[];
  readonly runtimeRelicEffects?: readonly RuntimeRelicEffect[];
}

export type EnemyBehaviorId =
  | "charger"
  | "shooter"
  | "shield"
  | "heavy"
  | "support"
  | "splitter"
  | "summoner";

export interface EnemyBehaviorDefinition {
  readonly id: EnemyBehaviorId;
  readonly name: string;
  readonly telegraph: string;
  readonly resolution: string;
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
}

export interface EnemyDefinition {
  readonly id: ContentId;
  readonly name: string;
  readonly behaviorId: EnemyBehaviorId;
  readonly element: ElementId;
  readonly radius: number;
  readonly stats: StatBlock;
  readonly attackCountdown: number;
  readonly attack: {
    readonly kind: string;
    readonly power: number;
    readonly range: number;
    /** Optional per-enemy tuning overrides for the shared behavior contract. */
    readonly parameters?: Readonly<Record<string, number | string | boolean>>;
  };
  readonly boss: boolean;
  readonly visualKey: string;
  readonly tags: readonly string[];
}

export interface ArenaDefinition {
  readonly id: ContentId;
  readonly theme: string;
  readonly width: number;
  readonly height: number;
  /**
   * Stable stage-specific texture identity. When `backgroundAssetUrl` is
   * authored the battle scene loads this key before falling back to the route
   * plate, so multiple encounters on one route no longer need to share art.
   */
  readonly backgroundKey: string;
  readonly backgroundAssetUrl?: string;
  readonly musicKey: string;
}

/** Runtime art stays independent from collision and objective geometry. */
export interface ObjectPresentationDefinition {
  readonly visualId: ContentId;
  readonly width?: number;
  readonly height?: number;
  /** Phaser-normalized anchors. Tall props normally use anchorY near 0.82. */
  readonly anchorX?: number;
  readonly anchorY?: number;
  /** Semantic state -> visual asset id, for example `damaged` or `lashed`. */
  readonly stateVisualIds?: Readonly<Record<string, ContentId>>;
}

export interface WallDefinition {
  readonly id: ContentId;
  readonly shape: "segment" | "capsule" | "circle";
  readonly x: number;
  readonly y: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly radius?: number;
  readonly material: "stone" | "wood" | "coral" | "bronze" | "spirit";
  readonly restitution: number;
  readonly breakable?: boolean;
  readonly hp?: number;
  /** Optional art strip/prop aligned to this authoritative collider. */
  readonly presentation?: ObjectPresentationDefinition;
}

export type PropInteractionMode = "destructible" | "assembly" | "bond";

/**
 * A discriminated contract keeps UGC authors from mixing combat durability
 * with assembly contact counts. `maxHp` uses normal combat-scale hit points.
 */
export type PropInteractionDefinition =
  | {
    readonly mode: "destructible" | "bond";
    readonly maxHp: number;
  }
  | {
    readonly mode: "assembly";
    readonly hitsRequired: number;
    /** Completed pieces travel toward this in-arena construction slot. */
    readonly destination: { readonly x: number; readonly y: number };
  };

export interface SpawnDefinition {
  readonly id: ContentId;
  readonly kind: "party" | "enemy" | "boss" | "prop";
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly facing?: number;
  readonly presentation?: ObjectPresentationDefinition;
  readonly interaction?: PropInteractionDefinition;
}

export interface StageEnemyPlacement {
  readonly enemyId: ContentId;
  readonly spawnId: ContentId;
  readonly level: number;
  readonly elite?: boolean;
}

export interface HazardDefinition {
  readonly id: ContentId;
  readonly type:
    | "slow-field"
    | "wind-vector"
    | "current"
    | "whirlpool"
    | "sound-wave"
    | "portal"
    | "lightning"
    | "forbidden-target"
    | "moving-bumper"
    | "one-way-wall"
    | "wave-front";
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
}

export interface ObjectiveDefinition {
  readonly type: "defeat-all" | "break-parts" | "assemble" | "survive" | "protect" | "seal" | "escape";
  readonly turnLimit: number;
  readonly targetIds: readonly ContentId[];
  readonly requiredCount?: number;
}

export interface RewardDefinition {
  readonly gold: number;
  readonly heroXp: number;
  readonly materials: Readonly<Record<string, number>>;
  readonly firstClear: {
    readonly kind: "hero" | "relic" | "fragment" | "material";
    readonly id: ContentId;
    readonly amount: number;
  };
}

export interface BossPartDefinition {
  readonly id: ContentId;
  readonly kind: "body" | "eye" | "head" | "neck" | "forepaw" | "shield" | "core";
  readonly count: number;
  readonly collider: "circle" | "capsule" | "polygon";
  readonly weakpoint: boolean;
  readonly breakable: boolean;
}

export interface BossDefinition {
  readonly bossId: ContentId;
  readonly supportBossIds: readonly ContentId[];
  readonly phaseIds: readonly ContentId[];
  readonly anatomy: {
    readonly eyes?: number;
    readonly heads?: number;
    readonly necks?: number;
    readonly forepaws?: number;
  };
  readonly parts: readonly BossPartDefinition[];
}

export interface StageDefinition {
  readonly id: ContentId;
  readonly routeId: ContentId;
  readonly order: number;
  readonly name: string;
  readonly recommendedPower: number;
  readonly arena: ArenaDefinition;
  readonly walls: readonly WallDefinition[];
  readonly spawns: readonly SpawnDefinition[];
  readonly enemies: readonly StageEnemyPlacement[];
  readonly hazards: readonly HazardDefinition[];
  readonly objective: ObjectiveDefinition;
  readonly rewards: RewardDefinition;
  readonly modifiers: readonly string[];
  readonly boss: BossDefinition | null;
}

export interface RouteDefinition {
  readonly id: ContentId;
  readonly order: number;
  readonly name: string;
  readonly originalBeat: string;
  readonly biome: string;
  readonly signatureMechanic: string;
  readonly coreRoute: boolean;
  readonly stageIds: readonly ContentId[];
  readonly bossId: ContentId;
}

export interface BlessingDefinition {
  readonly id: ContentId;
  readonly name: string;
  readonly deity: ContentId;
  readonly rarity: "common" | "rare" | "epic";
  readonly tags: readonly string[];
  readonly effects: readonly DataEffect[];
}

export interface RelicDefinition {
  readonly id: ContentId;
  readonly name: string;
  readonly tier: 1 | 2 | 3;
  readonly set: string;
  readonly tags: readonly string[];
  readonly effects: readonly DataEffect[];
}

export interface OracleFloorDefinition {
  readonly id: ContentId;
  readonly floor: number;
  readonly stageId: ContentId;
  readonly recommendedPower: number;
  readonly modifiers: readonly string[];
  readonly bossFloor: boolean;
  readonly lockoutFloors: number;
  readonly reward: {
    readonly kind: "material" | "fragment" | "relic" | "title";
    readonly id: ContentId;
    readonly amount: number;
  };
}

export interface StormNodeDefinition {
  readonly index: number;
  readonly type: "battle" | "elite" | "harbor" | "blessing" | "curse" | "boss";
  readonly pool: readonly ContentId[];
  readonly rewardScale: number;
  readonly rules: readonly string[];
}

export interface StormRouteDefinition {
  readonly id: ContentId;
  readonly nodeCount: 12;
  readonly weeklySeedFormat: string;
  readonly fallenHeroLock: boolean;
  readonly nodes: readonly StormNodeDefinition[];
}

export interface RaidPartyPhaseDefinition {
  readonly party: 1 | 2 | 3;
  readonly name: string;
  readonly objective: ObjectiveDefinition;
  readonly bossParts: readonly ContentId[];
  readonly carryForward: readonly string[];
}

export interface RaidDefinition {
  readonly id: ContentId;
  readonly name: string;
  readonly bossId: ContentId;
  readonly partiesRequired: 3;
  readonly heroesPerParty: 4;
  readonly duplicateHeroesAllowed: false;
  readonly anatomy: {
    readonly eyes?: number;
    readonly heads?: number;
    readonly necks?: number;
    readonly forepaws?: number;
  };
  readonly phases: readonly RaidPartyPhaseDefinition[];
  readonly weeklyRewards: readonly RewardDefinition[];
}

export interface EndgameCatalogDefinition {
  readonly oracleTower: {
    readonly id: ContentId;
    readonly name: string;
    readonly floors: readonly OracleFloorDefinition[];
  };
  readonly stormRoute: StormRouteDefinition;
  readonly raid: RaidDefinition;
}
