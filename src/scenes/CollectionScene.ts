import Phaser from "phaser";
import { HEROES, HERO_BY_ID, RELICS, ROUTES } from "../data";
import {
  formatCollectionLastPlayed,
  getHeroCollection,
  getRelicCollection,
  getRouteCollection,
  getTitleCollection,
  getVoyageCollectionSummary,
  selectTitle,
  type HeroCollectionEntry,
  type RelicCollectionEntry,
  type RouteCollectionEntry,
  type TitleCollectionEntry,
} from "../core/meta";
import { getServices } from "../core/services";
import { HERO_FALLBACK_TEXTURE_KEY, resolveHeroTexture, resolveRouteMapTexture } from "../assets/runtimeAssetCatalog";
import { partyImageAssets, queueImageAssets, routeSelectionImageAssets } from "../assets/assetStreaming";
import {
  addAtmosphere,
  addButton,
  addPanel,
  addToast,
  addTopBar,
  COLORS,
  ensureUiFocus,
  fadeInScene,
  fadeTo,
  H,
  uiTextSize,
  W,
} from "../ui/gameUi";
import { playBgm } from "../audio/AudioDirector";
import {
  clampCollectionPage,
  collectionPageCount,
  collectionPageSlice,
  COLLECTION_LAYOUT,
  COLLECTION_SCENE_KEY,
  COLLECTION_TABS,
  starText,
  type CollectionTab,
} from "./collectionPresentation";

interface CollectionSceneData { tab?: CollectionTab; page?: number }

export class CollectionScene extends Phaser.Scene {
  private tab: CollectionTab = "heroes";
  private page = 0;
  private titleBusy = false;
  private renderQueued = false;

  constructor() { super(COLLECTION_SCENE_KEY); }

  preload(): void {
    queueImageAssets(this, [
      ...partyImageAssets(HEROES.map((hero) => hero.id)),
      ...routeSelectionImageAssets(),
    ], "항해 도감을 정리하는 중");
  }

  init(data: CollectionSceneData): void {
    this.tab = data.tab && COLLECTION_TABS.some((tab) => tab.id === data.tab) ? data.tab : "heroes";
    this.page = Math.max(0, Math.floor(data.page ?? 0));
    this.titleBusy = false;
    this.renderQueued = false;
  }

  create(): void {
    playBgm(this, "bgm-harbor-homeward");
    this.render();
    fadeInScene(this, 180);
  }

  private render(): void {
    this.children.removeAll(true);
    const save = getServices().save.getSnapshot();
    const heroes = getHeroCollection(save);
    const relics = getRelicCollection(save);
    const routes = getRouteCollection(save);
    const titles = getTitleCollection(save);
    const itemCount = this.tab === "heroes"
      ? heroes.length
      : this.tab === "relics"
        ? relics.length
        : this.tab === "voyage"
          ? routes.length + 1
          : titles.length;
    const pages = collectionPageCount(this.tab, itemCount);
    this.page = clampCollectionPage(this.page, pages);

    this.drawBackdrop(routes);
    addAtmosphere(this, this.tab === "titles" ? 0xe0bd70 : 0x8bdad4, 18);
    addTopBar(this, "항해 도감", () => fadeTo(this, "Harbor"));
    this.drawTabs(save, heroes.length, relics.length, routes.length, titles.length);

    if (this.tab === "heroes") this.drawHeroes(collectionPageSlice("heroes", heroes, this.page));
    else if (this.tab === "relics") this.drawRelics(collectionPageSlice("relics", relics, this.page));
    else if (this.tab === "voyage") this.drawVoyage(routes);
    else this.drawTitles(collectionPageSlice("titles", titles, this.page));

    this.drawPagination(pages);
    const focusFallback = this.page <= 0
      ? this.page + 1 < pages ? "collection-page-next" : `collection-tab-${this.tab}`
      : this.page + 1 >= pages
        ? "collection-page-previous"
        : `collection-tab-${this.tab}`;
    ensureUiFocus(this, [focusFallback, `collection-tab-${this.tab}`]);
    this.add.text(W / 2, COLLECTION_LAYOUT.footerY, "방향키·Tab 항목 이동  ·  Enter 선택  ·  Esc 항구", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#658682",
    }).setOrigin(0.5);
  }

  private drawBackdrop(routes: readonly RouteCollectionEntry[]): void {
    const route = this.tab === "voyage" && this.page > 0 ? routes[this.page - 1] : undefined;
    const texture = route?.unlocked ? resolveRouteMapTexture(this.textures, route.id) : "harbor-hub";
    this.add.image(W / 2, H / 2, texture).setDisplaySize(W, H).setTint(0x476f70).setAlpha(route?.unlocked ? 0.48 : 0.38);
    this.add.rectangle(W / 2, H / 2, W, H, 0x020a0f, route?.unlocked ? 0.68 : 0.73);
  }

  private drawTabs(
    save: ReturnType<ReturnType<typeof getServices>["save"]["getSnapshot"]>,
    heroCount: number,
    relicCount: number,
    routeCount: number,
    titleCount: number,
  ): void {
    const ownedByTab: Readonly<Record<CollectionTab, string>> = {
      heroes: `${save.roster.ownedHeroIds.filter((id) => Boolean(HERO_BY_ID[id])).length}/${heroCount}`,
      relics: `${save.inventory.relicIds.filter((id) => RELICS.some((relic) => relic.id === id)).length}/${relicCount}`,
      voyage: `${save.progress.completedStageIds.length}/43`,
      titles: `${save.inventory.skinIds.filter((id) => id.startsWith("title:")).length}/${titleCount}`,
    };
    COLLECTION_TABS.forEach((tab, index) => {
      addButton(this, 90 + index * 180, 157, tab.label, {
        width: 154,
        height: 58,
        icon: tab.icon,
        fontSize: 16,
        primary: this.tab === tab.id,
        focusKey: `collection-tab-${tab.id}`,
        accent: this.tab === tab.id ? COLORS.gold : 0x54767c,
        onClick: () => {
          if (this.tab === tab.id) return;
          this.tab = tab.id;
          this.page = 0;
          this.requestRender();
        },
      });
    });
    const progressLabel = this.tab === "voyage" ? "진행" : "수집";
    this.add.text(W / 2, COLLECTION_LAYOUT.summaryY, `${this.tabTitle()} · ${progressLabel} ${ownedByTab[this.tab]}${this.tab === "voyage" ? ` · 항로 ${routeCount}개` : ""}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color: "#9fc9c3",
    }).setOrigin(0.5);
  }

  private drawHeroes(entries: readonly HeroCollectionEntry[]): void {
    entries.forEach((entry, index) => {
      const y = 252 + index * 199;
      addPanel(this, 40, y, 640, 184, entry.owned ? this.elementColor(entry.element) : 0x405056, 0.97);
      this.add.circle(108, y + 92, 58, entry.owned ? 0x173942 : 0x111a1e, 0.96)
        .setStrokeStyle(3, entry.owned ? this.elementColor(entry.element) : 0x49565a, 0.84);
      const hero = HERO_BY_ID[entry.id];
      const texture = hero ? resolveHeroTexture(this.textures, hero) : HERO_FALLBACK_TEXTURE_KEY;
      const portrait = this.add.image(108, y + 91, texture).setDisplaySize(108, 108);
      if (!entry.owned) portrait.setTint(0x030506).setAlpha(0.42);

      if (!entry.owned) {
        this.add.text(108, y + 91, "?", {
          fontFamily: "Georgia, serif", fontStyle: "bold", fontSize: `${uiTextSize(42)}px`, color: "#7a8889",
        }).setOrigin(0.5);
        this.add.text(184, y + 44, entry.name, this.headingStyle("#8c9999", 19));
        this.add.text(184, y + 84, "아직 만나지 못한 고양이입니다.", this.bodyStyle("#798889", 13));
        this.add.text(184, y + 116, "스토리 항해나 별의 신탁에서 인연을 맺으면 정보가 공개됩니다.", {
          ...this.bodyStyle("#627577", 11), wordWrap: { width: 455 },
        }).setMaxLines(2);
        return;
      }

      this.add.text(184, y + 19, `${entry.name}  ${"★".repeat(entry.rarity ?? 0)}`, this.headingStyle("#f3dfaa", 18));
      this.add.text(650, y + 22, `Lv.${entry.level} · 각성 ${entry.awakening}`, {
        ...this.headingStyle("#8fd8cf", 13), align: "right",
      }).setOrigin(1, 0);
      this.add.text(184, y + 50, `${entry.epithet}  ·  ${entry.element}  ·  ${entry.role}`, this.bodyStyle("#9fc0bd", 12));
      this.add.text(184, y + 81, `우정  ${entry.friendshipName}`, this.headingStyle("#8fe1d8", 12));
      this.add.text(184, y + 105, entry.friendshipEffect ?? "-", {
        ...this.bodyStyle("#b7cdca", 11), wordWrap: { width: 466 },
      }).setMaxLines(2);
      this.add.text(184, y + 139, `액티브  ${entry.activeName} · 충전 ${entry.activeChargeTurns}턴`, this.headingStyle("#e4c777", 12));
      this.add.text(184, y + 163, entry.activeEffect ?? "-", {
        ...this.bodyStyle("#c9c1a3", 10), wordWrap: { width: 466 },
      }).setMaxLines(1);
    });
  }

  private drawRelics(entries: readonly RelicCollectionEntry[]): void {
    entries.forEach((entry, index) => {
      const y = 252 + index * 158;
      const accent = entry.owned ? this.relicTierColor(entry.tier) : 0x465358;
      addPanel(this, 40, y, 640, 144, accent, 0.97);
      const seal = this.add.graphics();
      seal.fillStyle(entry.owned ? accent : 0x253136, 0.32).lineStyle(3, accent, 0.88).fillCircle(102, y + 72, 43).strokeCircle(102, y + 72, 43);
      seal.lineStyle(2, accent, 0.72).strokeCircle(102, y + 72, 31);
      seal.fillStyle(accent, entry.owned ? 0.9 : 0.35).fillTriangle(102, y + 43, 128, y + 72, 102, y + 101).fillTriangle(102, y + 43, 76, y + 72, 102, y + 101);

      if (!entry.owned) {
        this.add.text(160, y + 35, entry.name, this.headingStyle("#8d999a", 18));
        this.add.text(160, y + 72, "획득 전에는 이름과 효과가 기록되지 않습니다.", this.bodyStyle("#768789", 12));
        this.add.text(160, y + 100, "첫 클리어 · 신탁탑 · 토벌 보상에서 발견 가능", this.bodyStyle("#5f7476", 11));
        return;
      }

      this.add.text(160, y + 18, `${entry.name}  +${entry.level}`, this.headingStyle("#f3dfaa", 18));
      this.add.text(650, y + 20, entry.equipped ? "● 장착 중" : "보관 중", {
        ...this.headingStyle(entry.equipped ? "#7fe1d5" : "#829593", 12), align: "right",
      }).setOrigin(1, 0);
      this.add.text(160, y + 50, `T${entry.tier} · ${entry.setName} 세트 · 도감 ${String(entry.index).padStart(2, "0")}/32`, this.bodyStyle("#9fc0bd", 12));
      this.add.text(160, y + 79, entry.effectSummary ?? "효과 정보 없음", {
        ...this.bodyStyle("#d8c88f", 11), wordWrap: { width: 486 }, lineSpacing: 2,
      }).setMaxLines(3);
    });
  }

  private drawVoyage(routes: readonly RouteCollectionEntry[]): void {
    if (this.page === 0) {
      this.drawVoyageSummary();
      return;
    }
    const route = routes[this.page - 1];
    if (!route) return;
    if (!route.unlocked) {
      addPanel(this, 64, 330, 592, 510, 0x49575d, 0.97);
      this.add.text(W / 2, 450, "◇", { fontFamily: "Georgia, serif", fontSize: `${uiTextSize(92)}px`, color: "#5f6d70" }).setOrigin(0.5);
      this.add.text(W / 2, 565, route.name, this.headingStyle("#899596", 28)).setOrigin(0.5);
      this.add.text(W / 2, 630, "이전 항로를 돌파하면 해역 이름과 기믹이 공개됩니다.", {
        ...this.bodyStyle("#738385", 14), align: "center", wordWrap: { width: 460 },
      }).setOrigin(0.5);
      this.add.text(W / 2, 718, `${route.totalStages}개 해역 · 진행 ${route.completedStages}/${route.totalStages}`, this.bodyStyle("#657577", 13)).setOrigin(0.5);
      return;
    }

    addPanel(this, 42, 252, 636, 150, COLORS.gold, 0.97);
    this.add.text(70, 273, `항로 ${String(route.order).padStart(2, "0")} · ${route.name}`, this.headingStyle("#f4dfac", 22));
    this.add.text(70, 310, `${route.biome} · ${route.signatureMechanic}`, {
      ...this.bodyStyle("#9fc2bd", 12), wordWrap: { width: 565 },
    }).setMaxLines(2);
    this.add.text(70, 365, `진행 ${route.completedStages}/${route.totalStages} (${route.completionPercent}%) · 별 ${route.stars}/${route.maxStars}${route.bossDefeated ? ` · 보스 격파 ${route.bossName}` : ""}`, this.headingStyle("#e2c36e", 12));

    route.stages.forEach((stage, index) => {
      const y = 420 + index * 119;
      addPanel(this, 52, y, 616, 105, stage.completed ? 0x5a9b91 : 0x4d666b, 0.94);
      this.add.text(78, y + 20, `${String(stage.order).padStart(2, "0")}  ${stage.name}`, this.headingStyle(stage.completed ? "#eef0d5" : "#a9b7b5", 15));
      this.add.text(640, y + 20, stage.completed ? starText(stage.stars) : "☆☆☆", {
        ...this.headingStyle(stage.completed ? "#f0ce68" : "#66787a", 16), align: "right",
      }).setOrigin(1, 0);
      this.add.text(78, y + 56, `${stage.objective}${stage.boss ? " · 보스 해역" : ""}`, this.bodyStyle("#91aaa7", 12));
      this.add.text(640, y + 57, stage.completed ? "클리어" : "미클리어", {
        ...this.headingStyle(stage.completed ? "#7dd5ca" : "#718284", 11), align: "right",
      }).setOrigin(1, 0);
    });
  }

  private drawVoyageSummary(): void {
    const summary = getVoyageCollectionSummary(getServices().save.getSnapshot());
    addPanel(this, 52, 252, 616, 184, COLORS.gold, 0.97);
    this.add.text(78, 276, "대항해 진행", this.headingStyle("#f3dfaa", 20));
    this.add.text(78, 316, `해역 ${summary.completedStages}/${summary.totalStages}  ·  별 ${summary.stars}/${summary.maxStars}  ·  항로 ${summary.unlockedRoutes}/${summary.totalRoutes}`, this.headingStyle("#9fd8cf", 14));
    this.add.text(78, 356, summary.campaignComplete ? "귀향 서사 완주" : "귀향 항해 진행 중", this.headingStyle(summary.campaignComplete ? "#e7c86e" : "#8fa8a5", 14));
    this.add.text(78, 390, `최근 항해 ${formatCollectionLastPlayed(summary.lastPlayedAt)}`, this.bodyStyle("#819a97", 12));

    addPanel(this, 52, 452, 616, 184, 0x6c8a86, 0.97);
    this.add.text(78, 476, "전투 기록", this.headingStyle("#d8e4dd", 20));
    this.add.text(78, 516, `승리 ${summary.wins.toLocaleString()}  ·  패배 ${summary.losses.toLocaleString()}  ·  최고 연쇄 ${summary.bestRicochetChain}`, this.headingStyle("#9fd8cf", 14));
    this.add.text(78, 553, `누적 피해 ${summary.totalDamage.toLocaleString()}`, this.headingStyle("#d7be78", 14));
    this.add.text(78, 588, `격파 보스 ${summary.defeatedBossNames.length}/${ROUTES.length}  ·  ${summary.defeatedBossNames.join(" · ") || "아직 기록 없음"}`, {
      ...this.bodyStyle("#9bb0ad", 11), wordWrap: { width: 555 },
    }).setMaxLines(2);

    addPanel(this, 52, 652, 616, 264, 0x7385aa, 0.97);
    this.add.text(78, 676, "끝없는 해역", this.headingStyle("#d9e1f5", 20));
    this.add.text(78, 720, `신탁탑  ${summary.oracleFloor}/30층`, this.headingStyle("#a9cadb", 15));
    this.add.text(78, 758, `폭풍 항로  주간 완주 ${summary.weeklyStormRuns}/6  ·  최고 점수 ${summary.weeklyStormScore.toLocaleString()}`, this.headingStyle("#9fc9d6", 14));
    this.add.text(78, 798, `스킬라 항해 인연  ${summary.scyllaAffinity}/${summary.scyllaAffinityMax}`, this.headingStyle("#e3bd72", 15));
    this.add.text(78, 838, summary.raidActive ? `스킬라 토벌 진행 중 · ${summary.raidPhase}페이즈` : "스킬라 토벌 대기 중", this.bodyStyle("#b5c6c4", 13));
    this.add.text(78, 876, "기록은 기존 캠페인·전투·엔드게임 저장값에서 안전하게 집계됩니다.", this.bodyStyle("#738a89", 11));
  }

  private drawTitles(entries: readonly TitleCollectionEntry[]): void {
    entries.forEach((entry, index) => {
      const y = 252 + index * 197;
      const accent = entry.selected ? COLORS.gold : entry.owned ? 0x6e9f9a : 0x48575b;
      addPanel(this, 44, y, 632, 181, accent, 0.97);
      this.add.text(72, y + 22, entry.owned ? entry.name : "잠긴 칭호", this.headingStyle(entry.owned ? "#f3dfaa" : "#8b9797", 19));
      this.add.text(72, y + 57, entry.owned ? entry.description : "조건을 달성하면 칭호의 이름과 이야기가 공개됩니다.", {
        ...this.bodyStyle(entry.owned ? "#b8cdca" : "#748587", 12), wordWrap: { width: 430 },
      }).setMaxLines(2);
      this.add.text(72, y + 112, `해금 조건 · ${entry.unlockCondition}`, {
        ...this.headingStyle(entry.owned ? "#d7bb70" : "#879596", 12), wordWrap: { width: 430 },
      }).setMaxLines(2);
      this.add.text(72, y + 150, entry.selected ? "현재 장착 중" : entry.owned ? "보유 중" : "미보유", this.bodyStyle(entry.selected ? "#7fe1d5" : "#7f9290", 11));
      addButton(this, 594, y + 92, entry.selected ? "해제" : entry.owned ? "장착" : "잠김", {
        width: 126,
        height: 62,
        fontSize: 14,
        enabled: entry.owned && !this.titleBusy,
        accent: entry.selected ? COLORS.red : COLORS.gold,
        focusKey: `collection-title-${entry.id}`,
        onClick: () => void this.toggleTitle(entry),
      });
    });
  }

  private drawPagination(pageCount: number): void {
    addButton(this, 122, COLLECTION_LAYOUT.paginationY, "‹", {
      width: 92, height: COLLECTION_LAYOUT.paginationHeight,
      enabled: this.page > 0,
      focusKey: "collection-page-previous",
      onClick: () => { this.page -= 1; this.requestRender(); },
    });
    this.add.text(W / 2, COLLECTION_LAYOUT.paginationY, `${this.page + 1} / ${pageCount}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(15)}px`, color: "#aac9c4",
    }).setOrigin(0.5);
    addButton(this, 598, COLLECTION_LAYOUT.paginationY, "›", {
      width: 92, height: COLLECTION_LAYOUT.paginationHeight,
      enabled: this.page + 1 < pageCount,
      focusKey: "collection-page-next",
      onClick: () => { this.page += 1; this.requestRender(); },
    });
  }

  private async toggleTitle(entry: TitleCollectionEntry): Promise<void> {
    if (this.titleBusy || !entry.owned) return;
    this.titleBusy = true;
    try {
      const services = getServices();
      await services.save.replace(selectTitle(services.save.getSnapshot(), entry.selected ? null : entry.id));
      this.titleBusy = false;
      this.render();
      addToast(this, entry.selected ? "칭호를 해제했습니다" : `${entry.name} 칭호를 장착했습니다`, COLORS.cyan);
    } catch {
      this.titleBusy = false;
      addToast(this, "칭호 설정을 저장하지 못했습니다", COLORS.red);
    }
  }

  /** Defers destructive redraw until the current pointer-up dispatch has ended. */
  private requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.input.enabled = false;
    this.time.delayedCall(16, () => {
      this.renderQueued = false;
      this.render();
      this.input.enabled = true;
    });
  }

  private tabTitle(): string {
    return ({ heroes: "영웅 도감", relics: "유물 도감", voyage: "항해 기록", titles: "칭호 목록" } as const)[this.tab];
  }

  private elementColor(element: string | undefined): number {
    return ({ 바다: 0x5bb7c4, 태양: 0xe0a84f, 달: 0x9e84c9, 폭풍: 0x75a6d8, 대지: 0xa87952, 영혼: 0x78bd9d } as Readonly<Record<string, number>>)[element ?? ""] ?? 0x5f8588;
  }

  private relicTierColor(tier: number | undefined): number {
    return tier === 3 ? 0xd8a94a : tier === 2 ? 0x9d79bd : 0x69a9a6;
  }

  private headingStyle(color: string, size: number): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(size)}px`, color };
  }

  private bodyStyle(color: string, size: number): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(size)}px`, color };
  }
}
