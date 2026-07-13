import Phaser from "phaser";
import { HERO_BY_ID, type HeroDefinition } from "../data";
import {
  createOraclePurchaseReward,
  decodeOraclePurchaseReward,
  DEFAULT_ORACLE_BANNER,
  getSummonPoolDisclosure,
  resolveOracleSummons,
  DUPLICATE_FATE_DUST,
  FATE_DUST_FEATURED_GUARANTEE_COST,
  type SummonPullResult,
} from "../core/meta";
import { getServices, reconcileWalletAfterPurchase } from "../core/services";
import type { JsonObject } from "../state";
import { HERO_FALLBACK_TEXTURE_KEY, resolveHeroTexture } from "../assets/runtimeAssetCatalog";
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
  setUiEscapeHandler,
  setUiFocusScope,
  uiTextSize,
  W,
} from "../ui/gameUi";
import { playBgm, playSfx } from "../audio/AudioDirector";
import { queueImageAssets, summonImageAssets } from "../assets/assetStreaming";
import {
  summonAutoRefreshDelay,
  summonCardMotionPlan,
  summonFlashMotionPlan,
} from "./motionPresentation";

export class SummonScene extends Phaser.Scene {
  private busy = false;
  private pendingSummon?: PendingOracleSummon;
  private restoreFocusKey?: string;

  constructor() { super("Summon"); }

  preload(): void {
    queueImageAssets(this, summonImageAssets(DEFAULT_ORACLE_BANNER.poolHeroIds), "별의 신탁을 준비하는 중");
  }

  create(): void {
    this.busy = false;
    setUiEscapeHandler(this, undefined);
    setUiFocusScope(this, "base");
    this.pendingSummon = this.restorePendingSummon();
    playBgm(this, "bgm-oracle-summon");
    this.add.image(W / 2, H / 2, "arena-cyclops").setDisplaySize(W, H).setTint(0x604b82).setAlpha(0.55);
    this.add.rectangle(W / 2, H / 2, W, H, 0x090715, 0.54);
    addAtmosphere(this, 0xd9b4ff, 42);
    addTopBar(this, "별의 신탁", () => fadeTo(this, "Harbor"));
    this.drawOracleGate();
    this.drawBanner();
    ensureUiFocus(this, [this.restoreFocusKey ?? "summon-single", "summon-single"]);
    this.restoreFocusKey = undefined;
    if (this.pendingSummon) {
      this.time.delayedCall(350, () => addToast(
        this,
        "확인 중인 소환이 있습니다. 소환 버튼을 누르면 같은 결과로 이어서 확인합니다.",
        COLORS.gold,
      ));
    }
    fadeInScene(this, 230);
  }

  private drawOracleGate(): void {
    const gate = this.add.graphics().setDepth(10);
    gate.fillStyle(0x1c1530, 0.88).lineStyle(10, 0x4a345f, 1).fillEllipse(W / 2, 405, 430, 440).strokeEllipse(W / 2, 405, 430, 440);
    gate.lineStyle(4, 0xd3a958, 0.9).strokeEllipse(W / 2, 405, 372, 382);
    gate.lineStyle(2, 0xe7d3ff, 0.5).strokeEllipse(W / 2, 405, 324, 332);
    for (let i = 0; i < 12; i += 1) {
      const angle = Phaser.Math.DegToRad(i * 30);
      gate.fillStyle(i % 3 === 0 ? 0xe7c86c : 0x9f79c6, 0.9).fillCircle(W / 2 + Math.cos(angle) * 190, 405 + Math.sin(angle) * 200, i % 3 === 0 ? 7 : 4);
    }
    const glow = this.add.image(W / 2, 405, "glow").setTint(0xb389e2).setBlendMode(Phaser.BlendModes.ADD).setScale(4.1).setAlpha(0.35).setDepth(8);
    if (!getServices().save.getSnapshot().settings.reducedMotion) {
      this.tweens.add({ targets: glow, angle: 360, scale: 4.8, alpha: 0.55, duration: 5200, yoyo: true, repeat: -1 });
    }
  }

  private drawBanner(): void {
    const save = getServices().save.getSnapshot();
    const featured = HERO_BY_ID[DEFAULT_ORACLE_BANNER.featuredHeroId]!;
    this.add.text(W / 2, 126, "귀향을 비추는 태양", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(31)}px`, color: "#f6df9a", stroke: "#1b1027", strokeThickness: 7 }).setOrigin(0.5).setDepth(30);
    this.add.text(W / 2, 168, `${DEFAULT_ORACLE_BANNER.permanent ? "상시 신탁" : "기간 신탁"} · ★5 픽업`, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, color: "#c2a6d5" }).setOrigin(0.5).setDepth(30);

    const featuredTexture = resolveHeroTexture(this.textures, featured);
    const hero = this.add.image(W / 2, 408, featuredTexture).setDisplaySize(285, 285).setDepth(24);
    if (featuredTexture === HERO_FALLBACK_TEXTURE_KEY) hero.setTint(this.heroTint(featured));
    if (!save.settings.reducedMotion) {
      this.tweens.add({ targets: hero, y: 390, angle: 4, duration: 1600, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    }
    this.add.text(W / 2, 552, featured.name, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(33)}px`, color: "#fff0bd", stroke: "#28152f", strokeThickness: 7 }).setOrigin(0.5).setDepth(30);
    this.add.text(W / 2, 594, featured.epithet, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(16)}px`, color: "#d1badd" }).setOrigin(0.5).setDepth(30);

    addPanel(this, 52, 650, 616, 128, 0x9166b7, 0.93);
    this.add.text(82, 678, `누적 신탁  ${save.summons.oraclePulls}`, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(17)}px`, color: "#dcc5ed" });
    this.add.text(82, 716, `★5 천장까지  ${Math.max(0, 45 - save.summons.pityCount)}회`, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(18)}px`, color: "#f3df9a" });
    this.add.text(636, 698, `★5 3%\n★4 20% · ★3 77%\n운명 가루 ${save.resources.fateDust}`, { fontFamily: "Georgia, Malgun Gothic, serif", fontSize: `${uiTextSize(13)}px`, lineSpacing: 4, color: "#b9d7d0", align: "right" }).setOrigin(1, 0.5);

    addButton(this, 190, 858, "신탁 1회", { width: 278, height: 88, icon: "◆", subtitle: "다이아 100", accent: 0x9e78c6, focusKey: "summon-single", onClick: () => void this.summon(1) });
    addButton(this, 530, 858, "신탁 10회", { width: 278, height: 88, icon: "◆", subtitle: "다이아 900 · 1회 보너스", accent: COLORS.gold, focusKey: "summon-ten", onClick: () => void this.summon(10) });
    this.add.text(W / 2, 934, "10회 신탁은 ★4 이상 영웅을 최소 1명 보장합니다", { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: "#8da7a5" }).setOrigin(0.5);
    this.add.text(W / 2, 984, "스토리 동료는 합류 전 조각만 획득 · 중복 영웅은 각성 조각으로 변환", { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, color: "#adc0ba", align: "center" }).setOrigin(0.5);
    addButton(this, 190, 1060, "확률 · 전체 목록", { width: 278, height: 62, icon: "☷", focusKey: "summon-disclosure", onClick: () => this.showDisclosure() });
    addButton(this, 530, 1060, "최근 소환 기록", { width: 278, height: 62, icon: "↺", focusKey: "summon-history", onClick: () => this.showHistory() });
    addButton(this, 190, 1150, save.summons.guaranteedFeatured ? "픽업 확정 활성" : "운명 재봉합", {
      width: 278, height: 62, icon: "✦",
      subtitle: save.summons.guaranteedFeatured ? "다음 ★5는 픽업 확정" : `운명 가루 ${FATE_DUST_FEATURED_GUARANTEE_COST}`,
      enabled: !save.summons.guaranteedFeatured,
      focusKey: "summon-fate-guarantee",
      onClick: () => void this.activateFateGuarantee(),
    });
    addButton(this, 530, 1150, "승선 명부 보기", { width: 278, height: 62, icon: "⚓", focusKey: "summon-party", onClick: () => fadeTo(this, "Party", { fromHarbor: true }) });
  }

  private async summon(count: 1 | 10): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const services = getServices();
    let pending = this.pendingSummon ?? this.restorePendingSummon();
    if (!pending) {
      const purchaseId = `oracle-${count}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      const resolved = resolveOracleSummons(services.save.getSnapshot(), { seed: purchaseId, count });
      if (!resolved.ok) {
        addToast(this, resolved.message, COLORS.red);
        this.busy = false;
        return;
      }
      pending = {
        actionId: count === 1 ? "oracle-summon-1" : "oracle-summon-10",
        purchaseId,
        reward: createOraclePurchaseReward(resolved),
        pulls: resolved.pulls,
      };
      this.pendingSummon = pending;
    }

    try {
      const purchase = await services.purchases.purchase({
        actionId: pending.actionId,
        purchaseId: pending.purchaseId,
        reward: pending.reward,
      });
      if (!purchase.ok) {
        if (purchase.status === "rejected") this.pendingSummon = undefined;
        addToast(
          this,
          purchase.status === "recoverable"
            ? `${purchase.message} 같은 소환을 다시 누르면 이어서 확인합니다.`
            : purchase.message,
          COLORS.red,
        );
        this.busy = false;
        return;
      }
      this.pendingSummon = undefined;
      reconcileWalletAfterPurchase(services, purchase);
      if (pending.pulls.length > 0) {
        this.reveal(pending.pulls, pending.actionId === "oracle-summon-10" ? "summon-ten" : "summon-single");
      } else {
        this.busy = false;
        addToast(this, "이전 소환 보상을 복구했습니다. 소환 기록에서 결과를 확인하세요.", COLORS.cyan);
        this.refreshAfter(summonAutoRefreshDelay(
          services.save.getSnapshot().settings.reducedMotion,
          1700,
        ));
      }
    } catch (error) {
      addToast(
        this,
        `${error instanceof Error ? error.message : "소환 확인에 실패했습니다."} 같은 소환을 다시 누르면 이어서 확인합니다.`,
        COLORS.red,
      );
      this.busy = false;
    }
  }

  private restorePendingSummon(): PendingOracleSummon | undefined {
    const pending = getServices().save.getSnapshot().pendingPurchases.find(
      (entry) => entry.actionId === "oracle-summon-1" || entry.actionId === "oracle-summon-10",
    );
    if (
      !pending
      || (pending.actionId !== "oracle-summon-1" && pending.actionId !== "oracle-summon-10")
    ) return undefined;
    const decoded = decodeOraclePurchaseReward(pending.reward);
    return {
      actionId: pending.actionId,
      purchaseId: pending.purchaseId,
      reward: pending.reward,
      pulls: decoded?.pulls ?? [],
    };
  }

  private reveal(pulls: readonly SummonPullResult[], openerFocusKey: string): void {
    const closeModal = () => this.closeModal(openerFocusKey);
    setUiFocusScope(this, "summon-result");
    setUiEscapeHandler(this, closeModal);
    const rare = pulls.some((pull) => pull.rarity === 5);
    const reducedMotion = getServices().save.getSnapshot().settings.reducedMotion;
    playSfx(this, rare ? "sfx-summon-rare" : "sfx-summon-reveal", rare ? 0.76 : 0.62, rare ? 1.04 : 0.96);
    this.add.rectangle(W / 2, H / 2, W, H, 0x03020a, 0.94).setDepth(900).setInteractive();
    const flashMotion = summonFlashMotionPlan(reducedMotion);
    const flash = this.add.image(W / 2, H / 2, "glow")
      .setTint(pulls.some((pull) => pull.rarity === 5) ? 0xffd95a : 0xb58be0)
      .setScale(flashMotion.initialScale)
      .setAlpha(flashMotion.initialAlpha)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(910);
    if (flashMotion.animate) {
      this.tweens.add({
        targets: flash,
        alpha: flashMotion.targetAlpha,
        scale: flashMotion.targetScale,
        duration: flashMotion.duration,
        yoyo: flashMotion.yoyo,
      });
    }
    this.add.text(W / 2, 116, pulls.some((pull) => pull.rarity === 5) ? "황금빛 운명이 응답했습니다" : "별의 신탁", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(30)}px`, color: "#f8e8b7", stroke: "#24152d", strokeThickness: 7 }).setOrigin(0.5).setDepth(930);
    const columns = pulls.length === 1 ? 1 : 2;
    pulls.forEach((pull, index) => {
      const x = pulls.length === 1 ? W / 2 : 210 + (index % columns) * 300;
      const y = pulls.length === 1 ? 525 : 245 + Math.floor(index / columns) * 155;
      this.drawPullCard(x, y, pull, index, reducedMotion);
    });
    const closeY = pulls.length === 1 ? 900 : 1100;
    addButton(this, W / 2, closeY, "신탁 결과 확인", {
      width: 360,
      height: 72,
      primary: true,
      focusKey: "summon-result-close",
      onClick: closeModal,
    }).setDepth(960);
    ensureUiFocus(this, ["summon-result-close"]);
  }

  private drawPullCard(
    x: number,
    y: number,
    pull: SummonPullResult,
    index: number,
    reducedMotion: boolean,
  ): void {
    const hero = HERO_BY_ID[pull.heroId]!;
    const color = pull.rarity === 5 ? 0xf0c75e : pull.rarity === 4 ? 0xa681d0 : 0x5e9d9b;
    const motion = summonCardMotionPlan(reducedMotion, index);
    const card = this.add.container(x, y).setDepth(940).setScale(motion.initialScale);
    const bg = this.add.graphics();
    const width = pull.index && index >= 0 && pull.rarity ? 250 : 250;
    bg.fillStyle(0x101820, 0.98).lineStyle(pull.rarity === 5 ? 5 : 3, color, 1).fillRoundedRect(-width / 2, -62, width, 124, 17).strokeRoundedRect(-width / 2, -62, width, 124, 17);
    const texture = resolveHeroTexture(this.textures, hero);
    const portrait = this.add.image(-72, -4, texture).setDisplaySize(94, 94);
    if (texture === HERO_FALLBACK_TEXTURE_KEY) portrait.setTint(this.heroTint(hero));
    const stars = "★".repeat(pull.rarity);
    const name = this.add.text(-8, -30, `${stars}\n${hero.name}`, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: pullsFont(hero), color: "#f7e7bb", lineSpacing: 5, wordWrap: { width: 145 } }).setOrigin(0, 0.5);
    const resultLabel = pull.storyLocked
      ? `운명 조각 +${pull.shardsGranted} · 스토리 합류 대기`
      : pull.duplicate
        ? `조각 +${pull.shardsGranted} · 가루 +${DUPLICATE_FATE_DUST[pull.rarity]}`
        : pull.featured
          ? "PICK UP · NEW"
          : "NEW";
    const tag = this.add.text(-8, 38, resultLabel, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold",
      fontSize: `${uiTextSize(pull.storyLocked ? 9 : 12)}px`,
      color: pull.duplicate || pull.storyLocked ? "#9ec5c0" : "#f3cc68",
      wordWrap: { width: 146 },
    }).setOrigin(0, 0.5);
    card.add([bg, portrait, name, tag]);
    if (motion.animate) {
      this.tweens.add({
        targets: card,
        scale: 1,
        duration: motion.duration,
        delay: motion.delay,
        ease: "Back.Out",
      });
    }
  }

  private showDisclosure(): void {
    setUiFocusScope(this, "summon-disclosure");
    setUiEscapeHandler(this, () => this.closeModal("summon-disclosure"));
    const disclosure = getSummonPoolDisclosure(getServices().save.getSnapshot());
    this.add.rectangle(W / 2, H / 2, W, H, 0x020309, 0.94).setDepth(1000).setInteractive();
    addPanel(this, 44, 118, 632, 1010, 0x9e78c6, 0.995).setDepth(1001);
    this.add.text(W / 2, 158, "신탁 확률 및 전체 목록", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(26)}px`, color: "#f5dfa1",
    }).setOrigin(0.5).setDepth(1002);
    this.add.text(W / 2, 224,
      `★5 ${(disclosure.rates[5] * 100).toFixed(0)}% · ★4 ${(disclosure.rates[4] * 100).toFixed(0)}% · ★3 ${(disclosure.rates[3] * 100).toFixed(0)}%\n`+
      `소프트 천장 ${disclosure.softPityStart}회 · 확정 천장 ${disclosure.hardPity}회 · ★5 픽업 ${(disclosure.featuredChance * 100).toFixed(0)}%\n`+
      `픽업 실패 후 다음 ★5는 픽업 확정 · 10회 소환은 ★4 이상 1회 보장\n중복은 조각과 운명 가루로 변환 · 가루 ${FATE_DUST_FEATURED_GUARANTEE_COST}개로 다음 ★5 픽업 확정`,
    { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: "#c8bdd4", align: "center", lineSpacing: 8 }).setOrigin(0.5).setDepth(1002);
    let y = 322;
    ([5, 4, 3] as const).forEach((rarity) => {
      const names = disclosure.heroIdsByRarity[rarity].map((heroId) => {
        const hero = HERO_BY_ID[heroId]!;
        return `${hero.name}${disclosure.storyShardOnlyHeroIds.includes(heroId) ? " [합류 전: 조각]" : ""}`;
      });
      this.add.text(76, y, `★${rarity}  ${names.join(" · ")}`, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`,
        color: rarity === 5 ? "#f2cf72" : rarity === 4 ? "#c8a9e6" : "#9bc9c1",
        wordWrap: { width: 568 }, lineSpacing: 7,
      }).setDepth(1002);
      y += rarity === 5 ? 170 : rarity === 4 ? 190 : 130;
    });
    this.add.text(W / 2, 900, `배너 ${disclosure.bannerId} · 약관 v${disclosure.termsVersion} · ${disclosure.permanent ? "종료일 없는 상시 배너" : "기간 배너"}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#849c9c", align: "center",
    }).setOrigin(0.5).setDepth(1002);
    addButton(this, W / 2, 1056, "확인", {
      width: 280,
      height: 62,
      primary: true,
      focusKey: "summon-disclosure-close",
      onClick: () => this.closeModal("summon-disclosure"),
    }).setDepth(1003);
    ensureUiFocus(this, ["summon-disclosure-close"]);
  }

  private showHistory(): void {
    setUiFocusScope(this, "summon-history");
    setUiEscapeHandler(this, () => this.closeModal("summon-history"));
    const history = [...getServices().save.getSnapshot().summons.history].reverse().slice(0, 12);
    this.add.rectangle(W / 2, H / 2, W, H, 0x020309, 0.94).setDepth(1000).setInteractive();
    addPanel(this, 52, 150, 616, 930, 0x6f89a7, 0.995).setDepth(1001);
    this.add.text(W / 2, 195, "최근 소환 기록", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(27)}px`, color: "#f5dfa1",
    }).setOrigin(0.5).setDepth(1002);
    if (!history.length) {
      this.add.text(W / 2, 550, "아직 소환 기록이 없습니다", {
        fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(17)}px`, color: "#8fa5a7",
      }).setOrigin(0.5).setDepth(1002);
    }
    history.forEach((entry, index) => {
      const hero = HERO_BY_ID[entry.heroId];
      const y = 270 + index * 58;
      this.add.text(82, y, `${"★".repeat(entry.rarity)}  ${hero?.name ?? entry.heroId}`, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`,
        color: entry.rarity === 5 ? "#f2cf72" : entry.rarity === 4 ? "#c8a9e6" : "#9bc9c1",
      }).setDepth(1002);
      this.add.text(638, y, entry.featured ? "PICK UP" : entry.duplicate ? "조각 변환" : "NEW", {
        fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#9eb4b4", align: "right",
      }).setOrigin(1, 0).setDepth(1002);
    });
    addButton(this, W / 2, 1014, "닫기", {
      width: 280,
      height: 62,
      primary: true,
      focusKey: "summon-history-close",
      onClick: () => this.closeModal("summon-history"),
    }).setDepth(1003);
    ensureUiFocus(this, ["summon-history-close"]);
  }

  private closeModal(restoreFocusKey: string): void {
    this.busy = false;
    this.restoreFocusKey = restoreFocusKey;
    setUiEscapeHandler(this, undefined);
    setUiFocusScope(this, "base", restoreFocusKey);
    this.scene.restart();
  }

  private heroTint(hero: HeroDefinition): number {
    return { sea: 0x70c7ce, sun: 0xe6a94c, moon: 0xa687ce, storm: 0x77a8d7, earth: 0xa97651, spirit: 0x75b993 }[hero.element];
  }

  private async activateFateGuarantee(): Promise<void> {
    if (this.busy) return;
    const services = getServices();
    const save = services.save.getSnapshot();
    if (save.summons.guaranteedFeatured) {
      addToast(this, "이미 다음 ★5 픽업 확정이 활성화되어 있습니다.", COLORS.cyan);
      return;
    }
    if (save.resources.fateDust < FATE_DUST_FEATURED_GUARANTEE_COST) {
      addToast(this, `운명 가루가 ${FATE_DUST_FEATURED_GUARANTEE_COST - save.resources.fateDust}개 부족합니다.`, COLORS.red);
      return;
    }
    this.busy = true;
    try {
      await services.save.update((draft) => {
        draft.resources.fateDust -= FATE_DUST_FEATURED_GUARANTEE_COST;
        draft.summons.guaranteedFeatured = true;
      });
      addToast(this, "다음 ★5 영웅의 픽업 확정이 활성화되었습니다.", COLORS.gold);
      this.refreshAfter(summonAutoRefreshDelay(
        services.save.getSnapshot().settings.reducedMotion,
        900,
      ));
    } catch {
      this.busy = false;
      addToast(this, "운명 재봉합을 저장하지 못했습니다.", COLORS.red);
    }
  }

  private refreshAfter(delay: number): void {
    if (delay <= 0) this.scene.restart();
    else this.time.delayedCall(delay, () => this.scene.restart());
  }

}

function pullsFont(hero: HeroDefinition): string { return `${uiTextSize(hero.name.length > 9 ? 13 : 15)}px`; }

type PendingOracleSummon = {
  readonly actionId: "oracle-summon-1" | "oracle-summon-10";
  readonly purchaseId: string;
  readonly reward: JsonObject;
  readonly pulls: readonly SummonPullResult[];
};
