import Phaser from "phaser";
import { ENDGAME, HEROES, HERO_BY_ID, RELICS, RELIC_BY_ID, STAGE_BY_ID, type HeroDefinition } from "../data";
import { getServices, reconcileWalletAfterPurchase } from "../core/services";
import {
  battleRewardMode,
  battleRescueEndgameMode,
  beginBattleRewardTicket,
  abandonPendingBattleRun,
  assessPartyPower,
  CAMPAIGN_PARTY_MAX_SIZE,
  CAMPAIGN_PARTY_MIN_SIZE,
  consumeEndgameEntryCost,
  formatFirstClearPreview,
  getHeroCombatProfile,
  getPartyCombatPower,
  getHeroXpProgress,
  getEndgamePartyRules,
  getStageRewardPreview,
  prepareWeeklyStormState,
  saveScyllaRaidSquads,
  setStormRouteParty,
  setCampaignParty,
  validateScyllaRaidSquads,
  ascendHero,
  equipRelic,
  getRelicProgress,
  getLockedRelicMaterialIds,
  getEndgameRewardPlan,
  getEndgameBattlePreview,
  planRelicMaterialConsumption,
  queryOwnedHeroes,
  quoteAscension,
  quoteLevelUpgrade,
  quoteRelicUpgrade,
  relicEffectLevelSummary,
  refineMaterial,
  setRelicMaterialLocked,
  unequipRelic,
  upgradeHeroLevel,
  upgradeRelic,
  type MetaFailure,
  titleDisplayName,
  clearPartyPreset,
  readPartyPreset,
  readPendingBattleRewardTickets,
  readRestorableBattleRescue,
  recommendedPowerForPartySize,
  recommendParty,
  writePartyPreset,
  type PartyElementFilter,
  type PartyLevelFilter,
  type PartyRecommendation,
  type PartyRecommendationSize,
  type PartyRoleFilter,
  type PartySortMode,
} from "../core/meta";
import { HERO_FALLBACK_TEXTURE_KEY, resolveHeroTexture } from "../assets/runtimeAssetCatalog";
import {
  addAtmosphere,
  addButton,
  addFocusableHitArea,
  addPanel,
  addTitle,
  addToast,
  addTopBar,
  COLORS,
  ensureUiFocus,
  fadeInScene,
  fadeTo,
  setUiEscapeHandler,
  setUiFocusScope,
  uiTextSize,
  W,
} from "../ui/gameUi";
import { playBgm } from "../audio/AudioDirector";
import { partyImageAssets, queueImageAssets } from "../assets/assetStreaming";
import { resourceDisplayName } from "../ui/resourceNames";
import { markCutsceneSeen, probeCutsceneAsset, resolveTriggeredCutscene } from "../core/cutsceneFlow";
import type { CutsceneDefinition } from "../data/cutscenes";
import { resolveStoryInterludeDestination } from "../core/uxFlow";
import type { GameSaveV1 } from "../state";

interface PartySceneData { stageId?: string; fromHarbor?: boolean; endgameMode?: "oracleTower" | "stormRoute" | "scyllaRaid"; cutsceneChecked?: boolean }

const ROLE_FILTERS: readonly PartyRoleFilter[] = ["all", "bounce", "pierce", "heavy", "burst", "support"];
const ELEMENT_FILTERS: readonly PartyElementFilter[] = ["all", "sea", "sun", "moon", "storm", "earth", "spirit"];
const LEVEL_FILTERS: readonly PartyLevelFilter[] = ["all", "1-10", "11-30", "31-60"];
const SORT_MODES: readonly PartySortMode[] = ["power", "level", "rarity", "name"];
const ROLE_FILTER_LABEL: Readonly<Record<PartyRoleFilter, string>> = {
  all: "전체", bounce: "반사", pierce: "관통", heavy: "중량", burst: "폭발", support: "지원",
};
const ELEMENT_FILTER_LABEL: Readonly<Record<PartyElementFilter, string>> = {
  all: "전체", sea: "바다", sun: "태양", moon: "달", storm: "폭풍", earth: "대지", spirit: "영혼",
};
const LEVEL_FILTER_LABEL: Readonly<Record<PartyLevelFilter, string>> = {
  all: "전체", "1-10": "Lv1~10", "11-30": "Lv11~30", "31-60": "Lv31~60",
};
const SORT_LABEL: Readonly<Record<PartySortMode, string>> = {
  power: "전투력", level: "레벨", rarity: "등급", name: "이름",
};

export class PartyScene extends Phaser.Scene {
  private stageId?: string;
  private fromHarbor = false;
  private endgameMode?: PartySceneData["endgameMode"];
  private selected: string[] = [];
  private focusedHeroId?: string;
  private saving = false;
  private raidSquads: string[][] = [];
  private relicPage = 0;
  private focusedRelicId?: string;
  private focusedMaterialId?: string;
  private materialPage = 0;
  private growthBusy = false;
  private vaultWarningAccepted = false;
  private cutsceneChecked = false;
  private cutsceneGateResolved = false;
  private pendingBeforeCutscene?: CutsceneDefinition;
  private partyPanel: "roster" | "tools" = "roster";
  private roleFilter: PartyRoleFilter = "all";
  private elementFilter: PartyElementFilter = "all";
  private levelFilter: PartyLevelFilter = "all";
  private sortMode: PartySortMode = "power";
  private rosterPage = 0;
  private recommendationSize: PartyRecommendationSize = 1;
  private recommendation?: PartyRecommendation;
  private presetBusy = false;
  private renderQueued = false;

  constructor() { super("Party"); }

  preload(): void {
    const save = getServices().save.getSnapshot();
    queueImageAssets(this, partyImageAssets(save.roster.ownedHeroIds), "선원 명부를 펼치는 중");
  }

  init(data: PartySceneData): void {
    this.stageId = data.stageId && STAGE_BY_ID[data.stageId] ? data.stageId : undefined;
    this.fromHarbor = Boolean(data.fromHarbor);
    this.endgameMode = data.endgameMode;
    this.cutsceneChecked = Boolean(data.cutsceneChecked);
    this.cutsceneGateResolved = false;
    this.pendingBeforeCutscene = undefined;
    this.saving = false;
    this.partyPanel = "roster";
    this.roleFilter = "all";
    this.elementFilter = "all";
    this.levelFilter = "all";
    this.sortMode = "power";
    this.rosterPage = 0;
    this.recommendation = undefined;
    this.presetBusy = false;
    this.renderQueued = false;
    this.vaultWarningAccepted = false;
    const save = getServices().save.getSnapshot();
    const partyRules = this.endgameMode ? getEndgamePartyRules(save, this.endgameMode) : undefined;
    this.selected = save.roster.partyHeroIds
      .filter((heroId) => Boolean(HERO_BY_ID[heroId]) && save.roster.ownedHeroIds.includes(heroId))
      .filter((heroId) => !partyRules?.lockedHeroIds.includes(heroId))
      .filter((heroId) => !partyRules?.forbiddenClasses.includes(HERO_BY_ID[heroId]!.ricochetClass))
      .slice(0, CAMPAIGN_PARTY_MAX_SIZE);
    const seenRaidHeroes = new Set<string>();
    const storedSquads = save.endgame.scyllaRaid.squads.map((party) => party.filter((heroId) => {
      const valid = Boolean(HERO_BY_ID[heroId]) && save.roster.ownedHeroIds.includes(heroId) && !seenRaidHeroes.has(heroId);
      if (valid) seenRaidHeroes.add(heroId);
      return valid;
    }).slice(0, 4));
    const fallbackIds = save.roster.ownedHeroIds.filter((heroId) => Boolean(HERO_BY_ID[heroId])).slice(0, 12);
    this.raidSquads = storedSquads.length === 3
      ? storedSquads
      : [fallbackIds.slice(0, 4), fallbackIds.slice(4, 8), fallbackIds.slice(8, 12)];
    this.focusedHeroId = this.selected[0] ?? save.roster.ownedHeroIds[0];
    this.recommendationSize = this.endgameMode === "stormRoute"
      ? 3
      : Math.max(1, Math.min(3, this.selected.length || 1)) as PartyRecommendationSize;
  }

  create(): void {
    if (!this.endgameMode && this.stageId) {
      const destination = resolveStoryInterludeDestination(
        getServices().save.getSnapshot(),
        { kind: "stage", stageId: this.stageId, timing: "before" },
        "Party",
        {
          stageId: this.stageId,
          fromHarbor: this.fromHarbor,
          cutsceneChecked: this.cutsceneChecked,
        },
      );
      if (destination.sceneKey === "Story") {
        this.scene.start(destination.sceneKey, destination.data);
        return;
      }
    }
    if (!this.endgameMode && this.stageId && !this.cutsceneChecked) {
      const cutscene = resolveTriggeredCutscene(
        getServices().save.getSnapshot(),
        { kind: "stage", stageId: this.stageId, timing: "before" },
      );
      if (cutscene) {
        this.pendingBeforeCutscene = cutscene;
        this.renderCutsceneGate(cutscene);
        void this.resolveBeforeCutscene(cutscene);
        return;
      }
    }
    this.openPartyUi();
  }

  private openPartyUi(): void {
    if (this.cutsceneGateResolved) return;
    this.cutsceneGateResolved = true;
    this.showPartyUi();
  }

  private showPartyUi(): void {
    playBgm(this, this.endgameMode ? "bgm-endgame-oracle" : "bgm-harbor-homeward");
    this.cleanupPresetSlots();
    this.render();
    fadeInScene(this, 220);
  }

  private renderCutsceneGate(cutscene: CutsceneDefinition): void {
    this.add.image(360, 640, "arena-cyclops").setDisplaySize(720, 1280).setTint(0x294b54).setAlpha(0.42);
    this.add.rectangle(360, 640, 720, 1280, 0x02080d, 0.76);
    addPanel(this, 70, 420, 580, 360, COLORS.cyan, 0.98);
    addTitle(this, "항해의 기억", 490, 32);
    this.add.text(W / 2, 555, `EP${cutscene.episode} · ${cutscene.title}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#f1d07a",
    }).setOrigin(0.5);
    this.add.text(W / 2, 620, "전체 에피소드 파일을 확인하고 있습니다.\n영상이 없거나 읽을 수 없으면 편성 화면으로 바로 계속합니다.", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(16)}px`, lineSpacing: 10, color: "#b7ceca", align: "center",
      wordWrap: { width: 500 },
    }).setOrigin(0.5);
    addButton(this, W / 2, 715, "영상 건너뛰고 편성", {
      width: 360,
      height: 64,
      accent: 0x69858a,
      fontSize: 16,
      onClick: () => void this.skipBeforeCutscene(),
    });
  }

  private async resolveBeforeCutscene(cutscene: CutsceneDefinition): Promise<void> {
    const available = await probeCutsceneAsset(cutscene);
    if (this.cutsceneGateResolved || !this.scene.isActive()) return;
    if (!available) {
      try {
        await getServices().save.update((draft) => markCutsceneSeen(draft, cutscene.id));
      } catch {
        // Optional video persistence must never block party setup.
      }
      this.openPartyUi();
      return;
    }
    this.cutsceneGateResolved = true;
    fadeTo(this, "Cutscene", {
      cutsceneId: cutscene.id,
      nextScene: "Party",
      nextData: {
        stageId: this.stageId,
        fromHarbor: this.fromHarbor,
        endgameMode: this.endgameMode,
        cutsceneChecked: true,
      },
    });
  }

  private async skipBeforeCutscene(): Promise<void> {
    if (this.cutsceneGateResolved) return;
    this.cutsceneGateResolved = true;
    const cutscene = this.pendingBeforeCutscene;
    if (cutscene) {
      try {
        await getServices().save.update((draft) => markCutsceneSeen(draft, cutscene.id));
      } catch {
        // A memory marker failure cannot block party setup.
      }
    }
    this.showPartyUi();
  }

  private render(): void {
    setUiEscapeHandler(this, undefined);
    setUiFocusScope(this, "base");
    this.children.removeAll(true);
    const services = getServices();
    const save = services.save.getSnapshot();
    if (this.endgameMode === "scyllaRaid") {
      this.renderRaidSquads(save);
      return;
    }
    this.add.image(360, 640, "arena-cyclops").setDisplaySize(720, 1280).setTint(0x4c746e).setAlpha(0.42);
    this.add.rectangle(360, 640, 720, 1280, 0x031017, 0.52);
    addAtmosphere(this, 0x9ee9dc, 16);
    addTopBar(this, "선원 편성", () => fadeTo(this, this.fromHarbor ? "Harbor" : this.endgameMode ? "Endgame" : "Route", this.stageId && !this.endgameMode ? { routeId: STAGE_BY_ID[this.stageId]!.routeId } : undefined));
    addTitle(this, this.stageId ? STAGE_BY_ID[this.stageId]!.name : "아르고냥의 선원", 126, 28);
    const preview = this.stageId ? getStageRewardPreview(save, this.stageId) : undefined;
    const endgameReward = this.stageId && this.endgameMode
      ? getEndgameRewardPlan(save, this.endgameMode, this.stageId)
      : undefined;
    const endgamePreview = this.stageId && this.endgameMode
      ? getEndgameBattlePreview(save, this.endgameMode, STAGE_BY_ID[this.stageId]!)
      : undefined;
    const partyRules = this.endgameMode ? getEndgamePartyRules(save, this.endgameMode) : undefined;
    const authoredRecommendedPower = endgamePreview?.recommendedPower
      ?? (this.endgameMode === "oracleTower"
        ? awaitlessOraclePower(save.endgame.oracleTowerFloor)
        : STAGE_BY_ID[this.stageId ?? ""]?.recommendedPower);
    const requiresFullParty = this.endgameMode === "stormRoute";
    const displayedPartySize = requiresFullParty
      ? CAMPAIGN_PARTY_MAX_SIZE
      : Math.max(CAMPAIGN_PARTY_MIN_SIZE, this.selected.length);
    const displayedRecommendedPower = recommendedPowerForPartySize(authoredRecommendedPower, displayedPartySize);
    const powerAssessment = assessPartyPower(save, this.selected, displayedRecommendedPower);
    const selectionReady = requiresFullParty
      ? this.selected.length === CAMPAIGN_PARTY_MAX_SIZE
      : this.selected.length >= CAMPAIGN_PARTY_MIN_SIZE
        && this.selected.length <= CAMPAIGN_PARTY_MAX_SIZE;
    const sortieLabel = requiresFullParty ? "3인 필수" : "1~3인 출전";
    const powerAccent = powerAssessment.level === "danger"
      ? COLORS.red
      : powerAssessment.level === "caution"
        ? 0xd69a57
        : COLORS.cyan;
    const powerPlate = this.add.graphics();
    powerPlate.fillStyle(0x05161d, 0.92)
      .lineStyle(2, powerAccent, 0.8)
      .fillRoundedRect(48, 153, 624, 40, 12)
      .strokeRoundedRect(48, 153, 624, 40, 12);
    this.add.text(W / 2, 173, this.stageId
      ? `전투력 ${powerAssessment.currentPower.toLocaleString()} / 권장(${displayedPartySize}인 환산) ${displayedRecommendedPower?.toLocaleString() ?? "-"}  ·  ${powerAssessment.label}  ·  ${partyRules?.label ? `${partyRules.label} · ` : ""}${sortieLabel}`
      : `파티 전투력 ${powerAssessment.currentPower.toLocaleString()}  ·  전투에 나설 동료를 1~3명 선택하세요`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`,
      color: powerAssessment.level === "danger" ? "#ffc3b0" : powerAssessment.level === "caution" ? "#ffd39b" : "#9de8df",
      fixedWidth: 600, align: "center",
    }).setOrigin(0.5);
    const summaryText = endgameReward && endgamePreview
      ? `${this.endgameRewardPreviewText(endgameReward)} · ${endgamePreview.ruleLabels.join(" · ") || "추가 전투 규칙 없음"}`
      : preview
        ? `반복 골드 ${preview.repeatable.gold} · XP ${preview.repeatable.heroXp} | ${formatFirstClearPreview(preview).replace("\n", " · ")}`
        : "선원과 유물을 조합해 다음 항해를 준비하세요";
    this.add.text(48, 211, summaryText, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(10)}px`,
      color: preview?.firstClear.claimed ? "#78918e" : endgameReward ? "#9ddbd3" : "#e4c77f",
      fixedWidth: 500, align: "left",
    }).setOrigin(0, 0.5).setMaxLines(1);
    this.add.text(672, 211, `출전 ${this.selected.length} / 3`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: "#e5c97e",
    }).setOrigin(1, 0.5);

    const slotsX = [140, 360, 580];
    for (let i = 0; i < 3; i += 1) {
      const hero = HEROES.find((entry) => entry.id === this.selected[i]);
      this.drawPartySlot(slotsX[i]!, 318, hero, i, save);
    }

    const focused = HEROES.find((hero) => hero.id === this.focusedHeroId)
      ?? HEROES.find((hero) => save.roster.ownedHeroIds.includes(hero.id));
    if (focused) this.drawHeroDetail(focused, save);

    this.add.text(40, 678, this.partyPanel === "roster" ? `승선 명부  ${save.roster.ownedHeroIds.length}명` : "편성 도구", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(17)}px`, color: "#e5c97e",
    }).setOrigin(0, 0.5);
    addButton(this, 500, 680, "선원 명부", {
      width: 112, height: 40, fontSize: 11,
      accent: this.partyPanel === "roster" ? COLORS.gold : 0x547477,
      focusKey: "party-panel-roster",
      onClick: () => { this.partyPanel = "roster"; this.requestRender(); },
    });
    addButton(this, 624, 680, "자동·프리셋", {
      width: 124, height: 40, fontSize: 11,
      accent: this.partyPanel === "tools" ? COLORS.gold : 0x547477,
      focusKey: "party-panel-tools",
      onClick: () => { this.partyPanel = "tools"; this.requestRender(); },
    });
    if (this.partyPanel === "roster") this.renderRosterManager(save);
    else this.renderPartyTools(save, authoredRecommendedPower);
    const bottomY = 1210;
    addButton(this, W / 2, bottomY, this.stageId ? "전투 개시" : "편성 저장", {
      width: 390, height: 66, icon: this.stageId ? "⚔" : "✓", enabled: selectionReady,
      focusKey: "party-confirm",
      subtitle: selectionReady
        ? powerAssessment.level === "danger"
          ? "고위험 편성 · 출전은 가능합니다"
          : this.selected.length < CAMPAIGN_PARTY_MAX_SIZE ? `${this.selected.length}명으로 출전합니다` : undefined
        : requiresFullParty ? "폭풍 항로는 세 명이 필요합니다" : "최소 한 명을 편성하세요",
      onClick: () => this.confirmParty(),
    });
    ensureUiFocus(this, [
      this.focusedHeroId ? `party-roster-hero-${this.focusedHeroId}` : "",
      this.selected[0] ? `party-selected-hero-${this.selected[0]}` : "",
      this.partyPanel === "roster" ? "party-panel-roster" : "party-panel-tools",
      "party-confirm",
    ]);
  }

  private renderRosterManager(save: GameSaveV1): void {
    addPanel(this, 32, 708, 656, 438, 0x547b7c, 0.94);
    addButton(this, 110, 738, `역할 · ${ROLE_FILTER_LABEL[this.roleFilter]}`, {
      width: 144, height: 44, fontSize: 10,
      focusKey: "party-filter-role",
      onClick: () => {
        this.roleFilter = nextValue(ROLE_FILTERS, this.roleFilter);
        this.rosterPage = 0;
        this.requestRender();
      },
    });
    addButton(this, 276, 738, `속성 · ${ELEMENT_FILTER_LABEL[this.elementFilter]}`, {
      width: 144, height: 44, fontSize: 10,
      focusKey: "party-filter-element",
      onClick: () => {
        this.elementFilter = nextValue(ELEMENT_FILTERS, this.elementFilter);
        this.rosterPage = 0;
        this.requestRender();
      },
    });
    addButton(this, 444, 738, `레벨 · ${LEVEL_FILTER_LABEL[this.levelFilter]}`, {
      width: 144, height: 44, fontSize: 10,
      focusKey: "party-filter-level",
      onClick: () => {
        this.levelFilter = nextValue(LEVEL_FILTERS, this.levelFilter);
        this.rosterPage = 0;
        this.requestRender();
      },
    });
    addButton(this, 610, 738, `정렬 · ${SORT_LABEL[this.sortMode]}`, {
      width: 144, height: 44, fontSize: 10,
      focusKey: "party-sort",
      onClick: () => {
        this.sortMode = nextValue(SORT_MODES, this.sortMode);
        this.rosterPage = 0;
        this.requestRender();
      },
    });

    const heroes = queryOwnedHeroes(save, {
      role: this.roleFilter,
      element: this.elementFilter,
      level: this.levelFilter,
      sort: this.sortMode,
    });
    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(heroes.length / pageSize));
    this.rosterPage = Phaser.Math.Clamp(this.rosterPage, 0, pageCount - 1);
    const page = heroes.slice(this.rosterPage * pageSize, this.rosterPage * pageSize + pageSize);
    this.add.text(52, 778, `검색 결과 ${heroes.length}명`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(11)}px`, color: "#9fc5c0",
    });
    this.add.text(668, 778, `함대 유물 ${save.inventory.equippedRelicIds.length} / 3`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(11)}px`, color: "#9ddbd3",
    }).setOrigin(1, 0);
    page.forEach((hero, index) => {
      const column = index % 5;
      const row = Math.floor(index / 5);
      this.drawRosterHero(94 + column * 133, 842 + row * 110, hero, save, true);
    });
    if (!page.length) {
      this.add.text(W / 2, 912, "조건에 맞는 보유 선원이 없습니다\n필터를 한 번 더 눌러 바꿔 보세요", {
        fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, color: "#78918e", align: "center", lineSpacing: 8,
      }).setOrigin(0.5);
    }
    addButton(this, 120, 1092, "‹", {
      width: 82, height: 44, enabled: this.rosterPage > 0,
      focusKey: "party-roster-page-previous",
      onClick: () => { this.rosterPage -= 1; this.requestRender(); },
    });
    this.add.text(W / 2, 1092, `${this.rosterPage + 1} / ${pageCount}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color: "#b2d7d1",
    }).setOrigin(0.5);
    addButton(this, 600, 1092, "›", {
      width: 82, height: 44, enabled: this.rosterPage + 1 < pageCount,
      focusKey: "party-roster-page-next",
      onClick: () => { this.rosterPage += 1; this.requestRender(); },
    });
  }

  private renderPartyTools(save: GameSaveV1, recommendedPower?: number): void {
    const stage = this.stageId ? STAGE_BY_ID[this.stageId] : undefined;
    const rules = this.endgameMode ? getEndgamePartyRules(save, this.endgameMode) : undefined;
    const restrictions = {
      lockedHeroIds: rules?.lockedHeroIds ?? [],
      forbiddenClasses: rules?.forbiddenClasses ?? [],
    };
    addPanel(this, 32, 708, 656, 438, 0x547b7c, 0.94);
    addPanel(this, 46, 722, 628, 202, COLORS.cyan, 0.95);
    this.add.text(62, 738, stage ? `전술 추천 · ${this.objectiveName(stage.objective.type)}` : "전술 추천", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(15)}px`, color: "#dff7f2",
    });
    this.add.text(62, 779, "추천 인원", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(12)}px`, color: "#9fc5c0",
    }).setOrigin(0, 0.5);
    ([1, 2, 3] as const).forEach((size, index) => {
      const stormLocked = this.endgameMode === "stormRoute" && size !== 3;
      addButton(this, 190 + index * 62, 779, String(size), {
        width: 52, height: 40, fontSize: 13, enabled: !stormLocked,
        accent: this.recommendationSize === size ? COLORS.gold : 0x547477,
        focusKey: `party-recommend-size-${size}`,
        onClick: () => {
          this.recommendationSize = size;
          this.recommendation = undefined;
          this.requestRender();
        },
      });
    });
    addButton(this, 528, 779, stage ? `${this.recommendationSize}인 자동 추천` : "스테이지 선택 필요", {
      width: 250, height: 46, fontSize: 13, enabled: Boolean(stage), icon: stage ? "✦" : undefined,
      accent: COLORS.gold,
      focusKey: "party-recommend-apply",
      onClick: () => this.applyRecommendation(),
    });
    const recommendationLines = this.recommendation?.reasons
      ?? (stage
        ? ["목표·위험·적 구성을 분석해 보유 선원만 추천합니다.", "잠긴 영웅과 금지 역할은 자동으로 제외합니다."]
        : ["항로에서 스테이지를 선택하면 전술 추천을 사용할 수 있습니다."]);
    this.add.text(62, 820, recommendationLines.map((line) => `• ${line}`).join("\n"), {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(11)}px`, lineSpacing: 7, color: "#b9d7d2",
      wordWrap: { width: 586 }, fixedWidth: 586,
    });

    this.add.text(50, 944, "편성 프리셋 · 1~3인 저장", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#e5c97e",
    });
    for (let slot = 0; slot < 3; slot += 1) {
      const y = 991 + slot * 57;
      const rawPreset = save.roster.partyPresets[slot] ?? [];
      const preset = readPartyPreset(save, slot, restrictions);
      const cleaned = rawPreset.length !== preset.length || rawPreset.some((heroId, index) => heroId !== preset[index]);
      addPanel(this, 46, y - 23, 628, 48, preset.length ? 0x759c94 : 0x455e62, 0.96);
      this.add.text(60, y - 13, `P${slot + 1}`, {
        fontFamily: "Georgia, serif", fontStyle: "bold", fontSize: `${uiTextSize(15)}px`, color: preset.length ? "#f2d783" : "#71898a",
      });
      const names = preset.map((heroId) => HERO_BY_ID[heroId]?.name ?? heroId).join(" · ");
      this.add.text(100, y - 13, names || (cleaned ? "사용 불가 영웅 자동 정리" : "빈 프리셋"), {
        fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(10)}px`, color: preset.length ? "#cce3dc" : "#748b8c",
        fixedWidth: 280, wordWrap: { width: 280 },
      });
      if (preset.length > 0 && !this.presetBusy) {
        addFocusableHitArea(this, 218, y, 336, 44, {
          focusKey: `party-preset-card-${slot}`,
          onActivate: () => void this.loadPreset(slot),
        });
      }
      addButton(this, 425, y, "불러오기", {
        width: 86, height: 38, fontSize: 10, enabled: preset.length > 0 && !this.presetBusy,
        focusKey: `party-preset-load-${slot}`,
        onClick: () => void this.loadPreset(slot),
      });
      addButton(this, 531, y, "저장/덮기", {
        width: 106, height: 38, fontSize: 10, enabled: this.selected.length > 0 && !this.presetBusy,
        accent: COLORS.gold,
        focusKey: `party-preset-save-${slot}`,
        onClick: () => void this.savePreset(slot),
      });
      addButton(this, 638, y, "삭제", {
        width: 70, height: 38, fontSize: 10, enabled: rawPreset.length > 0 && !this.presetBusy,
        accent: COLORS.red,
        focusKey: `party-preset-delete-${slot}`,
        onClick: () => void this.deletePreset(slot),
      });
    }
  }

  private renderRaidSquads(
    save: ReturnType<ReturnType<typeof getServices>["save"]["getSnapshot"]>,
  ): void {
    this.add.image(360, 640, "arena-cyclops").setDisplaySize(720, 1280).setTint(0x344f68).setAlpha(0.48);
    this.add.rectangle(360, 640, 720, 1280, 0x020a12, 0.64);
    addAtmosphere(this, 0x9bc4e8, 18);
    addTopBar(this, "스킬라 3분대 편성", () => fadeTo(this, "Endgame"));
    const phaseIndex = Math.min(2, save.endgame.scyllaRaid.phaseIndex);
    const phase = ENDGAME.raid.phases[phaseIndex]!;
    const validation = validateScyllaRaidSquads(save, this.raidSquads);
    const raidLocked = save.endgame.scyllaRaid.active && validation.valid;
    addTitle(this, save.endgame.scyllaRaid.active ? `${phaseIndex + 1}페이즈 출항 준비` : "중복 없는 12명을 선택", 135, 28);
    this.add.text(W / 2, 174, `${phase.name}  ·  ${phase.objective.turnLimit}턴`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#a9d8e5",
    }).setOrigin(0.5);
    this.add.text(W / 2, 199, save.endgame.scyllaRaid.active
      ? "토벌 중에는 분대를 바꿀 수 없습니다. 앞 페이즈의 파괴 상태가 이어집니다."
      : "각 분대 4명 · 영웅 중복 불가 · 세 전투를 모두 이겨야 최종 보상",
    { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(11)}px`, color: "#8eaab2" }).setOrigin(0.5);

    const slotXs = [115, 278, 441, 604];
    for (let partyIndex = 0; partyIndex < 3; partyIndex += 1) {
      const y = 290 + partyIndex * 174;
      const active = phaseIndex === partyIndex;
      addPanel(this, 34, y - 64, 652, 142, active ? COLORS.gold : 0x45687a, 0.94);
      this.add.text(56, y - 50, `${partyIndex + 1}분대${active ? "  ◀ 출전" : ""}`, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: active ? "#f2d479" : "#91b5c2",
      });
      for (let slot = 0; slot < 4; slot += 1) {
        const heroId = this.raidSquads[partyIndex]?.[slot];
        const hero = heroId ? HERO_BY_ID[heroId] : undefined;
        const x = slotXs[slot]!;
        const cy = y + 15;
        this.add.circle(x, cy, 43, hero ? 0x12323f : 0x101c23, 0.98)
          .setStrokeStyle(3, hero ? this.elementColor(hero.element) : 0x3d4e55, 0.9);
        if (hero) {
          const texture = resolveHeroTexture(this.textures, hero);
          const image = this.add.image(x, cy - 5, texture).setDisplaySize(72, 72);
          if (texture === HERO_FALLBACK_TEXTURE_KEY) image.setTint(this.elementColor(hero.element));
          this.add.text(x, cy + 51, hero.name, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(10)}px`, color: "#f1e4bd" }).setOrigin(0.5);
          if (!raidLocked) {
            addFocusableHitArea(this, x, cy, 100, 112, {
              focusKey: `party-raid-slot-${partyIndex}-${hero.id}`,
              onActivate: () => {
                this.raidSquads[partyIndex] = (this.raidSquads[partyIndex] ?? []).filter((id) => id !== hero.id);
                this.render();
              },
            });
          }
        } else {
          this.add.text(x, cy, "+", { fontFamily: "Georgia, serif", fontSize: `${uiTextSize(30)}px`, color: "#50636b" }).setOrigin(0.5);
        }
      }
    }

    this.add.text(34, 742, "보유 영웅 · 클릭하면 빈 분대에 순서대로 배치", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#dfc878",
    });
    const owned = HEROES.filter((hero) => save.roster.ownedHeroIds.includes(hero.id));
    owned.forEach((hero, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = 104 + column * 170;
      const y = 802 + row * 66;
      const selected = this.raidSquads.some((party) => party.includes(hero.id));
      addButton(this, x, y, selected ? `✓ ${hero.name}` : hero.name, {
        width: 154, height: 52, fontSize: 11, enabled: !raidLocked && !selected,
        accent: selected ? COLORS.gold : this.elementColor(hero.element),
        focusKey: `party-raid-roster-${hero.id}`,
        onClick: () => this.addRaidHero(hero.id),
      });
    });

    addButton(this, W / 2, 1198, save.endgame.scyllaRaid.active ? `${phaseIndex + 1}페이즈 전투 개시` : "토벌 출항", {
      width: 420, height: 72, icon: "⚔", enabled: validation.valid,
      subtitle: validation.valid ? "3개 분대 검증 완료" : validation.issues[0]?.message ?? "12명을 편성하세요",
      focusKey: "party-raid-confirm",
      onClick: () => this.confirmParty(),
    });
    ensureUiFocus(this, ["party-raid-confirm"]);
  }

  private addRaidHero(heroId: string): void {
    if (this.raidSquads.some((party) => party.includes(heroId))) return;
    const partyIndex = this.raidSquads.findIndex((party) => party.length < 4);
    if (partyIndex < 0) return;
    this.raidSquads[partyIndex]!.push(heroId);
    this.render();
  }

  private drawPartySlot(
    x: number,
    y: number,
    hero: HeroDefinition | undefined,
    index: number,
    save: ReturnType<ReturnType<typeof getServices>["save"]["getSnapshot"]>,
  ): void {
    const g = this.add.graphics();
    g.fillStyle(0x0a242c, 0.95).lineStyle(4, hero ? this.elementColor(hero.element) : 0x405055, 0.9).fillCircle(x, y, 68).strokeCircle(x, y, 68);
    if (hero) {
      const progress = getHeroXpProgress(save, hero.id);
      const texture = resolveHeroTexture(this.textures, hero);
      const image = this.add.image(x, y - 6, texture).setDisplaySize(texture === HERO_FALLBACK_TEXTURE_KEY ? 102 : 126, texture === HERO_FALLBACK_TEXTURE_KEY ? 102 : 126);
      if (texture === HERO_FALLBACK_TEXTURE_KEY) image.setTint(this.elementColor(hero.element));
      this.add.text(x, y + 79, hero.name, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#f7e7bb" }).setOrigin(0.5);
      this.add.text(x, y + 101, `Lv.${progress?.level ?? 1}${progress?.awakening ? `  ✦${progress.awakening}` : ""}`, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(12)}px`, color: "#8fded5" }).setOrigin(0.5);
      addFocusableHitArea(this, x, y, 156, 190, {
        focusKey: `party-selected-hero-${hero.id}`,
        onActivate: () => {
          this.focusedHeroId = hero.id;
          this.selected.splice(index, 1);
          this.recommendation = undefined;
          this.requestRender();
        },
      });
    } else {
      this.add.text(x, y, "+", { fontFamily: "Georgia, serif", fontSize: `${uiTextSize(46)}px`, color: "#5d7374" }).setOrigin(0.5);
      this.add.text(x, y + 83, "빈 자리", { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: "#687b7b" }).setOrigin(0.5);
    }
  }

  private drawRosterHero(
    x: number,
    y: number,
    hero: HeroDefinition,
    save: ReturnType<ReturnType<typeof getServices>["save"]["getSnapshot"]>,
    owned: boolean,
  ): void {
    const rules = this.endgameMode ? getEndgamePartyRules(save, this.endgameMode) : undefined;
    const locked = Boolean(rules?.lockedHeroIds.includes(hero.id));
    const classBlocked = Boolean(rules?.forbiddenClasses.includes(hero.ricochetClass));
    const usable = owned && !locked && !classBlocked;
    const selectedIndex = this.selected.indexOf(hero.id);
    const selected = selectedIndex >= 0;
    const focused = this.focusedHeroId === hero.id;
    const progress = owned ? getHeroXpProgress(save, hero.id) : undefined;
    const g = this.add.graphics();
    g.fillStyle(!usable ? 0x10171a : selected ? 0x18424a : 0x0a2128, 0.98)
      .lineStyle(focused ? 4 : 2, focused ? COLORS.cyan : selected ? COLORS.gold : usable ? this.elementColor(hero.element) : 0x455052, focused || selected ? 1 : 0.7)
      .fillRoundedRect(x - 60, y - 48, 120, 96, 15)
      .strokeRoundedRect(x - 60, y - 48, 120, 96, 15);
    const texture = resolveHeroTexture(this.textures, hero);
    const image = this.add.image(x, y - 16, texture).setDisplaySize(texture === HERO_FALLBACK_TEXTURE_KEY ? 62 : 72, texture === HERO_FALLBACK_TEXTURE_KEY ? 62 : 72);
    if (texture === HERO_FALLBACK_TEXTURE_KEY) image.setTint(this.elementColor(hero.element));
    if (!usable) image.setTint(0x233237).setAlpha(0.42);
    const unavailableLabel = locked ? "항로 이탈" : classBlocked ? "층 규칙 금지" : "잠긴 동료";
    this.add.text(x, y + 21, usable ? hero.name : unavailableLabel, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(11)}px`, color: usable ? "#f7e7bb" : "#738083", align: "center", wordWrap: { width: 110 } }).setOrigin(0.5);
    this.add.text(x, y + 38, usable ? `Lv.${progress?.level ?? 1} · ${this.className(hero.ricochetClass).replace("형", "")}` : locked ? "이번 도전 잠금" : classBlocked ? this.className(hero.ricochetClass) : hero.unlock === "story" ? "스토리" : "신탁", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(10)}px`, color: usable ? "#8fded5" : "#59676a" }).setOrigin(0.5);
    if (selected) this.add.text(x + 46, y - 39, String(selectedIndex + 1), { fontFamily: "Georgia, serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color: "#07151b", backgroundColor: "#e4bc61", padding: { x: 5, y: 1 } }).setOrigin(0.5);
    addFocusableHitArea(this, x, y, 126, 102, {
      focusKey: `party-roster-hero-${hero.id}`,
      focusable: usable,
      onActivate: () => {
        if (!usable) {
          addToast(this, locked ? "이 영웅은 현재 연속 도전에서 잠겨 있습니다" : classBlocked ? "현재 층은 이 클래스의 출전을 금지합니다" : hero.unlock === "story" ? "메인 항해를 진행하면 승선하는 동료입니다" : "별의 신탁에서 만날 수 있는 동료입니다", COLORS.red);
          return;
        }
        this.focusedHeroId = hero.id;
        this.requestRender();
      },
    });
  }

  private drawHeroDetail(
    hero: HeroDefinition,
    save: ReturnType<ReturnType<typeof getServices>["save"]["getSnapshot"]>,
  ): void {
    const x = 32;
    const y = 446;
    addPanel(this, x, y, 656, 208, this.elementColor(hero.element), 0.97);
    const profile = getHeroCombatProfile(save, hero);
    const progress = getHeroXpProgress(save, hero.id)!;
    const texture = resolveHeroTexture(this.textures, hero);
    const image = this.add.image(102, 539, texture).setDisplaySize(
      texture === HERO_FALLBACK_TEXTURE_KEY ? 108 : 126,
      texture === HERO_FALLBACK_TEXTURE_KEY ? 108 : 126,
    );
    if (texture === HERO_FALLBACK_TEXTURE_KEY) image.setTint(this.elementColor(hero.element));

    this.add.text(170, 468, `${hero.name}  Lv.${progress.level}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(20)}px`, color: "#f7e7bb",
    });
    this.add.text(170, 495, `${hero.epithet}  ·  ${this.className(hero.ricochetClass)}  ·  각성 ${progress.awakening}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#9dc1bd",
    });

    const barX = 170;
    const barY = 521;
    const barWidth = 360;
    const ratio = progress.maxLevel
      ? 1
      : progress.atLevelCap
        ? 1
        : Phaser.Math.Clamp(progress.currentXp / Math.max(1, progress.xpToNextLevel), 0, 1);
    const bar = this.add.graphics();
    bar.fillStyle(0x031015, 0.95).fillRoundedRect(barX, barY, barWidth, 13, 7);
    bar.fillStyle(progress.atLevelCap ? COLORS.gold : COLORS.cyan, 0.95)
      .fillRoundedRect(barX + 2, barY + 2, (barWidth - 4) * ratio, 9, 5);
    const xpLabel = progress.maxLevel
      ? "MAX"
      : progress.atLevelCap
        ? `각성 필요 · XP ${progress.currentXp.toLocaleString()} 보관 중`
        : `XP ${progress.currentXp.toLocaleString()} / ${progress.xpToNextLevel.toLocaleString()}`;
    this.add.text(barX + barWidth - 6, barY + 6, xpLabel, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(9)}px`, color: progress.atLevelCap ? "#fff0a8" : "#d7f3ef",
      fixedWidth: barWidth - 12, align: "right",
    }).setOrigin(1, 0.5);

    this.add.text(170, 550, `HP  ${profile.stats.hp.toLocaleString()}`, this.statTextStyle("#8ed9c6"));
    this.add.text(300, 550, `ATK  ${profile.stats.attack.toLocaleString()}`, this.statTextStyle("#f0bd73"));
    this.add.text(430, 550, `SPD  ${profile.stats.speed.toLocaleString()}`, this.statTextStyle("#8fbfe8"));
    this.add.text(170, 574, `우정  ✦  ${hero.friendshipSkill.name}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color: "#ecd58d",
    });
    this.add.text(170, 593, this.friendshipEffectText(hero), {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(10)}px`, color: "#a9c8c4", wordWrap: { width: 390 },
    });
    this.add.text(170, 613, `액티브  ◆  ${hero.activeSkill.name}  ·  충전 ${hero.activeSkill.chargeTurns}턴`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(12)}px`, color: "#9ff6e9",
    });
    this.add.text(170, 633, this.activeEffectText(hero), {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(9)}px`, color: "#9abfba", wordWrap: { width: 390 },
    });

    const selected = this.selected.includes(hero.id);
    const full = this.selected.length >= CAMPAIGN_PARTY_MAX_SIZE;
    const rules = this.endgameMode ? getEndgamePartyRules(save, this.endgameMode) : undefined;
    const restricted = Boolean(rules?.lockedHeroIds.includes(hero.id) || rules?.forbiddenClasses.includes(hero.ricochetClass));
    addButton(this, 618, 584, selected ? "편성 해제" : full ? "마지막 슬롯 교체" : "편성", {
      width: 112,
      height: 50,
      fontSize: 14,
      enabled: !restricted,
      accent: selected ? COLORS.red : COLORS.gold,
      focusKey: `party-toggle-hero-${hero.id}`,
      onClick: () => this.toggleHero(hero.id),
    });
    addButton(this, 618, 520, "성장 · 유물", {
      width: 112,
      height: 48,
      fontSize: 12,
      accent: COLORS.cyan,
      focusKey: `party-growth-hero-${hero.id}`,
      onClick: () => this.showGrowthModal(hero.id),
    });
  }

  private showGrowthModal(heroId: string): void {
    const services = getServices();
    const save = services.save.getSnapshot();
    const hero = HERO_BY_ID[heroId];
    if (!hero || !save.roster.ownedHeroIds.includes(heroId)) return;
    setUiFocusScope(this, "party-growth");
    setUiEscapeHandler(this, () => this.closeGrowthModal(heroId));
    const progress = getHeroXpProgress(save, heroId)!;
    const levelQuote = quoteLevelUpgrade(save, heroId, 1);
    const ascensionQuote = quoteAscension(save, heroId);
    this.add.rectangle(W / 2, 640, 720, 1280, 0x010507, 0.9)
      .setDepth(2000)
      .setInteractive();
    addPanel(this, 32, 118, 656, 1040, COLORS.cyan, 0.995).setDepth(2001);
    this.add.text(64, 150, `${hero.name} 성장`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(27)}px`, color: "#f6e5b6",
    }).setDepth(2002);
    this.add.text(64, 190, `Lv.${progress.level} / ${progress.levelCap}  ·  각성 ${progress.awakening}  ·  조각 ${save.roster.heroShards[heroId] ?? 0}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: "#a8d3cf",
    }).setDepth(2002);
    this.add.text(656, 154, `골드 ${save.resources.gold.toLocaleString()}\n각성석 ${save.resources.awakeningMaterials}  ·  유물 가루 ${save.resources.relicDust}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#c5d8d4", align: "right", lineSpacing: 5,
    }).setOrigin(1, 0).setDepth(2002);

    addPanel(this, 58, 235, 604, 128, COLORS.gold, 0.97).setDepth(2002);
    this.add.text(82, 256, "영웅 훈련", this.modalHeading()).setDepth(2003);
    this.add.text(82, 292, isMetaFailure(levelQuote)
      ? this.metaFailureLabel(levelQuote.code, levelQuote.message)
      : `다음 레벨 비용  골드 ${levelQuote.gold.toLocaleString()}`,
    { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, color: "#b9cbc7" }).setDepth(2003);
    addButton(this, 566, 300, "1레벨 훈련", {
      width: 164, height: 60, fontSize: 13,
      enabled: !isMetaFailure(levelQuote) && save.resources.gold >= levelQuote.gold && !this.growthBusy,
      focusKey: "party-growth-train",
      onClick: () => void this.trainHero(heroId),
    }).setDepth(2004);

    addPanel(this, 58, 382, 604, 128, 0x9d79bd, 0.97).setDepth(2002);
    this.add.text(82, 404, "한계 돌파", this.modalHeading()).setDepth(2003);
    this.add.text(82, 440, isMetaFailure(ascensionQuote)
      ? this.metaFailureLabel(ascensionQuote.code, ascensionQuote.message)
      : `골드 ${ascensionQuote.gold.toLocaleString()} · 조각 ${ascensionQuote.shards} · 각성석 ${ascensionQuote.awakeningMaterials}`,
    { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, color: "#c8badd", wordWrap: { width: 390 } }).setDepth(2003);
    addButton(this, 566, 447, "각성", {
      width: 164, height: 60, fontSize: 13,
      enabled: !isMetaFailure(ascensionQuote)
        && save.resources.gold >= ascensionQuote.gold
        && (save.roster.heroShards[heroId] ?? 0) >= ascensionQuote.shards
        && save.resources.awakeningMaterials >= ascensionQuote.awakeningMaterials
        && !this.growthBusy,
      accent: 0x9d79bd,
      focusKey: "party-growth-ascend",
      onClick: () => void this.ascendSelectedHero(heroId),
    }).setDepth(2004);

    this.add.text(64, 544, `함대 유물  ${save.inventory.equippedRelicIds.length} / 3`, this.modalHeading()).setDepth(2003);
    const equippedNames = save.inventory.equippedRelicIds.map((id) => {
      const relic = RELIC_BY_ID[id];
      return relic ? `${relic.name} +${save.inventory.relicLevels[id] ?? 1}` : id;
    });
    this.add.text(64, 579, equippedNames.length ? equippedNames.join("  ·  ") : "장착된 유물이 없습니다", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#9fc4c0", wordWrap: { width: 590 },
    }).setDepth(2003);

    const ownedRelics = RELICS.filter((relic) => save.inventory.relicIds.includes(relic.id));
    const pageCount = Math.max(1, Math.ceil(ownedRelics.length / 6));
    this.relicPage = Phaser.Math.Clamp(this.relicPage, 0, pageCount - 1);
    const pageRelics = ownedRelics.slice(this.relicPage * 6, this.relicPage * 6 + 6);
    if (!this.focusedRelicId || !save.inventory.relicIds.includes(this.focusedRelicId)) {
      this.focusedRelicId = pageRelics[0]?.id;
    }
    pageRelics.forEach((relic, index) => {
      const x = index % 2 === 0 ? 210 : 510;
      const y = 645 + Math.floor(index / 2) * 74;
      const equipped = save.inventory.equippedRelicIds.includes(relic.id);
      const level = save.inventory.relicLevels[relic.id] ?? 1;
      addButton(this, x, y, `${equipped ? "✓ " : ""}${relic.name}`, {
        width: 278, height: 60, fontSize: 11,
        subtitle: `T${relic.tier} · +${level}`,
        accent: this.focusedRelicId === relic.id ? COLORS.gold : equipped ? COLORS.cyan : 0x54787a,
        focusKey: `party-growth-relic-${relic.id}`,
        onClick: () => {
          this.focusedRelicId = relic.id;
          void this.toggleRelic(relic.id, heroId);
        },
      }).setDepth(2004);
    });
    if (!pageRelics.length) {
      this.add.text(W / 2, 700, "스테이지 첫 클리어로 유물을 획득하세요", {
        fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, color: "#78918e",
      }).setOrigin(0.5).setDepth(2003);
    }
    addButton(this, 126, 862, "‹", { width: 80, height: 46, enabled: this.relicPage > 0, focusKey: "party-growth-relic-previous", onClick: () => { this.relicPage -= 1; this.render(); this.showGrowthModal(heroId); } }).setDepth(2004);
    this.add.text(W / 2, 862, `${this.relicPage + 1} / ${pageCount}`, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, color: "#9fc4c0" }).setOrigin(0.5).setDepth(2003);
    addButton(this, 594, 862, "›", { width: 80, height: 46, enabled: this.relicPage + 1 < pageCount, focusKey: "party-growth-relic-next", onClick: () => { this.relicPage += 1; this.render(); this.showGrowthModal(heroId); } }).setDepth(2004);

    const focusedRelic = this.focusedRelicId ? RELIC_BY_ID[this.focusedRelicId] : undefined;
    const relicQuote = focusedRelic ? quoteRelicUpgrade(save, focusedRelic.id) : undefined;
    const materialPlan = relicQuote && !isMetaFailure(relicQuote)
      ? planRelicMaterialConsumption(save, relicQuote.materialUnits)
      : undefined;
    addPanel(this, 58, 900, 604, 116, focusedRelic?.tier === 3 ? COLORS.gold : 0x5f8588, 0.97).setDepth(2002);
    this.add.text(82, 919, focusedRelic ? `${focusedRelic.name} 정련` : "유물 정련", this.modalHeading()).setDepth(2003);
    this.add.text(82, 944, focusedRelic
      ? relicEffectLevelSummary(focusedRelic, save.inventory.relicLevels[focusedRelic.id] ?? 1)
      : "유물을 선택하면 실제 적용 효과를 확인할 수 있습니다",
    {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(10)}px`, color: "#f0d998",
      wordWrap: { width: 382 }, lineSpacing: -2,
    }).setDepth(2003);
    this.add.text(82, 988, focusedRelic
      ? isMetaFailure(relicQuote!)
        ? this.metaFailureLabel(relicQuote!.code, relicQuote!.message)
        : `골드 ${relicQuote!.gold} · 가루 ${relicQuote!.relicDust}\n차감 예정  ${this.materialPlanText(materialPlan!)}`
      : "유물을 선택하세요",
    { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(9)}px`, lineSpacing: 1, color: "#b9cbc7", wordWrap: { width: 385 } }).setDepth(2003);
    addButton(this, 566, 968, "정련", {
      width: 164, height: 56, fontSize: 13,
      enabled: Boolean(focusedRelic && relicQuote && !isMetaFailure(relicQuote)
        && save.resources.gold >= relicQuote.gold
        && save.resources.relicDust >= relicQuote.relicDust
        && Boolean(materialPlan?.sufficient)
        && !this.growthBusy),
      focusKey: "party-growth-refine-relic",
      onClick: () => focusedRelic && void this.refineRelic(focusedRelic.id, heroId),
    }).setDepth(2004);

    const materialEntries = Object.entries(save.resources.materials).sort(([, a], [, b]) => b - a);
    if (!this.focusedMaterialId || !save.resources.materials[this.focusedMaterialId]) {
      this.focusedMaterialId = materialEntries[0]?.[0];
    }
    const material = this.focusedMaterialId
      ? materialEntries.find(([id]) => id === this.focusedMaterialId)
      : undefined;
    addButton(this, 110, 1058, "재료 보관함", {
      width: 190, height: 62, fontSize: 12, enabled: materialEntries.length > 0,
      subtitle: `잠금 ${getLockedRelicMaterialIds(save).length}종`,
      focusKey: "party-growth-material-manager",
      onClick: () => this.showMaterialManager(heroId),
    }).setDepth(2004);
    addButton(this, 360, 1058, material && material[1] >= 5 ? "재료 5개 정제" : "정제 재료 부족", {
      width: 190, height: 62, fontSize: 11, enabled: Boolean(material && material[1] >= 5) && !this.growthBusy,
      subtitle: material ? `${resourceDisplayName(material[0])} → 유물 가루 25` : "같은 재료 5개 필요",
      focusKey: "party-growth-refine-material",
      onClick: () => material && void this.refineVoyageMaterial(material[0], heroId),
    }).setDepth(2004);
    addButton(this, 610, 1058, "각성석 보급", {
      width: 190, height: 62, fontSize: 11, subtitle: "10개 · 다이아 120", accent: 0x9d79bd,
      enabled: !this.growthBusy,
      focusKey: "party-growth-buy-awakening",
      onClick: () => void this.buyAwakeningMaterials(heroId),
    }).setDepth(2004);
    addButton(this, W / 2, 1120, "닫기", {
      width: 230, height: 52, focusKey: "party-growth-close", onClick: () => this.closeGrowthModal(heroId),
    }).setDepth(2005);
    ensureUiFocus(this, [
      "party-growth-train",
      "party-growth-ascend",
      this.focusedRelicId ? `party-growth-relic-${this.focusedRelicId}` : "",
      "party-growth-material-manager",
      "party-growth-close",
    ]);
  }

  private showMaterialManager(heroId: string): void {
    setUiFocusScope(this, "party-materials");
    setUiEscapeHandler(this, () => this.closeMaterialManager(heroId));
    const save = getServices().save.getSnapshot();
    const locked = new Set(getLockedRelicMaterialIds(save));
    const materials = Object.entries(save.resources.materials)
      .filter(([, amount]) => amount > 0)
      .sort(([idA, amountA], [idB, amountB]) => amountB - amountA || idA.localeCompare(idB));
    const pageSize = 6;
    const pageCount = Math.max(1, Math.ceil(materials.length / pageSize));
    this.materialPage = Phaser.Math.Clamp(this.materialPage, 0, pageCount - 1);
    const page = materials.slice(this.materialPage * pageSize, this.materialPage * pageSize + pageSize);

    this.add.rectangle(W / 2, 640, 720, 1280, 0x010507, 0.94).setDepth(3000).setInteractive();
    addPanel(this, 44, 160, 632, 900, COLORS.gold, 0.998).setDepth(3001);
    this.add.text(W / 2, 205, "재료 보관함 · 정련 잠금", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(25)}px`, color: "#f6e5b6",
    }).setOrigin(0.5).setDepth(3002);
    this.add.text(W / 2, 250, "잠근 재료는 유물 자동 정련에서 차감되지 않습니다. 직접 5개 정제는 가능합니다.", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#a8c9c3", align: "center", wordWrap: { width: 560 },
    }).setOrigin(0.5).setDepth(3002);
    page.forEach(([materialId, amount], index) => {
      const isLocked = locked.has(materialId);
      addButton(this, W / 2, 330 + index * 104, `${isLocked ? "🔒" : "◇"}  ${resourceDisplayName(materialId)}`, {
        width: 520, height: 78, fontSize: 15,
        subtitle: `보유 ${amount} · ${isLocked ? "정련 차감 보호 중" : "정련 차감 가능"}`,
        accent: isLocked ? 0x9d79bd : COLORS.cyan,
        focusKey: `party-material-${materialId}`,
        onClick: () => void this.toggleMaterialLock(heroId, materialId, !isLocked),
      }).setDepth(3003);
    });
    if (!page.length) {
      this.add.text(W / 2, 570, "보유한 항해 재료가 없습니다", {
        fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(17)}px`, color: "#78918e",
      }).setOrigin(0.5).setDepth(3002);
    }
    addButton(this, 126, 970, "‹", {
      width: 86, height: 48, enabled: this.materialPage > 0,
      focusKey: "party-material-previous",
      onClick: () => { this.materialPage -= 1; this.render(); this.showGrowthModal(heroId); this.showMaterialManager(heroId); },
    }).setDepth(3003);
    this.add.text(W / 2, 970, `${this.materialPage + 1} / ${pageCount}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: "#a8c9c3",
    }).setOrigin(0.5).setDepth(3002);
    addButton(this, 594, 970, "›", {
      width: 86, height: 48, enabled: this.materialPage + 1 < pageCount,
      focusKey: "party-material-next",
      onClick: () => { this.materialPage += 1; this.render(); this.showGrowthModal(heroId); this.showMaterialManager(heroId); },
    }).setDepth(3003);
    addButton(this, W / 2, 1022, "보관함 닫기", {
      width: 260, height: 52, focusKey: "party-material-close",
      onClick: () => this.closeMaterialManager(heroId),
    }).setDepth(3003);
    ensureUiFocus(this, [
      this.focusedMaterialId ? `party-material-${this.focusedMaterialId}` : "",
      page[0] ? `party-material-${page[0][0]}` : "",
      "party-material-close",
    ]);
  }

  private closeGrowthModal(heroId: string): void {
    setUiEscapeHandler(this, undefined);
    setUiFocusScope(this, "base", `party-growth-hero-${heroId}`);
    this.render();
    ensureUiFocus(this, [`party-growth-hero-${heroId}`]);
  }

  private closeMaterialManager(heroId: string): void {
    this.render();
    this.showGrowthModal(heroId);
    ensureUiFocus(this, ["party-growth-material-manager"]);
  }

  private async toggleMaterialLock(heroId: string, materialId: string, locked: boolean): Promise<void> {
    try {
      this.focusedMaterialId = materialId;
      await getServices().save.replace(setRelicMaterialLocked(getServices().save.getSnapshot(), materialId, locked));
      this.render();
      this.showGrowthModal(heroId);
      this.showMaterialManager(heroId);
      addToast(this, locked ? "정련 차감에서 보호했습니다" : "정련 차감 보호를 해제했습니다", COLORS.cyan);
    } catch {
      addToast(this, "재료 잠금을 저장하지 못했습니다", COLORS.red);
    }
  }

  private async trainHero(heroId: string): Promise<void> {
    const result = upgradeHeroLevel(getServices().save.getSnapshot(), heroId, 1);
    if (!result.ok) { addToast(this, this.metaFailureLabel(result.code, result.message), COLORS.red); return; }
    await this.persistGrowth(result.save, heroId, "훈련을 완료했습니다");
  }

  private async ascendSelectedHero(heroId: string): Promise<void> {
    const result = ascendHero(getServices().save.getSnapshot(), heroId);
    if (!result.ok) { addToast(this, this.metaFailureLabel(result.code, result.message), COLORS.red); return; }
    await this.persistGrowth(result.save, heroId, "각성 단계가 상승했습니다");
  }

  private async toggleRelic(relicId: string, heroId: string): Promise<void> {
    const save = getServices().save.getSnapshot();
    const result = save.inventory.equippedRelicIds.includes(relicId)
      ? unequipRelic(save, relicId)
      : equipRelic(save, relicId);
    if (isMetaFailure(result)) { addToast(this, this.metaFailureLabel(result.code, result.message), COLORS.red); return; }
    await this.persistGrowth(result, heroId, save.inventory.equippedRelicIds.includes(relicId) ? "유물을 해제했습니다" : "유물을 장착했습니다");
  }

  private async refineRelic(relicId: string, heroId: string): Promise<void> {
    const result = upgradeRelic(getServices().save.getSnapshot(), relicId);
    if (!result.ok) { addToast(this, this.metaFailureLabel(result.code, result.message), COLORS.red); return; }
    await this.persistGrowth(result.save, heroId, "유물을 정련했습니다");
  }

  private async refineVoyageMaterial(materialId: string, heroId: string): Promise<void> {
    const result = refineMaterial(getServices().save.getSnapshot(), materialId, 5);
    if (!result.ok) { addToast(this, this.metaFailureLabel(result.code, result.message), COLORS.red); return; }
    await this.persistGrowth(result.save, heroId, `유물 가루 +${result.relicDustGranted}`);
  }

  private async buyAwakeningMaterials(heroId: string): Promise<void> {
    if (this.growthBusy) return;
    this.growthBusy = true;
    try {
      const services = getServices();
      const result = await services.purchases.purchase({ actionId: "awakening-materials" });
      if (!result.ok) { addToast(this, result.message, COLORS.red); return; }
      reconcileWalletAfterPurchase(services, result);
      this.growthBusy = false;
      this.vaultWarningAccepted = false;
      this.render();
      this.showGrowthModal(heroId);
      addToast(this, "각성석 10개를 받았습니다", COLORS.cyan);
    } finally {
      this.growthBusy = false;
    }
  }

  private async persistGrowth(save: ReturnType<ReturnType<typeof getServices>["save"]["getSnapshot"]>, heroId: string, message: string): Promise<void> {
    if (this.growthBusy) return;
    this.growthBusy = true;
    const services = getServices();
    try {
      await services.save.replace(save);
      this.growthBusy = false;
      this.render();
      this.showGrowthModal(heroId);
      addToast(this, message, COLORS.cyan);
    } catch (error) {
      // replace() installs the normalized snapshot before the host confirms the write.
      // Retry that exact in-memory snapshot instead of letting another upgrade spend again.
      try {
        await services.save.saveNow();
        this.growthBusy = false;
        this.render();
        this.showGrowthModal(heroId);
        addToast(this, `${message} · 저장 지연 후 완료`, COLORS.cyan);
      } catch (retryError) {
        this.showGrowthSaveRetry(heroId, message, retryError ?? error);
      }
    }
  }

  private showGrowthSaveRetry(heroId: string, message: string, error: unknown): void {
    setUiFocusScope(this, "party-growth-save-retry", "party-growth-save-retry-button");
    let retrying = false;
    const shade = this.add.rectangle(W / 2, 640, 720, 1280, 0x010507, 0.94).setDepth(5000).setInteractive();
    addPanel(this, 72, 420, 576, 390, COLORS.red, 0.998).setDepth(5001);
    this.add.text(W / 2, 482, "성장 결과 저장이 지연되었습니다", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(25)}px`, color: "#ffd0c3",
    }).setOrigin(0.5).setDepth(5002);
    this.add.text(W / 2, 565, "재료와 성장 결과는 현재 게임에 이미 반영되어 있습니다.\n중복 차감을 막기 위해 저장이 끝날 때까지 다른 성장은 잠깁니다.", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, lineSpacing: 8, color: "#d8e3dd", align: "center",
      wordWrap: { width: 500 },
    }).setOrigin(0.5).setDepth(5002);
    const reason = this.add.text(W / 2, 650, error instanceof Error ? error.message : "알 수 없는 저장 오류", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#b9a29c", align: "center", wordWrap: { width: 470 },
    }).setOrigin(0.5).setDepth(5002);
    const retrySave = async (): Promise<void> => {
      if (retrying) return;
      retrying = true;
      try {
        await getServices().save.saveNow();
        this.growthBusy = false;
        setUiEscapeHandler(this, undefined);
        shade.destroy();
        this.render();
        this.showGrowthModal(heroId);
        addToast(this, `${message} · 저장 완료`, COLORS.cyan);
      } catch (retryError) {
        reason.setText(retryError instanceof Error ? retryError.message : "저장을 다시 완료하지 못했습니다");
        retrying = false;
      }
    };
    addButton(this, W / 2, 740, "저장 다시 시도", {
      width: 360, height: 70, icon: "↻", accent: COLORS.gold,
      focusKey: "party-growth-save-retry-button",
      onClick: () => void retrySave(),
    }).setDepth(5003);
    setUiEscapeHandler(this, () => void retrySave());
    ensureUiFocus(this, ["party-growth-save-retry-button"]);
  }

  private modalHeading(): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(17)}px`, color: "#f0d68d" };
  }

  private metaFailureLabel(code: string, fallback: string): string {
    const labels: Readonly<Record<string, string>> = {
      level_cap: "현재 한계입니다. 먼저 각성하세요",
      max_ascension: "최대 각성입니다",
      ascension_level_required: "현재 레벨 상한에 도달해야 합니다",
      insufficient_gold: "골드가 부족합니다",
      insufficient_shards: "영웅 조각이 부족합니다",
      insufficient_awakening_materials: "각성석이 부족합니다",
      max_relic_level: "최대 정련입니다",
      insufficient_relic_dust: "유물 가루가 부족합니다",
      insufficient_materials: "항해 재료가 부족합니다",
      relic_loadout_full: "유물은 세 개까지만 장착할 수 있습니다",
    };
    return labels[code] ?? fallback;
  }

  private applyRecommendation(): void {
    const stage = this.stageId ? STAGE_BY_ID[this.stageId] : undefined;
    if (!stage) {
      addToast(this, "스테이지를 선택한 뒤 자동 추천을 사용할 수 있습니다", COLORS.red);
      return;
    }
    const save = getServices().save.getSnapshot();
    const rules = this.endgameMode ? getEndgamePartyRules(save, this.endgameMode) : undefined;
    const recommendedPower = this.endgameMode
      ? getEndgameBattlePreview(save, this.endgameMode, stage).recommendedPower
      : stage.recommendedPower;
    const recommendation = recommendParty(save, stage, this.recommendationSize, {
      lockedHeroIds: rules?.lockedHeroIds ?? [],
      forbiddenClasses: rules?.forbiddenClasses ?? [],
    }, recommendedPower);
    this.recommendation = recommendation;
    this.selected = [...recommendation.heroIds];
    this.focusedHeroId = recommendation.heroIds[0] ?? this.focusedHeroId;
    this.vaultWarningAccepted = false;
    this.requestRender();
  }

  private cleanupPresetSlots(): void {
    const services = getServices();
    const original = services.save.getSnapshot();
    const rules = this.endgameMode ? getEndgamePartyRules(original, this.endgameMode) : undefined;
    const restrictions = {
      lockedHeroIds: rules?.lockedHeroIds ?? [],
      forbiddenClasses: rules?.forbiddenClasses ?? [],
    };
    let next = original;
    let changed = false;
    for (let slot = 0; slot < 3; slot += 1) {
      const raw = next.roster.partyPresets[slot] ?? [];
      const cleaned = readPartyPreset(next, slot, restrictions);
      if (sameIds(raw, cleaned)) continue;
      next = writePartyPreset(next, slot, cleaned, restrictions);
      changed = true;
    }
    if (changed) void services.save.replace(next).catch(() => {
      if (this.scene.isActive()) addToast(this, "오래된 편성 프리셋 정리를 저장하지 못했습니다", COLORS.red);
    });
  }

  private async savePreset(slot: number): Promise<void> {
    if (this.presetBusy || !this.selected.length) return;
    this.presetBusy = true;
    try {
      const services = getServices();
      const save = services.save.getSnapshot();
      const rules = this.endgameMode ? getEndgamePartyRules(save, this.endgameMode) : undefined;
      await services.save.replace(writePartyPreset(save, slot, this.selected, {
        lockedHeroIds: rules?.lockedHeroIds ?? [],
        forbiddenClasses: rules?.forbiddenClasses ?? [],
      }));
      this.requestRender();
      this.toastAfterRender(`프리셋 ${slot + 1}에 현재 편성을 저장했습니다`, COLORS.cyan);
    } catch {
      addToast(this, "편성 프리셋을 저장하지 못했습니다", COLORS.red);
    } finally {
      this.presetBusy = false;
    }
  }

  private async loadPreset(slot: number): Promise<void> {
    if (this.presetBusy) return;
    this.presetBusy = true;
    try {
      const services = getServices();
      const save = services.save.getSnapshot();
      const rules = this.endgameMode ? getEndgamePartyRules(save, this.endgameMode) : undefined;
      const restrictions = {
        lockedHeroIds: rules?.lockedHeroIds ?? [],
        forbiddenClasses: rules?.forbiddenClasses ?? [],
      };
      const preset = readPartyPreset(save, slot, restrictions);
      if (!preset.length) {
        addToast(this, "불러올 수 있는 선원이 없습니다", COLORS.red);
        return;
      }
      await services.save.replace(writePartyPreset(save, slot, preset, restrictions));
      this.selected = [...preset];
      this.focusedHeroId = preset[0];
      this.recommendation = undefined;
      this.vaultWarningAccepted = false;
      this.requestRender();
      this.toastAfterRender(`프리셋 ${slot + 1}을 불러왔습니다`, COLORS.cyan);
    } catch {
      addToast(this, "편성 프리셋을 불러오지 못했습니다", COLORS.red);
    } finally {
      this.presetBusy = false;
    }
  }

  private async deletePreset(slot: number): Promise<void> {
    if (this.presetBusy) return;
    this.presetBusy = true;
    try {
      const services = getServices();
      await services.save.replace(clearPartyPreset(services.save.getSnapshot(), slot));
      this.requestRender();
      this.toastAfterRender(`프리셋 ${slot + 1}을 비웠습니다`, 0x78918e);
    } catch {
      addToast(this, "편성 프리셋을 삭제하지 못했습니다", COLORS.red);
    } finally {
      this.presetBusy = false;
    }
  }

  private toastAfterRender(message: string, color: number): void {
    this.time.delayedCall(40, () => {
      if (this.scene.isActive()) addToast(this, message, color);
    });
  }

  private requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.input.enabled = false;
    this.time.delayedCall(16, () => {
      if (!this.scene.isActive()) {
        this.renderQueued = false;
        this.input.enabled = true;
        return;
      }
      this.renderQueued = false;
      this.render();
      this.input.enabled = true;
    });
  }

  private objectiveName(type: (typeof STAGE_BY_ID)[string]["objective"]["type"]): string {
    return {
      "defeat-all": "적 전멸", "break-parts": "부위 파괴", assemble: "조립",
      survive: "생존", protect: "보호", seal: "봉인", escape: "탈출",
    }[type];
  }

  private toggleHero(heroId: string): void {
    if (this.selected.includes(heroId)) {
      this.selected = this.selected.filter((id) => id !== heroId);
    } else if (this.selected.length < CAMPAIGN_PARTY_MAX_SIZE) {
      this.selected.push(heroId);
    } else {
      this.selected[2] = heroId;
    }
    this.focusedHeroId = heroId;
    this.recommendation = undefined;
    this.vaultWarningAccepted = false;
    this.requestRender();
  }

  private async confirmParty(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    const services = getServices();
    const originalSave = services.save.getSnapshot();
    if (!this.vaultWarningAccepted && this.stageId && this.requiresVaultWarning(originalSave, this.stageId)) {
      this.saving = false;
      this.showVaultWarning();
      return;
    }
    let save = originalSave;
    if (this.stageId) {
      const pendingRescue = readRestorableBattleRescue(originalSave);
      if (pendingRescue) {
        addToast(this, "결제한 구조 전투를 먼저 이어갑니다", COLORS.gold);
        this.saving = false;
        fadeTo(this, "Battle", {
          stageId: pendingRescue.rescue.stageId,
          endgameMode: battleRescueEndgameMode(pendingRescue.rescue.mode),
          resumeRescue: true,
        });
        return;
      }
      if (originalSave.recovery.pendingBattleRescue) {
        addToast(this, "구조 기록 검증이 필요해 새 전투를 시작하지 않았습니다", COLORS.red);
        this.saving = false;
        return;
      }
      const requestedMode = battleRewardMode(this.endgameMode);
      const pendingTickets = readPendingBattleRewardTickets(originalSave);
      const differentTicket = pendingTickets.find(
        (ticket) => ticket.stageId !== this.stageId || ticket.mode !== requestedMode,
      );
      const activeCheckpoint = originalSave.recovery.activeCampaignBattle;
      if (differentTicket || activeCheckpoint) {
        const currentStageId = activeCheckpoint?.stageId ?? differentTicket?.stageId ?? "진행 중 전투";
        const approved = await services.host.ui.confirm({
          title: "진행 중인 전투 포기",
          message: `${currentStageId} 전투 기록이 남아 있습니다. 이 기록과 미정산 전투표를 포기하고 새 전투를 시작할까요?`,
        });
        if (!approved) {
          addToast(this, "기존 전투를 그대로 보존했습니다", COLORS.cyan);
          this.saving = false;
          return;
        }
        try {
          save = abandonPendingBattleRun(save);
        } catch (error) {
          addToast(this, error instanceof Error ? error.message : "기존 전투를 포기하지 못했습니다", COLORS.red);
          this.saving = false;
          return;
        }
      }
    }
    if (this.endgameMode === "scyllaRaid") {
      const raid = saveScyllaRaidSquads(save, this.raidSquads);
      if (!raid.ok) {
        addToast(this, raid.message, COLORS.red);
        this.saving = false;
        return;
      }
      save = raid.save;
    } else {
      const rules = this.endgameMode ? getEndgamePartyRules(save, this.endgameMode) : undefined;
      const invalid = this.selected.some((heroId) => rules?.lockedHeroIds.includes(heroId)
        || rules?.forbiddenClasses.includes(HERO_BY_ID[heroId]!.ricochetClass));
      const result = invalid ? undefined : setCampaignParty(save, this.selected);
      if (!result?.ok) {
        addToast(this, this.endgameMode === "stormRoute"
          ? "폭풍 항로에는 쓰러지지 않은 영웅 세 명이 필요합니다"
          : "현재 도전 규칙에 맞는 영웅을 1~3명 편성하세요", COLORS.red);
        this.saving = false;
        return;
      }
      save = result.save;
    }
    if (this.endgameMode === "stormRoute") {
      save = prepareWeeklyStormState(save).save;
      const stormParty = setStormRouteParty(save, this.selected);
      if (!stormParty.ok) {
        addToast(this, stormParty.message, COLORS.red);
        this.saving = false;
        return;
      }
      save = stormParty.save;
    }
    if (this.stageId && this.endgameMode) {
      const entry = consumeEndgameEntryCost(save, this.endgameMode);
      if (!entry.ok) {
        addToast(this, entry.message, COLORS.red);
        this.saving = false;
        return;
      }
      save = entry.save;
    }
    if (this.stageId) {
      const ticket = beginBattleRewardTicket(save, this.stageId, battleRewardMode(this.endgameMode));
      if (!ticket.ok) {
        addToast(this, "전투 정산표를 준비하지 못했습니다", COLORS.red);
        this.saving = false;
        return;
      }
      save = ticket.save;
    }
    try {
      await services.save.replace(save);
      if (this.stageId) fadeTo(this, "Battle", { stageId: this.stageId, endgameMode: this.endgameMode });
      else fadeTo(this, "Harbor");
    } catch (error) {
      // GameSaveStore.replace installs `save` in memory before persistence. Retrying
      // that exact snapshot prevents a second click from consuming another entry.
      try {
        await services.save.saveNow();
        if (this.stageId) fadeTo(this, "Battle", { stageId: this.stageId, endgameMode: this.endgameMode });
        else fadeTo(this, "Harbor");
      } catch {
        addToast(this, `${error instanceof Error ? error.message : "저장 실패"} · 같은 출항 상태로 다시 저장하세요`, COLORS.red);
        this.saving = false;
      }
    }
  }

  private elementColor(element: HeroDefinition["element"]): number {
    return { sea: 0x5bb7c4, sun: 0xe0a84f, moon: 0x9e84c9, storm: 0x75a6d8, earth: 0xa87952, spirit: 0x78bd9d }[element];
  }

  private className(heroClass: HeroDefinition["ricochetClass"]): string {
    return { bounce: "반사형", pierce: "관통형", heavy: "중량형", burst: "폭발형", support: "지원형" }[heroClass];
  }

  private friendshipEffectText(hero: HeroDefinition): string {
    const effects = hero.friendshipSkill.effects.map((effect) => {
      const label: Readonly<Record<string, string>> = {
        "nearest-barrage": "가장 가까운 적에게 화살비",
        "line-pierce": "조준선 방향 관통 공격",
        "projectile-guard": "모든 아군에게 투사체 방어",
        heal: "아군 체력 회복",
        regeneration: "접촉한 아군 지속 회복",
        "chain-bounce": "적 사이 연쇄 반사",
        "push-wave": "전방 밀쳐내기 파동",
        "cross-slash": "접촉점 교차 베기",
        "temporary-wall": "접촉점에 임시 벽 생성",
        "mark-weakpoint": "가까운 적 약점 표식",
        "wind-vector": "접촉한 아군에게 순풍",
        "shrink-enemy": "가까운 적 축소",
        "telegraph-extend": "적 공격 예고 연장",
        "wall-phase": "접촉한 아군 벽 통과",
        "orbiting-blade": "접촉한 아군 태양륜",
        "follow-up-shot": "마지막 피격 적 추격타",
        bind: "가까운 적 속박",
      };
      return `${label[effect.kind] ?? effect.kind}${effect.value ? ` ${effect.value}` : ""}`;
    });
    return `아군끼리 접촉하면 발동 · ${effects.join(" · ")}`;
  }

  private activeEffectText(hero: HeroDefinition): string {
    const labels: Readonly<Record<string, string>> = {
      "preview-extend": "예상선 연장", "weakpoint-multiplier": "약점 피해 증가", "ally-launch": "강한 동료 추가 발사",
      "shield-break": "방패 파괴", stun: "보스 부위 기절", "reveal-weakpoint": "약점 노출", heal: "아군 회복",
      "countdown-delay": "적 공격 지연", cleanse: "약화 해제", "speed-up": "아군 속도 증가", "temporary-bumper": "임시 범퍼 설치",
      "velocity-multiplier": "발사 속도 증가", "damage-redirect": "피해 대신 받기", "afterimage-strikes": "잔상 연타",
      "mirror-clone": "궤적 분신", "radial-launch": "전방위 공격", revive: "쓰러진 동료 부활", "arena-beam": "표식 적 광선",
      "portal-pair": "차원문 한 쌍 설치", "trajectory-perfect": "완전 예상 궤적",
    };
    return hero.activeSkill.effects
      .map((effect) => `${labels[effect.kind] ?? effect.kind}${effect.value ? ` ${effect.value}` : ""}`)
      .join(" · ");
  }

  private materialPlanText(plan: ReturnType<typeof planRelicMaterialConsumption>): string {
    const consumed = Object.entries(plan.consumedMaterials)
      .map(([id, amount]) => `${resourceDisplayName(id)} ${amount}`)
      .join(" · ");
    if (!plan.sufficient) return `${consumed || "없음"}  (잠금 제외 ${plan.availableUnits}/${plan.requestedUnits})`;
    return consumed || "재료 차감 없음";
  }

  private endgameRewardPreviewText(plan: ReturnType<typeof getEndgameRewardPlan>): string {
    const bonuses = plan.bonuses.map((bonus) => {
      const name = bonus.kind === "relic"
        ? RELIC_BY_ID[bonus.id]?.name ?? bonus.id
        : bonus.kind === "fragment" || bonus.kind === "hero"
          ? HERO_BY_ID[bonus.id]?.name ?? bonus.id
          : bonus.kind === "title"
            ? `칭호 ${titleDisplayName(`title:${bonus.id}`) ?? bonus.id}`
          : resourceDisplayName(bonus.id);
      return `${name}${bonus.amount > 1 ? ` ×${bonus.amount}` : ""}`;
    });
    return `${plan.label} · 골드 ×${plan.goldMultiplier.toFixed(2)} · XP ×${plan.heroXpMultiplier.toFixed(2)}${bonuses.length ? ` · ${bonuses.join(" · ")}` : ""}`;
  }

  private requiresVaultWarning(
    save: ReturnType<ReturnType<typeof getServices>["save"]["getSnapshot"]>,
    stageId: string,
  ): boolean {
    if (save.inventory.relicIds.length < save.resources.vaultSlots) return false;
    if (this.endgameMode) {
      return getEndgameRewardPlan(save, this.endgameMode, stageId).bonuses.some(
        (bonus) => bonus.kind === "relic" && !save.inventory.relicIds.includes(bonus.id),
      );
    }
    const preview = getStageRewardPreview(save, stageId);
    return Boolean(preview
      && !preview.firstClear.claimed
      && preview.firstClear.kind === "relic"
      && !save.inventory.relicIds.includes(preview.firstClear.id));
  }

  private showVaultWarning(): void {
    setUiFocusScope(this, "party-vault-warning", "party-vault-confirm");
    const closeWarning = (): void => {
      setUiEscapeHandler(this, undefined);
      setUiFocusScope(this, "base", "party-confirm");
      this.render();
      ensureUiFocus(this, ["party-confirm"]);
    };
    this.add.rectangle(W / 2, 640, 720, 1280, 0x010507, 0.88).setDepth(4000).setInteractive();
    addPanel(this, 64, 390, 592, 480, COLORS.red, 0.998).setDepth(4001);
    this.add.text(W / 2, 452, "보물고가 가득 찼습니다", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(28)}px`, color: "#ffd0c3",
    }).setOrigin(0.5).setDepth(4002);
    this.add.text(W / 2, 555, "이번 전투의 신규 유물은 첫 클리어 정산과 동시에\n등급에 맞는 유물 가루로 전환됩니다.\n출항 전에 보물고를 확장하거나, 전환을 확인하세요.", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(16)}px`, lineSpacing: 9, color: "#d8e3dd", align: "center",
      wordWrap: { width: 500 },
    }).setOrigin(0.5).setDepth(4002);
    addButton(this, W / 2, 690, "유물 가루 전환 확인 · 출항", {
      width: 430, height: 72, accent: COLORS.red, primary: true, focusKey: "party-vault-confirm",
      onClick: () => {
        this.vaultWarningAccepted = true;
        setUiEscapeHandler(this, undefined);
        setUiFocusScope(this, "base", "party-confirm");
        this.render();
        void this.confirmParty();
      },
    }).setDepth(4003);
    addButton(this, W / 2, 785, "보물고 확장 확인", {
      width: 360, height: 62, subtitle: "끝없는 해역의 보물고 +20 상품으로 이동",
      focusKey: "party-vault-expand",
      onClick: () => fadeTo(this, "Endgame"),
    }).setDepth(4003);
    addButton(this, W / 2, 852, "출항 취소", {
      width: 220, height: 46, fontSize: 14, accent: 0x66888e,
      focusKey: "party-vault-cancel",
      onClick: closeWarning,
    }).setDepth(4003);
    setUiEscapeHandler(this, closeWarning);
    ensureUiFocus(this, ["party-vault-confirm", "party-vault-expand", "party-vault-cancel"]);
  }

  private statTextStyle(color: string): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color };
  }

}

function awaitlessOraclePower(floorIndex: number): number | undefined {
  return ENDGAME.oracleTower.floors[Math.min(29, Math.max(0, floorIndex))]?.recommendedPower;
}

function isMetaFailure(value: unknown): value is MetaFailure {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok?: unknown }).ok === false);
}

function nextValue<T>(values: readonly T[], current: T): T {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] ?? values[0]!;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
