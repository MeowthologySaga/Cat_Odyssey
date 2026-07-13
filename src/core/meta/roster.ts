import { HEROES, HERO_BY_ID } from "../../data";
import type { GameSaveV1 } from "../../state/saveSchema";
import {
  assertNoWalletState,
  normalizeMetaSave,
  readHeroLevel,
  writeHeroLevel,
} from "./compat";
import {
  CAMPAIGN_PARTY_MAX_SIZE,
  CAMPAIGN_PARTY_MIN_SIZE,
  DEFAULT_CAMPAIGN_PARTY,
  levelCapForAscension,
} from "./constants";
import type {
  HeroProgressView,
  MetaFailure,
  PartyValidationIssue,
  PartyValidationResult,
} from "./types";

export interface SetPartySuccess {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly partyHeroIds: readonly string[];
}

export type SetPartyResult = SetPartySuccess | MetaFailure;

export interface GrantHeroResult {
  readonly ok: true;
  readonly save: GameSaveV1;
  readonly heroId: string;
  readonly newlyOwned: boolean;
  readonly shardsGranted: number;
}

export function initializeStarterRoster(input: GameSaveV1): GameSaveV1 {
  const save = normalizeMetaSave(input);
  for (const heroId of DEFAULT_CAMPAIGN_PARTY) {
    if (!save.roster.ownedHeroIds.includes(heroId)) save.roster.ownedHeroIds.push(heroId);
    if (readHeroLevel(save, heroId) === 0) writeHeroLevel(save, heroId, 1);
  }
  if (!validateParty(save, save.roster.partyHeroIds).valid) {
    save.roster.partyHeroIds = [...DEFAULT_CAMPAIGN_PARTY];
  }
  assertNoWalletState(save);
  return save;
}

export function getHeroProgress(input: GameSaveV1, heroId: string): HeroProgressView | undefined {
  if (!HERO_BY_ID[heroId]) return undefined;
  const save = normalizeMetaSave(input);
  const owned = save.roster.ownedHeroIds.includes(heroId);
  const ascension = owned ? Math.min(5, Math.max(0, save.roster.heroAwakening[heroId] ?? 0)) : 0;
  return {
    heroId,
    owned,
    level: owned ? readHeroLevel(save, heroId) : 0,
    xp: owned ? Math.max(0, Math.floor(save.roster.heroXp[heroId] ?? 0)) : 0,
    ascension,
    levelCap: levelCapForAscension(ascension),
    shards: owned ? Math.max(0, save.roster.heroShards[heroId] ?? 0) : 0,
  };
}

export function getRoster(input: GameSaveV1): readonly HeroProgressView[] {
  return HEROES.map((hero) => getHeroProgress(input, hero.id)).filter(
    (hero): hero is HeroProgressView => Boolean(hero),
  );
}

export function validateParty(input: GameSaveV1, heroIds: readonly string[]): PartyValidationResult {
  const save = normalizeMetaSave(input);
  const ids = [...heroIds];
  const issues: PartyValidationIssue[] = [];
  if (ids.length < CAMPAIGN_PARTY_MIN_SIZE || ids.length > CAMPAIGN_PARTY_MAX_SIZE) {
    issues.push({
      code: "party_size",
      message: `Campaign party must contain ${CAMPAIGN_PARTY_MIN_SIZE} to ${CAMPAIGN_PARTY_MAX_SIZE} heroes.`,
    });
  }
  const seen = new Set<string>();
  for (const heroId of ids) {
    if (seen.has(heroId)) {
      issues.push({ code: "duplicate_hero", heroId, message: `Duplicate hero: ${heroId}` });
      continue;
    }
    seen.add(heroId);
    if (!HERO_BY_ID[heroId]) {
      issues.push({ code: "unknown_hero", heroId, message: `Unknown hero: ${heroId}` });
    } else if (!save.roster.ownedHeroIds.includes(heroId)) {
      issues.push({ code: "hero_not_owned", heroId, message: `Hero is not owned: ${heroId}` });
    }
  }
  return { valid: issues.length === 0, heroIds: ids, issues };
}

export function setCampaignParty(input: GameSaveV1, heroIds: readonly string[]): SetPartyResult {
  const save = normalizeMetaSave(input);
  const validation = validateParty(save, heroIds);
  if (!validation.valid) {
    return {
      ok: false,
      code: "invalid_party",
      message: validation.issues.map((issue) => issue.message).join("; "),
      save,
    };
  }
  save.roster.partyHeroIds = [...heroIds];
  assertNoWalletState(save);
  return { ok: true, save, partyHeroIds: [...heroIds] };
}

export function grantHero(
  input: GameSaveV1,
  heroId: string,
  duplicateShards: number,
): GrantHeroResult | MetaFailure {
  const save = normalizeMetaSave(input);
  if (!HERO_BY_ID[heroId]) {
    return { ok: false, code: "unknown_hero", message: `Unknown hero: ${heroId}`, save };
  }
  const newlyOwned = !save.roster.ownedHeroIds.includes(heroId);
  const shardsGranted = newlyOwned ? 0 : Math.max(0, Math.floor(duplicateShards));
  if (newlyOwned) {
    save.roster.ownedHeroIds.push(heroId);
    writeHeroLevel(save, heroId, 1);
  } else if (shardsGranted > 0) {
    save.roster.heroShards[heroId] = (save.roster.heroShards[heroId] ?? 0) + shardsGranted;
  }
  assertNoWalletState(save);
  return { ok: true, save, heroId, newlyOwned, shardsGranted };
}
