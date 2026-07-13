import Phaser from "phaser";
import { BLESSING_BY_ID, ENDGAME, HERO_BY_ID, RELIC_BY_ID, STAGE_BY_ID } from "../data";
import {
  canEnterStormBattle,
  craftRaidKey,
  chooseStormNodeOption,
  getCurrentStormNode,
  getEndgameGates,
  getEndgameBattlePreview,
  getEndgameRewardPlan,
  getScyllaAffinityProgress,
  getStormScoreTierProgress,
  getStormNodeStageId,
  getStormNodeOptions,
  getTotalCampaignStars,
  planStormBlessingReroll,
  prepareWeeklyStormState,
  readPendingEndgameVictorySettlement,
  STORM_EXTRA_ENTRY_MATERIAL_ID,
  STORM_HARBOR_SUPPLY_AMOUNT,
  STORM_HARBOR_SUPPLY_OPTION_ID,
  STORM_WEEKLY_BATTLE_LIMIT,
  RAID_KEY_CRAFT_COST,
  describeBlessingEffects,
  type EndgameGateStatus,
  titleDisplayName,
} from "../core/meta";
import { getServices, reconcileWalletAfterPurchase } from "../core/services";
import { hasVaultExpansionEntitlement } from "../state";
import {
  addAtmosphere,
  addButton,
  addFocusableHitArea,
  addPanel,
  addToast,
  addTopBar,
  addUiTween,
  COLORS,
  ensureUiFocus,
  fadeInScene,
  fadeTo,
  H,
  isReducedMotion,
  setUiEscapeHandler,
  setUiFocusScope,
  uiTextSize,
  W,
} from "../ui/gameUi";
import { playBgm } from "../audio/AudioDirector";
import { hoverScaleTarget } from "./motionPresentation";
import { resourceDisplayName } from "../ui/resourceNames";

export class EndgameScene extends Phaser.Scene {
  private purchaseBusy = false;

  constructor() { super("Endgame"); }

  create(): void {
    this.purchaseBusy = false;
    const services = getServices();
    const pendingVictory = readPendingEndgameVictorySettlement(services.save.getSnapshot());
    if (pendingVictory) {
      // In particular, do not let a calendar rollover reset a won Storm run
      // before its frozen reward ticket has been committed.
      this.scene.start("Reward", {
        stageId: pendingVictory.stageId,
        endgameMode: pendingVictory.mode,
      });
      return;
    }
    playBgm(this, "bgm-endgame-oracle");
    const weekly = prepareWeeklyStormState(services.save.getSnapshot());
    const save = weekly.save;
    if (weekly.reset) void services.save.replace(save).catch(async (error) => {
      try { await services.save.saveNow(); }
      catch { addToast(this, error instanceof Error ? error.message : "주간 항로 저장 실패", COLORS.red); }
    });
    const gates = getEndgameGates(save);
    const oracleIndex = Math.min(29, save.endgame.oracleTowerFloor);
    const oracleStageId = ENDGAME.oracleTower.floors[oracleIndex]?.stageId ?? "r01-s02";
    const oraclePlan = getEndgameRewardPlan(save, "oracleTower", oracleStageId);
    const stormNode = getCurrentStormNode(save);
    const stormStageId = getStormNodeStageId(save) ?? "r03-s03";
    const stormPlan = getEndgameRewardPlan(save, "stormRoute", stormStageId);
    const raidPlan = getEndgameRewardPlan(save, "scyllaRaid", "r08-s05");
    const stormScore = getStormScoreTierProgress(save);
    const scyllaAffinity = getScyllaAffinityProgress(save);
    this.add.image(W / 2, H / 2, "arena-cyclops").setDisplaySize(W, H).setTint(0x344c68).setAlpha(0.52);
    this.add.rectangle(W / 2, H / 2, W, H, 0x02070c, 0.56);
    this.drawEndlessSea();
    addAtmosphere(this, 0x9dc5e9, 30);
    addTopBar(this, "끝없는 해역", () => fadeTo(this, "Harbor"));
    this.add.text(W / 2, 130, "메인 항해 너머의 시련", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(30)}px`, color: "#e8d8aa", stroke: "#071014", strokeThickness: 7 }).setOrigin(0.5);
    this.add.text(W / 2, 169, `캠페인 별 ${getTotalCampaignStars(save)} / 129  ·  보유 영웅 ${save.roster.ownedHeroIds.length}명`, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: "#91b7ba" }).setOrigin(0.5);

    this.drawMode("oracleTower", 164, 350, "신탁탑", oraclePlan.label, "♜", gates.oracleTower, `${save.endgame.oracleTowerFloor} / 30층`, () => this.showModePreview("oracleTower", oracleStageId));
    this.drawMode("stormRoute", 556, 350, "폭풍 항로", stormNode.rewardScale > 0 ? stormPlan.label : this.stormNodeLabel(stormNode.type), "≋", gates.stormRoute, save.endgame.stormRoute.active ? `노드 ${stormNode.index} / 12` : `주간 완주 ${Math.min(save.endgame.weeklyStormRuns, STORM_WEEKLY_BATTLE_LIMIT)} / ${STORM_WEEKLY_BATTLE_LIMIT}`, () => stormNode.rewardScale > 0 ? this.showModePreview("stormRoute", stormStageId) : this.startStorm());
    this.drawMode("scyllaRaid", 360, 720, "스킬라 토벌", raidPlan.label, "♛", gates.scyllaRaid, `토벌 열쇠 ${save.endgame.raidKeys}`, () => this.showModePreview("scyllaRaid", "r08-s05"));

    addPanel(this, 54, 920, 612, 122, 0x6e91aa, 0.9);
    this.add.text(84, 950, "스킬라 항해 인연", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#a9d5df" });
    this.add.text(84, 982, `인연 ${scyllaAffinity.level} / 99${scyllaAffinity.next ? ` · 다음 ${scyllaAffinity.next.level}: ${scyllaAffinity.next.label}` : " · 모든 마일스톤 달성"}`, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#d3ddd8" });
    this.add.text(84, 1012, `폭풍 점수 ${stormScore.score.toLocaleString()}${stormScore.next ? ` / ${stormScore.next.score.toLocaleString()} · 다음 ${stormScore.next.label}` : " · 전 티어 달성"}`, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#91b7ba" });
    this.drawAffinityPips(470, 950, scyllaAffinity.level);

    const extraEntries = save.resources.materials[STORM_EXTRA_ENTRY_MATERIAL_ID] ?? 0;
    const vaultExpanded = hasVaultExpansionEntitlement(save);
    addButton(this, 120, 1118, "폭풍 출항", { width: 206, height: 74, icon: "◆", subtitle: `40 · 보유 ${extraEntries}`, accent: 0x6b9fc3, focusKey: "endgame-buy-storm-entry", onClick: () => void this.buy("storm-extra-run") });
    addButton(this, 360, 1118, "토벌 열쇠", { width: 206, height: 74, icon: "◆", subtitle: "다이아 50", accent: 0xb7776f, focusKey: "endgame-buy-raid-key", onClick: () => void this.buy("raid-extra-key") });
    addButton(this, 600, 1118, vaultExpanded ? "보물고 확장 완료" : "보물고 +20", {
      width: 206,
      height: 74,
      icon: vaultExpanded ? "✓" : "◆",
      subtitle: vaultExpanded ? `${save.inventory.relicIds.length}/${save.resources.vaultSlots}칸` : "다이아 180 · 1회",
      enabled: !vaultExpanded,
      accent: 0x9a7ab8,
      focusKey: "endgame-buy-vault-expansion",
      onClick: () => void this.buy("vault-expansion"),
    });
    const scales = save.resources.materials[RAID_KEY_CRAFT_COST.materialId] ?? 0;
    addButton(this, W / 2, 1206, "사냥 전리품으로 열쇠 제작", {
      width: 430, height: 58, icon: "⚒",
      subtitle: `스킬라 비늘 ${scales}/${RAID_KEY_CRAFT_COST.materialAmount} · 골드 ${RAID_KEY_CRAFT_COST.gold.toLocaleString()}`,
      enabled: scales >= RAID_KEY_CRAFT_COST.materialAmount && save.resources.gold >= RAID_KEY_CRAFT_COST.gold,
      accent: COLORS.gold,
      focusKey: "endgame-craft-raid-key",
      onClick: () => void this.craftFreeRaidKey(),
    });
    ensureUiFocus(this, ["endgame-mode-oracleTower", "endgame-mode-stormRoute", "endgame-mode-scyllaRaid"]);
    fadeInScene(this, 220);
  }

  private drawMode(mode: "oracleTower" | "stormRoute" | "scyllaRaid", x: number, y: number, title: string, subtitle: string, icon: string, gate: EndgameGateStatus, progress: string, onClick: () => void): void {
    const radius = x === 360 ? 142 : 126;
    const g = this.add.graphics();
    g.fillStyle(gate.unlocked ? 0x102d3a : 0x151d22, 0.96).lineStyle(7, gate.unlocked ? COLORS.gold : 0x4c5557, 0.95).fillCircle(x, y, radius).strokeCircle(x, y, radius);
    g.lineStyle(2, gate.unlocked ? 0x8dd8dd : 0x343f42, 0.7).strokeCircle(x, y, radius - 17);
    const rune = this.add.text(x, y - 48, gate.unlocked ? icon : "◆", { fontFamily: "Georgia, serif", fontSize: `${uiTextSize(x === 360 ? 72 : 62)}px`, color: gate.unlocked ? "#efd47e" : "#536063" }).setOrigin(0.5);
    this.add.text(x, y + 25, title, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(x === 360 ? 26 : 23)}px`, color: gate.unlocked ? "#f7e7bb" : "#697476" }).setOrigin(0.5);
    this.add.text(x, y + 60, subtitle, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, color: gate.unlocked ? "#a6c5c1" : "#596466" }).setOrigin(0.5);
    this.add.text(x, y + 91, progress, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color: gate.unlocked ? "#e0bd63" : "#576164" }).setOrigin(0.5);
    const hit = addFocusableHitArea(this, x, y, radius * 2, radius * 2, {
      focusKey: `endgame-mode-${mode}`,
      focusable: gate.unlocked,
      onActivate: () => gate.unlocked ? onClick() : addToast(this, gate.reasons[0] ?? "아직 봉인된 해역입니다", COLORS.red),
    });
    const setHovered = (hovered: boolean) => addUiTween(this, {
      targets: rune,
      scale: hoverScaleTarget(isReducedMotion(), hovered),
      duration: 100,
    });
    hit.on("pointerover", () => setHovered(true));
    hit.on("pointerout", () => setHovered(false));
  }

  private showModePreview(mode: "oracleTower" | "stormRoute" | "scyllaRaid", stageId: string): void {
    const save = getServices().save.getSnapshot();
    const stage = STAGE_BY_ID[stageId];
    if (!stage) { addToast(this, "전투 정보를 찾지 못했습니다", COLORS.red); return; }
    const preview = getEndgameBattlePreview(save, mode, stage);
    const rewards = getEndgameRewardPlan(save, mode, stageId);
    const bonusText = rewards.bonuses.length
      ? rewards.bonuses.map((bonus) => this.endgameBonusText(bonus)).join(" · ")
      : "추가 고정 보상 없음";
    const entryText = mode === "scyllaRaid"
      ? save.endgame.scyllaRaid.active ? "진행 중인 토벌 · 열쇠 추가 소비 없음" : "입장 시 토벌 열쇠 1개 소비"
      : mode === "stormRoute" && save.endgame.weeklyStormRuns >= STORM_WEEKLY_BATTLE_LIMIT
        ? "주간 무료 전투 소진 · 폭풍 추가 출항권 1개 소비"
        : "기본 입장 무료";

    setUiFocusScope(this, "endgame-preview", "endgame-preview-party");
    setUiEscapeHandler(this, () => this.scene.restart());
    this.add.rectangle(W / 2, H / 2, W, H, 0x010407, 0.9).setDepth(2000).setInteractive();
    addPanel(this, 44, 220, 632, 820, mode === "scyllaRaid" ? COLORS.red : COLORS.cyan, 0.998).setDepth(2001);
    this.add.text(W / 2, 270, preview.name, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(26)}px`, color: "#f7e7bb",
      align: "center", wordWrap: { width: 570 },
    }).setOrigin(0.5).setDepth(2002);
    this.add.text(W / 2, 330, `권장 전투력 ${preview.recommendedPower.toLocaleString()} · ${preview.objective}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#9fded6",
    }).setOrigin(0.5).setDepth(2002);
    this.add.text(76, 380, "적용 규칙", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#e6c66d" }).setDepth(2002);
    this.add.text(76, 418, preview.ruleLabels.length ? preview.ruleLabels.map((label) => `• ${label}`).join("\n") : "• 추가 규칙 없음", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, lineSpacing: 7, color: "#c8d8d2",
      wordWrap: { width: 568 },
    }).setMaxLines(8).setDepth(2002);
    this.add.text(76, 650, "실제 정산", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#e6c66d" }).setDepth(2002);
    this.add.text(76, 688, `${rewards.label}\n골드 ×${rewards.goldMultiplier.toFixed(2)} · XP ×${rewards.heroXpMultiplier.toFixed(2)} · 재료 ×${rewards.materialMultiplier.toFixed(2)}\n${bonusText}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, lineSpacing: 7, color: "#d8e3dd", wordWrap: { width: 568 },
    }).setDepth(2002);
    this.add.text(W / 2, 805, entryText, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: mode === "scyllaRaid" ? "#f1b3a4" : "#9fded6",
    }).setOrigin(0.5).setDepth(2002);
    addButton(this, W / 2, 884, "편성으로 이동", {
      width: 400, height: 72, icon: "⚔", primary: true,
      focusKey: "endgame-preview-party",
      onClick: () => mode === "oracleTower" ? this.startOracle() : mode === "stormRoute" ? this.startStorm() : this.startRaid(),
    }).setDepth(2003);
    addButton(this, W / 2, 972, "상세 닫기", { width: 280, height: 56, focusKey: "endgame-preview-close", onClick: () => this.scene.restart() }).setDepth(2003);
    ensureUiFocus(this, ["endgame-preview-party", "endgame-preview-close"]);
  }

  private endgameBonusText(bonus: ReturnType<typeof getEndgameRewardPlan>["bonuses"][number]): string {
    const name = bonus.kind === "relic"
      ? RELIC_BY_ID[bonus.id]?.name ?? bonus.id
      : bonus.kind === "fragment" || bonus.kind === "hero"
        ? HERO_BY_ID[bonus.id]?.name ?? bonus.id
        : bonus.kind === "title"
          ? `칭호 ${titleDisplayName(`title:${bonus.id}`) ?? bonus.id}`
          : resourceDisplayName(bonus.id);
    return `${name}${bonus.amount > 1 ? ` ×${bonus.amount}` : ""}`;
  }

  private startOracle(): void {
    const floor = Math.min(29, getServices().save.getSnapshot().endgame.oracleTowerFloor);
    const stageId = ENDGAME.oracleTower.floors[floor]?.stageId ?? "r01-s02";
    fadeTo(this, "Party", { stageId, endgameMode: "oracleTower" });
  }

  private startStorm(): void {
    const save = prepareWeeklyStormState(getServices().save.getSnapshot()).save;
    if (!canEnterStormBattle(save)) {
      addToast(this, "이번 주 기본 폭풍 전투를 완료했습니다. 추가 출항권이 필요합니다.", COLORS.red);
      return;
    }
    const node = getCurrentStormNode(save);
    if (node.rewardScale <= 0) {
      this.showStormChoice(node);
      return;
    }
    const stageId = getStormNodeStageId(save) ?? "r03-s03";
    fadeTo(this, "Party", { stageId, endgameMode: "stormRoute" });
  }

  private startRaid(): void {
    const save = getServices().save.getSnapshot();
    if (!save.endgame.scyllaRaid.active && save.endgame.raidKeys <= 0) {
      addToast(this, "토벌 열쇠가 필요합니다. 아래에서 보급할 수 있습니다.", COLORS.red);
      return;
    }
    fadeTo(this, "Party", { stageId: "r08-s05", endgameMode: "scyllaRaid" });
  }

  private showStormChoice(node: (typeof ENDGAME.stormRoute.nodes)[number]): void {
    setUiFocusScope(this, "endgame-storm-choice", "endgame-storm-option-0");
    setUiEscapeHandler(this, () => this.scene.restart());
    const shade = this.add.rectangle(W / 2, H / 2, W, H, 0x010508, 0.84).setDepth(1000).setInteractive();
    addPanel(this, 62, 344, 596, 540, node.type === "curse" ? COLORS.red : COLORS.cyan, 0.99).setDepth(1001);
    this.add.text(W / 2, 405, this.stormNodeLabel(node.type), {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(30)}px`, color: node.type === "curse" ? "#ffc2b2" : "#d9f4ef",
    }).setOrigin(0.5).setDepth(1002);
    this.add.text(W / 2, 455, `폭풍 항로 ${node.index} / 12 · 하나를 선택하면 되돌릴 수 없습니다`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, color: "#9eb8b9",
    }).setOrigin(0.5).setDepth(1002);
    const options = getStormNodeOptions(getServices().save.getSnapshot());
    options.forEach((optionId, index) => {
      addButton(this, W / 2, 545 + index * 98, this.stormOptionLabel(optionId), {
        width: 470, height: 72, accent: node.type === "curse" ? COLORS.red : COLORS.gold,
        subtitle: this.stormOptionEffect(optionId),
        focusKey: `endgame-storm-option-${index}`,
        onClick: () => void this.chooseStormOption(optionId),
      }).setDepth(1003);
    });
    if (node.type === "blessing") {
      addButton(this, 220, 836, "가호 재선택", {
        width: 270,
        height: 54,
        icon: "◆",
        subtitle: "다이아 30",
        accent: 0x9a7ab8,
        focusKey: "endgame-storm-reroll",
        onClick: () => void this.rerollBlessing(),
      }).setDepth(1003);
      addButton(this, 510, 836, "나중에 선택", { width: 250, height: 54, focusKey: "endgame-storm-close", onClick: () => this.scene.restart() }).setDepth(1003);
    } else {
      addButton(this, W / 2, 836, "나중에 선택", { width: 280, height: 54, focusKey: "endgame-storm-close", onClick: () => this.scene.restart() }).setDepth(1003);
    }
    ensureUiFocus(this, ["endgame-storm-option-0", "endgame-storm-close"]);
  }

  private async chooseStormOption(optionId: string): Promise<void> {
    if (this.purchaseBusy) return;
    this.purchaseBusy = true;
    const services = getServices();
    const result = chooseStormNodeOption(services.save.getSnapshot(), optionId);
    if (!result.ok) { this.purchaseBusy = false; addToast(this, result.message, COLORS.red); return; }
    try {
      await services.save.replace(result.save);
      this.scene.restart();
    } catch (error) {
      try { await services.save.saveNow(); this.scene.restart(); }
      catch (retryError) {
        this.showInstalledSaveRetry(
          "항로 선택 저장이 지연되었습니다",
          "선택 결과는 현재 항로에 이미 반영되어 있습니다. 중복 선택을 막기 위해 저장부터 완료합니다.",
          retryError ?? error,
        );
      }
    }
  }

  private async rerollBlessing(): Promise<void> {
    if (this.purchaseBusy) return;
    const services = getServices();
    const plan = planStormBlessingReroll(services.save.getSnapshot());
    if (!plan.ok) { addToast(this, plan.message, COLORS.red); return; }
    this.purchaseBusy = true;
    try {
      const result = await services.purchases.purchase({
        actionId: "blessing-reroll",
        purchaseId: plan.purchaseId,
        reward: plan.reward,
      });
      if (!result.ok) { addToast(this, result.message, COLORS.red); return; }
      reconcileWalletAfterPurchase(services, result);
      this.scene.restart();
    } finally {
      this.purchaseBusy = false;
    }
  }

  private stormNodeLabel(type: (typeof ENDGAME.stormRoute.nodes)[number]["type"]): string {
    return { battle: "해류 전투", elite: "정예 습격", boss: "주간 폭풍의 눈", blessing: "신의 축복", curse: "항로의 저주", harbor: "표류 항구" }[type];
  }

  private stormOptionLabel(id: string): string {
    return BLESSING_BY_ID[id]?.name ?? ({
      "short-preview": "짧아진 예측선", "rising-current": "솟구치는 해류", "fragile-walls": "부서지기 쉬운 벽",
      repair: "응급 수리", "swap-one-hero": "선원 교대", "revive-one-hero": "영웅 한 명 구조", "remove-one-curse": "저주 하나 정화",
      [STORM_HARBOR_SUPPLY_OPTION_ID]: "항구 보급품",
    } as Readonly<Record<string, string>>)[id] ?? id;
  }

  private stormOptionEffect(id: string): string {
    if (BLESSING_BY_ID[id]) return describeBlessingEffects(id);
    return ({
      "short-preview": "예상선이 첫 구간만 표시", "rising-current": "소용돌이 세기 +45%", "fragile-walls": "파괴벽 내구도 -45%",
      repair: "잠긴 영웅 한 명 복귀", "swap-one-hero": "다음 편성에서 자유 교대", "revive-one-hero": "쓰러진 영웅 한 명 복귀", "remove-one-curse": "가장 오래된 저주 제거",
      [STORM_HARBOR_SUPPLY_OPTION_ID]: `폭풍 유리 +${STORM_HARBOR_SUPPLY_AMOUNT}`,
    } as Readonly<Record<string, string>>)[id] ?? "항로 상태에 즉시 반영";
  }

  private async buy(actionId: "storm-extra-run" | "raid-extra-key" | "vault-expansion"): Promise<void> {
    if (this.purchaseBusy) return;
    this.purchaseBusy = true;
    try {
      const services = getServices();
      const result = await services.purchases.purchase({ actionId });
      if (!result.ok) { addToast(this, result.message, COLORS.red); return; }
      reconcileWalletAfterPurchase(services, result);
      this.scene.restart();
    } finally {
      this.purchaseBusy = false;
    }
  }

  private async craftFreeRaidKey(): Promise<void> {
    if (this.purchaseBusy) return;
    const services = getServices();
    const result = craftRaidKey(services.save.getSnapshot());
    if (!result.ok) { addToast(this, result.message, COLORS.red); return; }
    this.purchaseBusy = true;
    try {
      await services.save.replace(result.save);
      this.scene.restart();
    } catch (error) {
      try { await services.save.saveNow(); this.scene.restart(); }
      catch (retryError) {
        this.showInstalledSaveRetry(
          "열쇠 제작 저장이 지연되었습니다",
          "재료 차감과 토벌 열쇠는 현재 게임에 이미 반영되어 있습니다. 중복 제작을 막기 위해 저장부터 완료합니다.",
          retryError ?? error,
        );
      }
    }
  }

  private showInstalledSaveRetry(title: string, detail: string, error: unknown): void {
    setUiFocusScope(this, "endgame-save-retry", "endgame-save-retry-button");
    let retrying = false;
    this.add.rectangle(W / 2, H / 2, W, H, 0x010407, 0.94).setDepth(4000).setInteractive();
    addPanel(this, 72, 420, 576, 390, COLORS.red, 0.998).setDepth(4001);
    this.add.text(W / 2, 482, title, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(25)}px`, color: "#ffd0c3",
    }).setOrigin(0.5).setDepth(4002);
    this.add.text(W / 2, 565, detail, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, lineSpacing: 8, color: "#d8e3dd", align: "center",
      wordWrap: { width: 500 },
    }).setOrigin(0.5).setDepth(4002);
    const reason = this.add.text(W / 2, 650, error instanceof Error ? error.message : "알 수 없는 저장 오류", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#b9a29c", align: "center", wordWrap: { width: 470 },
    }).setOrigin(0.5).setDepth(4002);
    const retrySave = async (): Promise<void> => {
      if (retrying) return;
      retrying = true;
      try {
        await getServices().save.saveNow();
        setUiEscapeHandler(this, undefined);
        this.scene.restart();
      } catch (retryError) {
        reason.setText(retryError instanceof Error ? retryError.message : "저장을 다시 완료하지 못했습니다");
        retrying = false;
      }
    };
    addButton(this, W / 2, 740, "저장 다시 시도", {
      width: 360, height: 70, icon: "↻", accent: COLORS.gold,
      focusKey: "endgame-save-retry-button",
      onClick: () => void retrySave(),
    }).setDepth(4003);
    setUiEscapeHandler(this, () => void retrySave());
    ensureUiFocus(this, ["endgame-save-retry-button"]);
  }

  private drawEndlessSea(): void {
    const g = this.add.graphics().setDepth(2);
    for (let i = 0; i < 9; i += 1) {
      g.lineStyle(2, i % 2 ? 0x5889a0 : 0x8b6aa5, 0.18).beginPath().moveTo(0, 230 + i * 105);
      for (let x = 0; x <= W; x += 60) g.lineTo(x, 230 + i * 105 + Math.sin((x + i * 30) / 80) * 18);
      g.strokePath();
    }
  }

  private drawAffinityPips(x: number, y: number, affinity: number): void {
    const filled = Math.ceil(Math.min(99, Math.max(0, affinity)) / 20);
    for (let i = 0; i < 5; i += 1) this.add.circle(x + i * 32, y, 9, i < filled ? 0xe3b85c : 0x2d4650, 1).setStrokeStyle(2, 0x8eb8ba, 0.5);
  }
}
