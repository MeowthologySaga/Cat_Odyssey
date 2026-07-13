import { resolveGameHost, type GameHostResolution } from "../platform";
import { HERO_BY_ID } from "../data";
import {
  GameSaveStore,
  PurchaseService,
  VAULT_EXPANSION_MIN_SLOTS,
  type GameSaveV1,
  type JsonObject,
  type PendingPurchase,
  type PurchaseResult,
  type PurchaseSuccess,
} from "../state";
import {
  CAMPAIGN_PARTY_MAX_SIZE,
  DEFAULT_CAMPAIGN_PARTY,
  DUPLICATE_FATE_DUST,
  DUPLICATE_SHARDS,
} from "./meta/constants";
import { normalizeMetaSave } from "./meta/compat";
import { sanitizeCampaignBattleCheckpoint } from "./meta/campaignBattleResume";
import {
  commitStormBlessingReroll,
  STORM_EXTRA_ENTRY_MATERIAL_ID,
} from "./meta/endgameLoop";
import { DEFAULT_ORACLE_BANNER } from "./meta/summons";

export interface GameServices {
  readonly host: LemGameHostApi;
  readonly hostMode: GameHostResolution["mode"];
  readonly save: GameSaveStore;
  readonly purchases: PurchaseService;
  /** True only for an explicit query-activated, memory-only developer voyage. */
  readonly debugMode: boolean;
  readonly dispose: () => void;
  walletBalance: number;
  refreshWallet(): Promise<number>;
}

type WalletReconciliationTarget = Pick<GameServices, "walletBalance" | "refreshWallet">;

/**
 * Applies the authoritative balance returned by a completed spend synchronously,
 * then verifies it in the background. A balance endpoint outage must never turn an
 * already committed purchase into a stuck/repeatable UI action.
 */
export function reconcileWalletAfterPurchase(
  services: WalletReconciliationTarget,
  purchase: Pick<PurchaseSuccess, "balanceAfter">,
): void {
  if (typeof purchase.balanceAfter === "number" && Number.isFinite(purchase.balanceAfter)) {
    services.walletBalance = Math.max(0, purchase.balanceAfter);
  }
  void services.refreshWallet().catch(() => undefined);
}

export function announceRecoveredPurchases(
  host: Pick<LemGameHostApi, "ui">,
  results: readonly PurchaseResult[],
): void {
  const recoveredCount = results.filter((result) => result.ok).length;
  const unresolvedCount = results.filter(
    (result) => !result.ok && result.status === "recoverable",
  ).length;
  if (recoveredCount > 0) {
    host.ui.toast(`이전 결제 ${recoveredCount}건의 보상을 안전하게 복구했습니다.`);
  }
  if (unresolvedCount > 0) {
    host.ui.toast(`확인 중인 결제 ${unresolvedCount}건이 있습니다. 같은 구매를 다시 누르면 이어서 확인합니다.`);
  }
}

let activeServices: GameServices | undefined;

export interface InitializeServicesOptions {
  readonly debugMode?: boolean;
}

export function getServices(): GameServices {
  if (!activeServices) throw new Error("Game services have not been initialized.");
  return activeServices;
}

export async function initializeServices(options: InitializeServicesOptions = {}): Promise<GameServices> {
  const debugMode = options.debugMode === true;
  const { host, mode } = resolveGameHost({ mock: { initialBalance: 2_000 } });
  const save = new GameSaveStore(host);
  await save.load();
  await repairLegacyDefaults(save);
  if (debugMode) save.beginVolatileSession();
  const dispose = save.bindLifecycle();
  const purchases = new PurchaseService(host, save, commitPurchaseReward, {
    walletSpendingDisabled: debugMode,
  });

  const services: GameServices = {
    host,
    hostMode: mode,
    save,
    purchases,
    debugMode,
    dispose,
    walletBalance: 0,
    async refreshWallet() {
      const result = await host.wallet.getBalance();
      services.walletBalance = result.balance;
      return result.balance;
    },
  };
  // Debug voyages must neither resume nor charge a durable purchase journal.
  const recoveredPurchases = debugMode ? [] : await purchases.recoverPendingPurchases();
  for (const recovered of recoveredPurchases) {
    if (
      recovered.ok
      && typeof recovered.balanceAfter === "number"
      && Number.isFinite(recovered.balanceAfter)
    ) {
      services.walletBalance = Math.max(0, recovered.balanceAfter);
    }
  }
  announceRecoveredPurchases(host, recoveredPurchases);
  try {
    await services.refreshWallet();
  } catch {
    // A temporary balance lookup outage must not prevent recovered rewards or the
    // rest of the game from loading. The next top-level purchase will retry it.
  }
  activeServices = services;
  return services;
}

async function repairLegacyDefaults(store: GameSaveStore): Promise<void> {
  let snapshot = store.getSnapshot();
  const normalized = sanitizeCampaignBattleCheckpoint(normalizeMetaSave(snapshot));
  if (JSON.stringify(normalized) !== JSON.stringify(snapshot)) {
    snapshot = await store.replace(normalized);
  }
  const badRoute = snapshot.progress.unlockedRouteIds.includes("route-01")
    || snapshot.progress.activeRouteId === "route-01";
  // The opening voyage intentionally starts with Meow-dysseus alone. Story crew
  // remain untouched when already owned and join through campaign milestones.
  const starterIds = [...DEFAULT_CAMPAIGN_PARTY];
  const missingStarters = starterIds.some((id) => !snapshot.roster.ownedHeroIds.includes(id));
  const repairedParty = [...new Set(snapshot.roster.partyHeroIds)]
    .filter((id) => snapshot.roster.ownedHeroIds.includes(id))
    .slice(0, CAMPAIGN_PARTY_MAX_SIZE);
  const badParty = repairedParty.length < 1
    || repairedParty.length !== snapshot.roster.partyHeroIds.length;
  if (!badRoute && !missingStarters && !badParty) return;
  await store.update((draft) => {
    draft.progress.unlockedRouteIds = draft.progress.unlockedRouteIds
      .filter((id) => id !== "route-01");
    if (!draft.progress.unlockedRouteIds.includes("route-01-ogygia")) {
      draft.progress.unlockedRouteIds.unshift("route-01-ogygia");
    }
    if (!draft.progress.activeRouteId || draft.progress.activeRouteId === "route-01") {
      draft.progress.activeRouteId = "route-01-ogygia";
    }
    draft.roster.ownedHeroIds = [...new Set([...draft.roster.ownedHeroIds, ...starterIds])];
    const validParty = [...new Set(draft.roster.partyHeroIds)]
      .filter((id) => draft.roster.ownedHeroIds.includes(id))
      .slice(0, CAMPAIGN_PARTY_MAX_SIZE);
    draft.roster.partyHeroIds = validParty.length ? validParty : [...starterIds];
  });
}

export function commitPurchaseReward(purchase: Readonly<PendingPurchase>, draft: GameSaveV1): void {
  if (purchase.actionId === "battle-rescue") {
    const version = readInteger(purchase.reward, "version");
    const stageId = readString(purchase.reward, "stageId");
    const mode = readString(purchase.reward, "mode");
    const deployedHeroIds = readStringArray(purchase.reward, "deployedHeroIds");
    const partyDefinitions = readString(purchase.reward, "partyDefinitions");
    const contentRevision = readString(purchase.reward, "contentRevision");
    const battleSnapshot = readString(purchase.reward, "battleSnapshot");
    if (
      version !== 1
      || !stageId
      || (mode !== "campaign" && mode !== "oracle" && mode !== "storm" && mode !== "raid")
      || deployedHeroIds.length < 1
      || !partyDefinitions
      || !contentRevision
      || !battleSnapshot
    ) {
      throw new Error("전투 구조 구매 정보가 완전하지 않습니다.");
    }
    const existing = draft.recovery.pendingBattleRescue;
    if (existing) {
      if (existing.purchaseId === purchase.purchaseId) return;
      throw new Error("사용하지 않은 전투 구조가 있어 새 구조로 덮어쓸 수 없습니다.");
    }
    draft.recovery.pendingBattleRescue = {
      version: 1,
      purchaseId: purchase.purchaseId,
      mode,
      stageId,
      deployedHeroIds,
      partyDefinitions,
      contentRevision,
      battleSnapshot,
      hpRatio: 0.5,
      createdAt: purchase.createdAt,
    };
    return;
  }
  if (purchase.actionId === "oracle-summon-1" || purchase.actionId === "oracle-summon-10") {
    // Validate the complete charged journal before mutating the draft. A malformed
    // spent purchase must stay pending for recovery instead of granting a valid
    // prefix and then failing halfway through the remaining pulls.
    const reward = validateOraclePurchaseReward(purchase, draft);
    for (const pull of reward.pulls) {
      if (pull.storyLocked || pull.duplicate) {
        draft.roster.heroShards[pull.heroId] =
          (draft.roster.heroShards[pull.heroId] ?? 0) + pull.shardsGranted;
      } else {
        draft.roster.ownedHeroIds.push(pull.heroId);
        draft.roster.heroLevels[pull.heroId] = 1;
      }
      if (pull.duplicate) draft.resources.fateDust += DUPLICATE_FATE_DUST[pull.rarity];
    }
    draft.summons.history = [
      ...draft.summons.history,
      ...reward.pulls.map((pull, index) => ({
        summonId: `${purchase.purchaseId}:${index + 1}`,
        bannerId: reward.bannerId,
        heroId: pull.heroId,
        rarity: pull.rarity,
        featured: pull.featured,
        duplicate: pull.duplicate || pull.storyLocked,
        createdAt: purchase.createdAt,
      })),
    ].slice(-50);
    draft.summons.oraclePulls += reward.pulls.length;
    draft.summons.pityCount = reward.pityAfter;
    draft.summons.guaranteedFeatured = reward.guaranteedFeatured;
    return;
  }
  if (purchase.actionId === "blessing-reroll") {
    const weekId = readInteger(purchase.reward, "weekId");
    const runNumber = readInteger(purchase.reward, "runNumber");
    const nodeIndex = readInteger(purchase.reward, "nodeIndex");
    const rerollNumber = readInteger(purchase.reward, "rerollNumber");
    const candidateIds = readStringArray(purchase.reward, "candidateIds");
    if (
      weekId === undefined
      || runNumber === undefined
      || nodeIndex === undefined
      || rerollNumber === undefined
      || candidateIds.length !== 3
    ) {
      throw new Error("가호 재선택 구매 정보가 올바르지 않습니다.");
    }
    const reroll = commitStormBlessingReroll(draft, {
      weekId,
      runNumber,
      nodeIndex,
      rerollNumber,
      candidateIds,
    });
    if (!reroll.ok) throw new Error(reroll.message);
    Object.assign(draft, reroll.save);
    return;
  }
  if (purchase.actionId === "awakening-materials") {
    draft.resources.awakeningMaterials += 10;
  } else if (purchase.actionId === "vault-expansion") {
    if (draft.resources.vaultSlots < VAULT_EXPANSION_MIN_SLOTS) {
      draft.resources.vaultSlots = Math.max(
        VAULT_EXPANSION_MIN_SLOTS,
        draft.resources.vaultSlots + 20,
      );
    }
  } else if (purchase.actionId === "raid-extra-key") {
    draft.endgame.raidKeys += 1;
  } else if (purchase.actionId === "storm-extra-run") {
    draft.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] =
      (draft.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] ?? 0) + 1;
  }
}

function readString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStringArray(record: JsonObject, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function readInteger(record: JsonObject, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

type ValidatedOraclePull = {
  heroId: string;
  rarity: 3 | 4 | 5;
  featured: boolean;
  duplicate: boolean;
  storyLocked: boolean;
  heroGranted: boolean;
  shardsGranted: number;
};

type ValidatedOracleReward = {
  bannerId: string;
  pulls: ValidatedOraclePull[];
  pityAfter: number;
  guaranteedFeatured: boolean;
};

function validateOraclePurchaseReward(
  purchase: Readonly<PendingPurchase>,
  draft: Readonly<GameSaveV1>,
): ValidatedOracleReward {
  const expectedCount = purchase.actionId === "oracle-summon-1" ? 1 : 10;
  const bannerValue = purchase.reward.bannerId;
  // The first journal format omitted bannerId. Its only valid interpretation is
  // the permanent default banner; an explicit id must always match exactly.
  const bannerId = bannerValue === undefined ? DEFAULT_ORACLE_BANNER.id : bannerValue;
  if (bannerId !== DEFAULT_ORACLE_BANNER.id) {
    throw invalidOracleReward("bannerId does not match the active banner");
  }

  const rawPulls = purchase.reward.pulls;
  if (!Array.isArray(rawPulls) || rawPulls.length !== expectedCount) {
    throw invalidOracleReward(`${purchase.actionId} requires exactly ${expectedCount} pull(s)`);
  }

  const rawPityAfter = purchase.reward.pityAfter;
  if (!isIntegerInRange(rawPityAfter, 0, DEFAULT_ORACLE_BANNER.hardPity - 1)) {
    throw invalidOracleReward("pityAfter is outside the banner bounds");
  }
  if (typeof purchase.reward.guaranteedFeatured !== "boolean") {
    throw invalidOracleReward("guaranteedFeatured must be a boolean");
  }

  const ownedHeroIds = new Set(draft.roster.ownedHeroIds);
  const pulls: ValidatedOraclePull[] = [];
  let pity = Math.min(
    DEFAULT_ORACLE_BANNER.hardPity - 1,
    Math.max(0, Math.floor(draft.summons.pityCount)),
  );
  let guaranteedFeatured = draft.summons.guaranteedFeatured;
  let hasFourOrFive = false;

  for (const [offset, entry] of rawPulls.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw invalidOracleReward(`pull ${offset + 1} is not an object`);
    }
    const raw = entry as JsonObject;
    // index/heroGranted/per-pull pity were added after the first recoverable
    // journal format. Missing values are reconstructed, but supplied values are
    // never coerced or trusted.
    if (raw.index !== undefined && raw.index !== offset + 1) {
      throw invalidOracleReward(`pull ${offset + 1} has a non-sequential index`);
    }
    const heroId = raw.heroId;
    if (typeof heroId !== "string" || !heroId.trim()) {
      throw invalidOracleReward(`pull ${offset + 1} has no heroId`);
    }
    const hero = HERO_BY_ID[heroId];
    if (!hero) throw invalidOracleReward(`pull ${offset + 1} references an unknown hero`);
    if (!DEFAULT_ORACLE_BANNER.poolHeroIds.includes(heroId)) {
      throw invalidOracleReward(`pull ${offset + 1} hero is not in the active banner pool`);
    }
    if (raw.rarity !== hero.rarity) {
      throw invalidOracleReward(`pull ${offset + 1} rarity does not match the hero catalog`);
    }
    const rarity = hero.rarity;
    const expectedFeatured = rarity === 5 && heroId === DEFAULT_ORACLE_BANNER.featuredHeroId;
    if (raw.featured !== expectedFeatured) {
      throw invalidOracleReward(`pull ${offset + 1} has an invalid featured flag`);
    }

    const duplicate = ownedHeroIds.has(heroId);
    const storyLocked = hero.unlock === "story" && !duplicate;
    const heroGranted = !duplicate && !storyLocked;
    const shardsGranted = duplicate || storyLocked ? DUPLICATE_SHARDS[rarity] : 0;
    if (raw.duplicate !== duplicate || raw.storyLocked !== storyLocked) {
      throw invalidOracleReward(`pull ${offset + 1} ownership flags do not match the roster`);
    }
    if (raw.heroGranted !== undefined && raw.heroGranted !== heroGranted) {
      throw invalidOracleReward(`pull ${offset + 1} has an invalid heroGranted flag`);
    }
    if (raw.shardsGranted !== shardsGranted) {
      throw invalidOracleReward(`pull ${offset + 1} has an invalid shard grant`);
    }

    if (raw.pityBefore !== undefined && raw.pityBefore !== pity) {
      throw invalidOracleReward(`pull ${offset + 1} has an invalid pityBefore value`);
    }
    if (rarity === 5) {
      if (guaranteedFeatured && !expectedFeatured) {
        throw invalidOracleReward(`pull ${offset + 1} bypasses the featured guarantee`);
      }
      pity = 0;
      guaranteedFeatured = !expectedFeatured;
    } else {
      if (pity >= DEFAULT_ORACLE_BANNER.hardPity - 1) {
        throw invalidOracleReward(`pull ${offset + 1} bypasses hard pity`);
      }
      pity = Math.min(DEFAULT_ORACLE_BANNER.hardPity - 1, pity + 1);
    }
    if (raw.pityAfter !== undefined && raw.pityAfter !== pity) {
      throw invalidOracleReward(`pull ${offset + 1} has an invalid pityAfter value`);
    }

    hasFourOrFive ||= rarity >= 4;
    if (heroGranted) ownedHeroIds.add(heroId);
    pulls.push({
      heroId,
      rarity,
      featured: expectedFeatured,
      duplicate,
      storyLocked,
      heroGranted,
      shardsGranted,
    });
  }

  if (expectedCount === 10 && !hasFourOrFive) {
    throw invalidOracleReward("a ten-pull journal must include its four-star guarantee");
  }
  if (rawPityAfter !== pity) {
    throw invalidOracleReward("final pity does not match the pull sequence");
  }
  if (purchase.reward.guaranteedFeatured !== guaranteedFeatured) {
    throw invalidOracleReward("featured guarantee does not match the pull sequence");
  }

  return {
    bannerId,
    pulls,
    pityAfter: rawPityAfter,
    guaranteedFeatured,
  };
}

function invalidOracleReward(reason: string): Error {
  return new Error(`Invalid oracle summon reward journal: ${reason}.`);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}
