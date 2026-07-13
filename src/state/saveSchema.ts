import {
  getDiamondAction,
  isDiamondActionId,
  type DiamondActionId,
} from "../platform/diamondActions";
import {
  DEFAULT_AUDIO_VOLUMES,
  normalizeRememberedAudioVolume,
} from "./audioVolume";

export const SAVE_SCHEMA_VERSION = 1 as const;

export type GameLanguage = "ko" | "en";
export type EnemyActionTempoSetting = 1 | 1.5 | 2;
export type TextScale = 100 | 115;
export type ColorVisionMode = "off" | "deuteranopia" | "tritanopia";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type PendingPurchasePhase = "spending" | "spent";

export type PendingPurchase = {
  purchaseId: string;
  actionId: DiamondActionId;
  idempotencyKey: string;
  phase: PendingPurchasePhase;
  createdAt: number;
  updatedAt: number;
  reward: JsonObject;
  transactionId?: string;
};

export type PurchaseReceipt = {
  purchaseId: string;
  actionId: DiamondActionId;
  transactionId: string;
  committedAt: number;
};

export type SummonHistoryEntry = {
  summonId: string;
  bannerId: string;
  heroId: string;
  rarity: 3 | 4 | 5;
  featured: boolean;
  duplicate: boolean;
  createdAt: number;
};

export type BattleRescueMode = "campaign" | "oracle" | "storm" | "raid";

export type PendingBattleRescue = {
  version: 1;
  purchaseId: string;
  mode: BattleRescueMode;
  stageId: string;
  deployedHeroIds: string[];
  /** Fully derived pre-mode hero definitions freeze levels and relic effects. */
  partyDefinitions: string;
  /** Compatibility fingerprint for authored stage/enemy/behavior data. */
  contentRevision: string;
  battleSnapshot: string;
  hpRatio: number;
  createdAt: number;
};

/**
 * A deterministic checkpoint for an ordinary campaign battle.
 *
 * Checkpoints are intentionally kept separate from paid defeat rescue data: a
 * resume checkpoint is written only at a clean player-input boundary, while a
 * rescue snapshot represents a defeated run after a committed purchase.
 */
export type ActiveCampaignBattle = {
  version: 1;
  stageId: string;
  deployedHeroIds: string[];
  /** Fully derived hero definitions freeze levels/relic effects for exact replay. */
  partyDefinitions: string;
  /** Hash of authored stage, enemy, and behavior data used by this checkpoint. */
  contentRevision: string;
  battleSnapshot: string;
  savedAt: number;
};

/**
 * Durable hand-off between an ordinary campaign victory and RewardScene.
 *
 * The reward ticket token and presentation metrics are frozen before leaving
 * BattleScene. RewardScene can therefore deterministically settle the same
 * victory after a reload without replaying the final turn.
 */
export type PendingCampaignVictorySettlement = {
  version: 1;
  stageId: string;
  rewardTicketToken: number;
  stars: 1 | 2 | 3;
  turns: number;
  bestCombo: number;
  totalDamage: number;
  hpRatio: number;
  partyHeroIds: string[];
  fallenHeroIds: string[];
  wonAt: number;
};

export type EndgameVictoryMode = "oracleTower" | "stormRoute" | "scyllaRaid";

/**
 * Durable, exactly-once hand-off for every endgame victory, including the two
 * intermediate Scylla phases.  The content and run-state revisions make stale
 * scene data incapable of settling a different floor, storm node, or raid
 * phase after a reload.
 */
export type PendingEndgameVictorySettlement = {
  version: 1;
  mode: EndgameVictoryMode;
  stageId: string;
  rewardTicketToken: number;
  stars: 1 | 2 | 3;
  turns: number;
  bestCombo: number;
  totalDamage: number;
  hpRatio: number;
  partyHeroIds: string[];
  fallenHeroIds: string[];
  /** Final Scylla rewards are shared by all three frozen raid squads. */
  rewardHeroIds: string[];
  weeklyScoreEnabled: boolean;
  /** Floor, storm node, or Scylla phase index at the moment of victory. */
  contextIndex: number;
  /** Completed tower floors, weekly storm runs, or completed Scylla raids. */
  runOrdinal: number;
  stormWeekId: number | null;
  scyllaPhaseIndex: 0 | 1 | 2 | null;
  contentRevision: string;
  runStateRevision: string;
  wonAt: number;
};

export type GameSaveV1 = {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  progress: {
    completedStageIds: string[];
    claimedFirstClearStageIds: string[];
    stageStars: Record<string, number>;
    unlockedRouteIds: string[];
    activeRouteId: string | null;
    campaignComplete: boolean;
  };
  roster: {
    ownedHeroIds: string[];
    partyHeroIds: string[];
    /** Three reusable 1-3 hero formations. Empty rows are unused preset slots. */
    partyPresets: string[][];
    heroXp: Record<string, number>;
    heroLevels: Record<string, number>;
    heroShards: Record<string, number>;
    heroAwakening: Record<string, number>;
  };
  resources: {
    gold: number;
    materials: Record<string, number>;
    awakeningMaterials: number;
    relicDust: number;
    fateDust: number;
    vaultSlots: number;
  };
  inventory: {
    relicIds: string[];
    equippedRelicIds: string[];
    relicLevels: Record<string, number>;
    skinIds: string[];
    selectedTitleId: string | null;
  };
  summons: {
    oraclePulls: number;
    pityCount: number;
    guaranteedFeatured: boolean;
    history: SummonHistoryEntry[];
  };
  recovery: {
    pendingBattleRescue: PendingBattleRescue | null;
    activeCampaignBattle: ActiveCampaignBattle | null;
    pendingCampaignVictorySettlement: PendingCampaignVictorySettlement | null;
    pendingEndgameVictorySettlement: PendingEndgameVictorySettlement | null;
  };
  endgame: {
    oracleTowerFloor: number;
    oracleHeroLockUntilFloor: Record<string, number>;
    weeklyStormRuns: number;
    raidKeys: number;
    bossAffinity: Record<string, number>;
    stormRoute: {
      weekId: number;
      nodeIndex: number;
      active: boolean;
      entryPaid: boolean;
      blessingIds: string[];
      blessingOfferIds: string[];
      blessingRerollCount: number;
      curseIds: string[];
      fallenHeroIds: string[];
      partyHeroIds: string[];
      swapCharges: number;
      selectedStageId: string | null;
    };
    scyllaRaid: {
      active: boolean;
      phaseIndex: number;
      squads: string[][];
      carryForward: string[];
    };
  };
  pendingPurchases: PendingPurchase[];
  purchaseReceipts: PurchaseReceipt[];
  settings: {
    language: GameLanguage;
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    lastNonZeroMasterVolume: number;
    lastNonZeroMusicVolume: number;
    lastNonZeroSfxVolume: number;
    reducedMotion: boolean;
    screenShake: boolean;
    aimAssist: boolean;
    enemyActionTempo: EnemyActionTempoSetting;
    textScale: TextScale;
    highContrast: boolean;
    colorVision: ColorVisionMode;
  };
  records: {
    wins: number;
    losses: number;
    bestRicochetChain: number;
    totalDamage: number;
    lastPlayedAt: number;
  };
};

export class UnsupportedSaveSchemaError extends Error {
  constructor(readonly schemaVersion: number) {
    super(`Unsupported save schema version: ${schemaVersion}`);
    this.name = "UnsupportedSaveSchemaError";
  }
}

export function createDefaultSave(): GameSaveV1 {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    progress: {
      completedStageIds: [],
      claimedFirstClearStageIds: [],
      stageStars: {},
      unlockedRouteIds: ["route-01-ogygia"],
      activeRouteId: "route-01-ogygia",
      campaignComplete: false
    },
    roster: {
      ownedHeroIds: ["meow-dysseus"],
      partyHeroIds: ["meow-dysseus"],
      partyPresets: [[], [], []],
      heroXp: {},
      heroLevels: {},
      heroShards: {},
      heroAwakening: {}
    },
    resources: {
      gold: 0,
      materials: {},
      awakeningMaterials: 0,
      relicDust: 0,
      fateDust: 0,
      vaultSlots: 20
    },
    inventory: {
      relicIds: [],
      equippedRelicIds: [],
      relicLevels: {},
      skinIds: [],
      selectedTitleId: null
    },
    summons: {
      oraclePulls: 0,
      pityCount: 0,
      guaranteedFeatured: false,
      history: []
    },
    recovery: {
      pendingBattleRescue: null,
      activeCampaignBattle: null,
      pendingCampaignVictorySettlement: null,
      pendingEndgameVictorySettlement: null
    },
    endgame: {
      oracleTowerFloor: 0,
      oracleHeroLockUntilFloor: {},
      weeklyStormRuns: 0,
      raidKeys: 0,
      bossAffinity: {},
      stormRoute: {
        weekId: 0,
        nodeIndex: 0,
        active: false,
        entryPaid: false,
        blessingIds: [],
        blessingOfferIds: [],
        blessingRerollCount: 0,
        curseIds: [],
        fallenHeroIds: [],
        partyHeroIds: [],
        swapCharges: 0,
        selectedStageId: null
      },
      scyllaRaid: {
        active: false,
        phaseIndex: 0,
        squads: [],
        carryForward: []
      }
    },
    pendingPurchases: [],
    purchaseReceipts: [],
    settings: {
      language: "ko",
      masterVolume: DEFAULT_AUDIO_VOLUMES.masterVolume,
      musicVolume: DEFAULT_AUDIO_VOLUMES.musicVolume,
      sfxVolume: DEFAULT_AUDIO_VOLUMES.sfxVolume,
      lastNonZeroMasterVolume: DEFAULT_AUDIO_VOLUMES.masterVolume,
      lastNonZeroMusicVolume: DEFAULT_AUDIO_VOLUMES.musicVolume,
      lastNonZeroSfxVolume: DEFAULT_AUDIO_VOLUMES.sfxVolume,
      reducedMotion: false,
      screenShake: true,
      aimAssist: true,
      enemyActionTempo: 1.5,
      textScale: 100,
      highContrast: false,
      colorVision: "off"
    },
    records: {
      wins: 0,
      losses: 0,
      bestRicochetChain: 0,
      totalDamage: 0,
      lastPlayedAt: 0
    }
  };
}

export const DEFAULT_SAVE: GameSaveV1 = deepFreeze(createDefaultSave());

export function cloneSave(save: GameSaveV1): GameSaveV1 {
  if (typeof structuredClone === "function") {
    return structuredClone(save);
  }
  return JSON.parse(JSON.stringify(save)) as GameSaveV1;
}

/**
 * Converts schema-less prototype saves and schema v1 data into the canonical v1 shape.
 * Unknown fields are intentionally dropped; this also guarantees that wallet balance is
 * never copied into the game save.
 */
export function migrateSave(raw: unknown): GameSaveV1 {
  const source = asRecord(raw);
  const rawVersion = asFiniteNumber(source?.schemaVersion, 0);
  if (rawVersion > SAVE_SCHEMA_VERSION) {
    throw new UnsupportedSaveSchemaError(rawVersion);
  }
  return normalizeSave(source);
}

export function normalizeSave(raw: unknown): GameSaveV1 {
  const defaults = createDefaultSave();
  const source = asRecord(raw) ?? {};
  const progress = asRecord(source.progress) ?? {};
  const roster = asRecord(source.roster) ?? asRecord(source.heroes) ?? {};
  const resources = asRecord(source.resources) ?? {};
  const inventory = asRecord(source.inventory) ?? {};
  const summons = asRecord(source.summons) ?? {};
  const recovery = asRecord(source.recovery) ?? {};
  const endgame = asRecord(source.endgame) ?? {};
  const stormRoute = asRecord(endgame.stormRoute) ?? {};
  const scyllaRaid = asRecord(endgame.scyllaRaid) ?? {};
  const settings = asRecord(source.settings) ?? {};
  const records = asRecord(source.records) ?? {};
  const legacyBossAffinity = nonNegativeIntegerRecord(endgame.bossAffinity);

  const legacyPending = source.pendingPurchase ? [source.pendingPurchase] : [];
  const pendingSource = Array.isArray(source.pendingPurchases)
    ? source.pendingPurchases
    : legacyPending;
  const masterVolume = clampNumber(
    settings.masterVolume,
    0,
    1,
    defaults.settings.masterVolume,
  );
  const musicVolume = clampNumber(
    settings.musicVolume,
    0,
    1,
    defaults.settings.musicVolume,
  );
  const sfxVolume = clampNumber(
    settings.sfxVolume,
    0,
    1,
    defaults.settings.sfxVolume,
  );

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    progress: {
      completedStageIds: uniqueStrings(
        progress.completedStageIds ?? source.completedStageIds ?? source.completedStages
      ),
      claimedFirstClearStageIds: uniqueStrings(
        progress.claimedFirstClearStageIds ?? source.claimedFirstClearStageIds
      ),
      stageStars: mergeLegacyIntegerRecord(
        progress.stageStars ?? source.stageStars,
        legacyBossAffinity,
        "__meta:stage-stars:",
        0,
        3
      ),
      unlockedRouteIds: withFallbackStrings(
        progress.unlockedRouteIds ?? source.unlockedRouteIds,
        defaults.progress.unlockedRouteIds
      ),
      activeRouteId: nullableString(
        progress.activeRouteId ?? source.activeRouteId,
        defaults.progress.activeRouteId
      ),
      campaignComplete: asBoolean(
        progress.campaignComplete ?? source.campaignComplete,
        defaults.progress.campaignComplete
      )
    },
    roster: {
      ownedHeroIds: withFallbackStrings(
        roster.ownedHeroIds ?? roster.owned,
        defaults.roster.ownedHeroIds
      ),
      partyHeroIds: withFallbackStrings(
        roster.partyHeroIds ?? roster.party,
        defaults.roster.partyHeroIds
      ),
      partyPresets: normalizePartyPresets(roster.partyPresets),
      heroXp: nonNegativeIntegerRecord(roster.heroXp ?? roster.xp),
      heroLevels: mergeLegacyIntegerRecord(
        roster.heroLevels ?? roster.levels ?? source.heroLevels,
        legacyBossAffinity,
        "__meta:hero-level:",
        1,
        60
      ),
      heroShards: nonNegativeIntegerRecord(roster.heroShards ?? roster.shards),
      heroAwakening: nonNegativeIntegerRecord(roster.heroAwakening ?? roster.awakening)
    },
    resources: {
      gold: nonNegativeInteger(resources.gold ?? source.gold, defaults.resources.gold),
      materials: nonNegativeIntegerRecord(resources.materials ?? source.materials),
      awakeningMaterials: nonNegativeInteger(
        resources.awakeningMaterials ?? source.awakeningMaterials,
        defaults.resources.awakeningMaterials
      ),
      relicDust: nonNegativeInteger(
        resources.relicDust ?? source.relicDust,
        defaults.resources.relicDust
      ),
      fateDust: nonNegativeInteger(
        resources.fateDust ?? source.fateDust,
        defaults.resources.fateDust
      ),
      vaultSlots: Math.max(
        defaults.resources.vaultSlots,
        nonNegativeInteger(resources.vaultSlots ?? source.vaultSlots, defaults.resources.vaultSlots)
      )
    },
    inventory: {
      relicIds: uniqueStrings(inventory.relicIds ?? source.relicIds),
      equippedRelicIds: uniqueStrings(inventory.equippedRelicIds).slice(0, 3),
      relicLevels: boundedIntegerRecord(inventory.relicLevels, 1, 5),
      skinIds: uniqueStrings(inventory.skinIds ?? source.skinIds),
      selectedTitleId: nullableString(inventory.selectedTitleId, null)
    },
    summons: {
      oraclePulls: nonNegativeInteger(
        summons.oraclePulls ?? source.oraclePulls ?? source.summonCount,
        defaults.summons.oraclePulls
      ),
      pityCount: clampInteger(
        summons.pityCount ?? source.pityCount ?? source.pity,
        0,
        80,
        defaults.summons.pityCount
      ),
      guaranteedFeatured: asBoolean(
        summons.guaranteedFeatured ?? source.guaranteedFeatured,
        defaults.summons.guaranteedFeatured
      ),
      history: (Array.isArray(summons.history) ? summons.history : [])
        .map(normalizeSummonHistoryEntry)
        .filter((entry): entry is SummonHistoryEntry => Boolean(entry))
        .slice(-50)
    },
    recovery: {
      pendingBattleRescue: normalizePendingBattleRescue(recovery.pendingBattleRescue),
      activeCampaignBattle: normalizeActiveCampaignBattle(recovery.activeCampaignBattle),
      pendingCampaignVictorySettlement: normalizePendingCampaignVictorySettlement(
        recovery.pendingCampaignVictorySettlement,
      ),
      pendingEndgameVictorySettlement: normalizePendingEndgameVictorySettlement(
        recovery.pendingEndgameVictorySettlement,
      ),
    },
    endgame: {
      oracleTowerFloor: nonNegativeInteger(
        endgame.oracleTowerFloor,
        defaults.endgame.oracleTowerFloor
      ),
      oracleHeroLockUntilFloor: nonNegativeIntegerRecord(endgame.oracleHeroLockUntilFloor),
      weeklyStormRuns: nonNegativeInteger(
        endgame.weeklyStormRuns,
        defaults.endgame.weeklyStormRuns
      ),
      raidKeys: nonNegativeInteger(endgame.raidKeys, defaults.endgame.raidKeys),
      bossAffinity: stripLegacyProgressKeys(legacyBossAffinity),
      stormRoute: {
        weekId: nonNegativeInteger(stormRoute.weekId, defaults.endgame.stormRoute.weekId),
        nodeIndex: clampInteger(stormRoute.nodeIndex, 0, 11, defaults.endgame.stormRoute.nodeIndex),
        active: asBoolean(stormRoute.active, defaults.endgame.stormRoute.active),
        entryPaid: asBoolean(stormRoute.entryPaid, defaults.endgame.stormRoute.entryPaid),
        blessingIds: uniqueStrings(stormRoute.blessingIds),
        blessingOfferIds: uniqueStrings(stormRoute.blessingOfferIds).slice(0, 3),
        blessingRerollCount: nonNegativeInteger(
          stormRoute.blessingRerollCount,
          defaults.endgame.stormRoute.blessingRerollCount
        ),
        curseIds: uniqueStrings(stormRoute.curseIds),
        fallenHeroIds: uniqueStrings(stormRoute.fallenHeroIds),
        partyHeroIds: uniqueStrings(stormRoute.partyHeroIds).slice(0, 3),
        swapCharges: nonNegativeInteger(stormRoute.swapCharges, defaults.endgame.stormRoute.swapCharges),
        selectedStageId: nullableString(stormRoute.selectedStageId, null)
      },
      scyllaRaid: {
        active: asBoolean(scyllaRaid.active, defaults.endgame.scyllaRaid.active),
        phaseIndex: clampInteger(scyllaRaid.phaseIndex, 0, 2, defaults.endgame.scyllaRaid.phaseIndex),
        squads: normalizeStringMatrix(scyllaRaid.squads, 3, 4),
        carryForward: uniqueStrings(scyllaRaid.carryForward)
      }
    },
    pendingPurchases: pendingSource
      .map(normalizePendingPurchase)
      .filter((value): value is PendingPurchase => Boolean(value)),
    purchaseReceipts: retainPurchaseReceipts(
      (Array.isArray(source.purchaseReceipts) ? source.purchaseReceipts : [])
        .map(normalizePurchaseReceipt)
        .filter((value): value is PurchaseReceipt => Boolean(value)),
      200
    ),
    settings: {
      language: normalizeGameLanguage(settings.language, defaults.settings.language),
      masterVolume,
      musicVolume,
      sfxVolume,
      lastNonZeroMasterVolume: normalizeRememberedAudioVolume(
        masterVolume,
        settings.lastNonZeroMasterVolume,
        defaults.settings.lastNonZeroMasterVolume,
      ),
      lastNonZeroMusicVolume: normalizeRememberedAudioVolume(
        musicVolume,
        settings.lastNonZeroMusicVolume,
        defaults.settings.lastNonZeroMusicVolume,
      ),
      lastNonZeroSfxVolume: normalizeRememberedAudioVolume(
        sfxVolume,
        settings.lastNonZeroSfxVolume,
        defaults.settings.lastNonZeroSfxVolume,
      ),
      reducedMotion: asBoolean(settings.reducedMotion, defaults.settings.reducedMotion),
      screenShake: asBoolean(settings.screenShake, defaults.settings.screenShake),
      aimAssist: asBoolean(settings.aimAssist, defaults.settings.aimAssist),
      enemyActionTempo: normalizeEnemyActionTempo(
        settings.enemyActionTempo,
        defaults.settings.enemyActionTempo,
      ),
      textScale: normalizeTextScale(settings.textScale, defaults.settings.textScale),
      highContrast: asBoolean(settings.highContrast, defaults.settings.highContrast),
      colorVision: normalizeColorVision(settings.colorVision, defaults.settings.colorVision)
    },
    records: {
      wins: nonNegativeInteger(records.wins, defaults.records.wins),
      losses: nonNegativeInteger(records.losses, defaults.records.losses),
      bestRicochetChain: nonNegativeInteger(
        records.bestRicochetChain,
        defaults.records.bestRicochetChain
      ),
      totalDamage: nonNegativeInteger(records.totalDamage, defaults.records.totalDamage),
      lastPlayedAt: nonNegativeInteger(records.lastPlayedAt, defaults.records.lastPlayedAt)
    }
  };
}

function normalizeSummonHistoryEntry(value: unknown): SummonHistoryEntry | undefined {
  const source = asRecord(value);
  const summonId = asNonEmptyString(source?.summonId);
  const bannerId = asNonEmptyString(source?.bannerId);
  const heroId = asNonEmptyString(source?.heroId);
  const rarity = clampInteger(source?.rarity, 3, 5, 3);
  if (!summonId || !bannerId || !heroId || (rarity !== 3 && rarity !== 4 && rarity !== 5)) {
    return undefined;
  }
  return {
    summonId,
    bannerId,
    heroId,
    rarity,
    featured: asBoolean(source?.featured, false),
    duplicate: asBoolean(source?.duplicate, false),
    createdAt: nonNegativeInteger(source?.createdAt, 0)
  };
}

function normalizePendingBattleRescue(value: unknown): PendingBattleRescue | null {
  const source = asRecord(value);
  const purchaseId = asNonEmptyString(source?.purchaseId);
  const mode = normalizeBattleRescueMode(source?.mode);
  const stageId = asNonEmptyString(source?.stageId);
  const deployedHeroIds = uniqueStrings(source?.deployedHeroIds).slice(0, 4);
  const partyDefinitions = typeof source?.partyDefinitions === "string"
    ? source.partyDefinitions.slice(0, 500_000)
    : undefined;
  const contentRevision = asNonEmptyString(source?.contentRevision);
  const battleSnapshot = typeof source?.battleSnapshot === "string"
    ? source.battleSnapshot.slice(0, 500_000)
    : undefined;
  if (
    source?.version !== 1
    || !purchaseId
    || !mode
    || !stageId
    || deployedHeroIds.length < 1
    || !partyDefinitions
    || !contentRevision
    || !battleSnapshot
  ) return null;
  return {
    version: 1,
    purchaseId,
    mode,
    stageId,
    deployedHeroIds,
    partyDefinitions,
    contentRevision,
    battleSnapshot,
    hpRatio: clampNumber(source?.hpRatio, 0.1, 1, 0.5),
    createdAt: nonNegativeInteger(source?.createdAt, 0)
  };
}

function normalizeBattleRescueMode(value: unknown): BattleRescueMode | undefined {
  return value === "campaign" || value === "oracle" || value === "storm" || value === "raid"
    ? value
    : undefined;
}

function normalizeActiveCampaignBattle(value: unknown): ActiveCampaignBattle | null {
  const source = asRecord(value);
  const stageId = asNonEmptyString(source?.stageId);
  const deployedHeroIds = uniqueStrings(source?.deployedHeroIds).slice(0, 3);
  const partyDefinitions = typeof source?.partyDefinitions === "string"
    ? source.partyDefinitions.slice(0, 500_000)
    : undefined;
  const contentRevision = asNonEmptyString(source?.contentRevision);
  const battleSnapshot = typeof source?.battleSnapshot === "string"
    ? source.battleSnapshot.slice(0, 500_000)
    : undefined;
  if (
    source?.version !== 1
    || !stageId
    || deployedHeroIds.length < 1
    || !partyDefinitions
    || !contentRevision
    || !battleSnapshot
  ) {
    return null;
  }
  return {
    version: 1,
    stageId,
    deployedHeroIds,
    partyDefinitions,
    contentRevision,
    battleSnapshot,
    savedAt: nonNegativeInteger(source.savedAt, 0),
  };
}

function normalizePendingCampaignVictorySettlement(
  value: unknown,
): PendingCampaignVictorySettlement | null {
  const source = asRecord(value);
  const stageId = asNonEmptyString(source?.stageId);
  const rewardTicketToken = nonNegativeInteger(source?.rewardTicketToken, 0);
  const stars = clampInteger(source?.stars, 1, 3, 1);
  const partyHeroIds = uniqueStrings(source?.partyHeroIds).slice(0, 3);
  const fallenHeroIds = uniqueStrings(source?.fallenHeroIds)
    .filter((heroId) => partyHeroIds.includes(heroId))
    .slice(0, 3);
  if (
    source?.version !== 1
    || !stageId
    || rewardTicketToken < 1
    || partyHeroIds.length < 1
  ) {
    return null;
  }
  return {
    version: 1,
    stageId,
    rewardTicketToken,
    stars: stars as 1 | 2 | 3,
    turns: Math.max(1, nonNegativeInteger(source.turns, 1)),
    bestCombo: nonNegativeInteger(source.bestCombo, 0),
    totalDamage: nonNegativeInteger(source.totalDamage, 0),
    hpRatio: clampNumber(source.hpRatio, 0, 1, 1),
    partyHeroIds,
    fallenHeroIds,
    wonAt: nonNegativeInteger(source.wonAt, 0),
  };
}

function normalizePendingEndgameVictorySettlement(
  value: unknown,
): PendingEndgameVictorySettlement | null {
  const source = asRecord(value);
  const mode = source?.mode === "oracleTower"
    || source?.mode === "stormRoute"
    || source?.mode === "scyllaRaid"
    ? source.mode
    : undefined;
  const stageId = asNonEmptyString(source?.stageId);
  const rewardTicketToken = nonNegativeInteger(source?.rewardTicketToken, 0);
  const stars = clampInteger(source?.stars, 1, 3, 1);
  const maximumPartySize = mode === "scyllaRaid" ? 4 : 3;
  const partyHeroIds = uniqueStrings(source?.partyHeroIds).slice(0, maximumPartySize);
  const fallenHeroIds = uniqueStrings(source?.fallenHeroIds)
    .filter((heroId) => partyHeroIds.includes(heroId))
    .slice(0, maximumPartySize);
  const rewardHeroIds = uniqueStrings(source?.rewardHeroIds).slice(0, 12);
  const contentRevision = asNonEmptyString(source?.contentRevision);
  const runStateRevision = asNonEmptyString(source?.runStateRevision);
  const rawScyllaPhase = source?.scyllaPhaseIndex;
  const scyllaPhaseIndex = rawScyllaPhase === null
    ? null
    : clampInteger(rawScyllaPhase, 0, 2, 0) as 0 | 1 | 2;
  const stormWeekId = source?.stormWeekId === null
    ? null
    : nonNegativeInteger(source?.stormWeekId, 0);
  if (
    source?.version !== 1
    || !mode
    || !stageId
    || rewardTicketToken < 1
    || partyHeroIds.length < 1
    || rewardHeroIds.length < 1
    || !contentRevision
    || !runStateRevision
    || (mode === "scyllaRaid" ? scyllaPhaseIndex === null : scyllaPhaseIndex !== null)
    || (mode === "stormRoute" ? stormWeekId === null : stormWeekId !== null)
  ) {
    return null;
  }
  return {
    version: 1,
    mode,
    stageId,
    rewardTicketToken,
    stars: stars as 1 | 2 | 3,
    turns: Math.max(1, nonNegativeInteger(source.turns, 1)),
    bestCombo: nonNegativeInteger(source.bestCombo, 0),
    totalDamage: nonNegativeInteger(source.totalDamage, 0),
    hpRatio: clampNumber(source.hpRatio, 0, 1, 1),
    partyHeroIds,
    fallenHeroIds,
    rewardHeroIds,
    weeklyScoreEnabled: asBoolean(source.weeklyScoreEnabled, false),
    contextIndex: nonNegativeInteger(source.contextIndex, 0),
    runOrdinal: nonNegativeInteger(source.runOrdinal, 0),
    stormWeekId,
    scyllaPhaseIndex,
    contentRevision,
    runStateRevision,
    wonAt: nonNegativeInteger(source.wonAt, 0),
  };
}

function normalizePendingPurchase(value: unknown): PendingPurchase | undefined {
  const source = asRecord(value);
  const purchaseId = asNonEmptyString(source?.purchaseId);
  const actionId = asNonEmptyString(source?.actionId);
  const idempotencyKey = asNonEmptyString(source?.idempotencyKey);
  const phase = source?.phase === "spent" ? "spent" : source?.phase === "spending" ? "spending" : undefined;
  if (!purchaseId || !actionId || !isDiamondActionId(actionId) || !idempotencyKey || !phase) {
    return undefined;
  }
  const transactionId = asNonEmptyString(source?.transactionId);
  if (phase === "spent" && !transactionId) {
    return undefined;
  }
  const createdAt = nonNegativeInteger(source?.createdAt, 0);
  return {
    purchaseId,
    actionId,
    idempotencyKey,
    phase,
    createdAt,
    updatedAt: nonNegativeInteger(source?.updatedAt, createdAt),
    reward: normalizeJsonObject(source?.reward),
    ...(transactionId ? { transactionId } : {})
  };
}

function normalizePurchaseReceipt(value: unknown): PurchaseReceipt | undefined {
  const source = asRecord(value);
  const purchaseId = asNonEmptyString(source?.purchaseId);
  const actionId = asNonEmptyString(source?.actionId);
  const transactionId = asNonEmptyString(source?.transactionId);
  if (!purchaseId || !actionId || !isDiamondActionId(actionId) || !transactionId) {
    return undefined;
  }
  return {
    purchaseId,
    actionId,
    transactionId,
    committedAt: nonNegativeInteger(source?.committedAt, 0)
  };
}

/** Non-repeatable entitlements must survive ordinary receipt-history trimming. */
function retainPurchaseReceipts(
  receipts: readonly PurchaseReceipt[],
  maximum: number
): PurchaseReceipt[] {
  const permanent = receipts.filter(
    (receipt) => getDiamondAction(receipt.actionId)?.repeatable === false
  );
  const remaining = Math.max(0, maximum - permanent.length);
  const recentRepeatable = remaining > 0
    ? receipts
        .filter((receipt) => getDiamondAction(receipt.actionId)?.repeatable !== false)
        .slice(-remaining)
    : [];
  const retained = new Set([...permanent, ...recentRepeatable].map((receipt) => receipt.purchaseId));
  return receipts.filter((receipt) => retained.has(receipt.purchaseId));
}

function normalizeJsonObject(value: unknown): JsonObject {
  const source = asRecord(value);
  if (!source) {
    return {};
  }
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(source)) {
    const normalized = normalizeJsonValue(entry, 0);
    if (normalized !== undefined) {
      output[key] = normalized;
    }
  }
  return output;
}

function normalizeJsonValue(value: unknown, depth: number): JsonValue | undefined {
  if (depth > 8) {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeJsonValue(entry, depth + 1))
      .filter((entry): entry is JsonValue => entry !== undefined);
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(record)) {
    const normalized = normalizeJsonValue(entry, depth + 1);
    if (normalized !== undefined) {
      output[key] = normalized;
    }
  }
  return output;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(asNonEmptyString).filter((entry): entry is string => Boolean(entry)))];
}

function withFallbackStrings(value: unknown, fallback: string[]): string[] {
  const result = uniqueStrings(value);
  return result.length ? result : [...fallback];
}

function normalizeStringMatrix(value: unknown, maximumRows: number, maximumColumns: number): string[][] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximumRows).map((row) => uniqueStrings(row).slice(0, maximumColumns));
}

function normalizePartyPresets(value: unknown): string[][] {
  const rows = normalizeStringMatrix(value, 3, 3);
  while (rows.length < 3) rows.push([]);
  return rows;
}

function nonNegativeIntegerRecord(value: unknown): Record<string, number> {
  const source = asRecord(value);
  if (!source) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(source)) {
    const id = key.trim();
    if (!id) {
      continue;
    }
    result[id] = nonNegativeInteger(entry, 0);
  }
  return result;
}

function boundedIntegerRecord(
  value: unknown,
  minimum: number,
  maximum: number
): Record<string, number> {
  const source = asRecord(value);
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, entry]) => [key.trim(), clampInteger(entry, minimum, maximum, minimum)] as const)
      .filter(([key]) => Boolean(key))
  );
}

function mergeLegacyIntegerRecord(
  formalValue: unknown,
  legacy: Readonly<Record<string, number>>,
  prefix: string,
  minimum: number,
  maximum: number
): Record<string, number> {
  const result = nonNegativeIntegerRecord(formalValue);
  for (const [key, amount] of Object.entries(legacy)) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length).trim();
    if (!id || id in result) continue;
    result[id] = Math.min(maximum, Math.max(minimum, Math.floor(amount)));
  }
  for (const id of Object.keys(result)) {
    result[id] = Math.min(maximum, Math.max(minimum, Math.floor(result[id] ?? minimum)));
  }
  return result;
}

function stripLegacyProgressKeys(
  value: Readonly<Record<string, number>>
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !key.startsWith("__meta:stage-stars:") && !key.startsWith("__meta:hero-level:")
    )
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : undefined;
}

function nullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }
  return asNonEmptyString(value) ?? fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeGameLanguage(value: unknown, fallback: GameLanguage): GameLanguage {
  return value === "en" || value === "ko" ? value : fallback;
}

function normalizeEnemyActionTempo(
  value: unknown,
  fallback: EnemyActionTempoSetting,
): EnemyActionTempoSetting {
  const numeric = Number(value);
  return numeric === 1 || numeric === 1.5 || numeric === 2 ? numeric : fallback;
}

function normalizeTextScale(value: unknown, fallback: TextScale): TextScale {
  if (value === 115 || value === "115" || value === "large") return 115;
  if (value === 100 || value === "100" || value === "normal") return 100;
  return fallback;
}

function normalizeColorVision(value: unknown, fallback: ColorVisionMode): ColorVisionMode {
  if (value === "deuteranopia" || value === "deutan") return "deuteranopia";
  if (value === "tritanopia" || value === "tritan") return "tritanopia";
  if (value === "off") return "off";
  return fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Math.max(0, Math.floor(asFiniteNumber(value, fallback)));
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(asFiniteNumber(value, fallback))));
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  return Math.min(maximum, Math.max(minimum, asFiniteNumber(value, fallback)));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
