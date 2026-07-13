import Phaser from "phaser";
import { ENDGAME, HERO_BY_ID, RELIC_BY_ID, ROUTE_BY_ID, STAGE_BY_ID } from "../data";
import {
  battleRewardMode,
  readPendingCampaignVictorySettlement,
  readPendingEndgameVictorySettlement,
  settlePendingCampaignVictory,
  settlePendingEndgameVictory,
  titleDisplayName,
  wasBattleRewardCommitted,
  type StageRewardReceipt,
} from "../core/meta";
import { getServices } from "../core/services";
import { resolveCrewJoinDestination, resolveStoryInterludeDestination } from "../core/uxFlow";
import { markCutscenesSeen, probeCutsceneAsset, resolveTriggeredCutscenes } from "../core/cutsceneFlow";
import { addAtmosphere, addButton, addPanel, addTitle, COLORS, fadeInScene, fadeTo, H, uiTextSize, W } from "../ui/gameUi";
import { playBgm, playSfx } from "../audio/AudioDirector";
import { formatResourceAmount, resourceDisplayName } from "../ui/resourceNames";
import {
  formatRewardMilestoneBanner,
  rewardMilestoneRevealPlan,
  rewardStarRevealPlan,
} from "./rewardPresentation";

interface RewardSceneData {
  stageId?: string;
  turns?: number;
  bestCombo?: number;
  totalDamage?: number;
  hpRatio?: number;
  endgameMode?: "oracleTower" | "stormRoute" | "scyllaRaid";
  partyHeroIds?: string[];
  fallenHeroIds?: string[];
  weeklyScoreEnabled?: boolean;
}

export class RewardScene extends Phaser.Scene {
  private dataIn!: Required<Omit<RewardSceneData, "endgameMode">> & Pick<RewardSceneData, "endgameMode">;
  private rewardCommitted = false;
  private pendingCommit?: { stars: number; newRoute: string; receipt: StageRewardReceipt; raidNextPhase?: number };
  private commitErrorObjects: Phaser.GameObjects.GameObject[] = [];
  private continuationPending = false;

  constructor() { super("Reward"); }

  init(data: RewardSceneData): void {
    this.rewardCommitted = false;
    this.pendingCommit = undefined;
    this.commitErrorObjects = [];
    this.continuationPending = false;
    const snapshot = getServices().save.getSnapshot();
    const pendingEndgameVictory = readPendingEndgameVictorySettlement(snapshot);
    const pendingVictory = pendingEndgameVictory
      ? undefined
      : readPendingCampaignVictorySettlement(snapshot);
    this.dataIn = {
      stageId: pendingEndgameVictory?.stageId
        ?? pendingVictory?.stageId
        ?? (data.stageId && STAGE_BY_ID[data.stageId] ? data.stageId : "r01-s01"),
      turns: pendingEndgameVictory?.turns ?? pendingVictory?.turns ?? data.turns ?? 1,
      bestCombo: pendingEndgameVictory?.bestCombo ?? pendingVictory?.bestCombo ?? data.bestCombo ?? 0,
      totalDamage: pendingEndgameVictory?.totalDamage ?? pendingVictory?.totalDamage ?? data.totalDamage ?? 0,
      hpRatio: pendingEndgameVictory?.hpRatio ?? pendingVictory?.hpRatio ?? data.hpRatio ?? 1,
      endgameMode: pendingEndgameVictory?.mode ?? (pendingVictory ? undefined : data.endgameMode),
      partyHeroIds: pendingEndgameVictory
        ? [...pendingEndgameVictory.partyHeroIds]
        : pendingVictory
          ? [...pendingVictory.partyHeroIds]
          : data.partyHeroIds ?? [],
      fallenHeroIds: pendingEndgameVictory
        ? [...pendingEndgameVictory.fallenHeroIds]
        : pendingVictory
          ? [...pendingVictory.fallenHeroIds]
          : data.fallenHeroIds ?? [],
      weeklyScoreEnabled: pendingEndgameVictory?.weeklyScoreEnabled ?? data.weeklyScoreEnabled ?? false,
    };
  }

  create(): void {
    playBgm(this, "bgm-harbor-homeward");
    playSfx(this, "sfx-reward-chest", 0.58, 1.02);
    this.add.image(W / 2, H / 2, "arena-cyclops").setDisplaySize(W, H).setTint(0x557d6f).setAlpha(0.48);
    this.add.rectangle(W / 2, H / 2, W, H, 0x02090d, 0.54);
    addAtmosphere(this, 0xf0d482, 34);
    addTitle(this, "항해 승리", 156, 44);
    this.add.text(W / 2, 212, STAGE_BY_ID[this.dataIn.stageId]!.name, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(19)}px`, color: "#9bc8c1" }).setOrigin(0.5);
    this.drawChest();
    void this.commitAndRender().catch((error: unknown) => {
      if (this.pendingCommit) this.showCommitError(error);
      else this.renderSettlementNotice(error instanceof Error ? error.message : "전투 정산을 시작하지 못했습니다");
    });
    fadeInScene(this, 260);
  }

  private async commitAndRender(): Promise<void> {
    if (this.rewardCommitted) return;
    this.rewardCommitted = true;
    const services = getServices();
    const stage = STAGE_BY_ID[this.dataIn.stageId]!;
    const snapshot = services.save.getSnapshot();
    const pendingEndgameVictory = readPendingEndgameVictorySettlement(snapshot);
    const pendingVictory = pendingEndgameVictory
      ? undefined
      : readPendingCampaignVictorySettlement(snapshot);
    if (pendingEndgameVictory) {
      const settlement = settlePendingEndgameVictory(snapshot);
      if (!settlement.ok) throw new Error(settlement.message);
      this.dataIn.stageId = settlement.settlement.stageId;
      this.dataIn.turns = settlement.settlement.turns;
      this.dataIn.bestCombo = settlement.settlement.bestCombo;
      this.dataIn.totalDamage = settlement.settlement.totalDamage;
      this.dataIn.hpRatio = settlement.settlement.hpRatio;
      this.dataIn.partyHeroIds = [...settlement.settlement.partyHeroIds];
      this.dataIn.fallenHeroIds = [...settlement.settlement.fallenHeroIds];
      this.dataIn.weeklyScoreEnabled = settlement.settlement.weeklyScoreEnabled;
      this.dataIn.endgameMode = settlement.settlement.mode;
      this.pendingCommit = {
        stars: settlement.stars,
        newRoute: "",
        receipt: settlement.rewards,
        ...(settlement.raidNextPhase !== undefined ? { raidNextPhase: settlement.raidNextPhase } : {}),
      };
      await services.save.replace(settlement.save);
      this.pendingCommit = undefined;
      if (settlement.raidNextPhase !== undefined) {
        this.renderRaidPhaseClear(settlement.raidNextPhase);
      } else {
        this.renderRewards(settlement.stars, "", settlement.rewards);
      }
      return;
    }
    if (pendingVictory) {
      const settlement = settlePendingCampaignVictory(snapshot);
      if (!settlement.ok) throw new Error(settlement.message);
      this.dataIn.turns = settlement.settlement.turns;
      this.dataIn.bestCombo = settlement.settlement.bestCombo;
      this.dataIn.totalDamage = settlement.settlement.totalDamage;
      this.dataIn.hpRatio = settlement.settlement.hpRatio;
      this.dataIn.partyHeroIds = [...settlement.settlement.partyHeroIds];
      this.dataIn.fallenHeroIds = [...settlement.settlement.fallenHeroIds];
      const newRoute = settlement.newlyUnlockedRouteId;
      this.pendingCommit = { stars: settlement.stars, newRoute, receipt: settlement.rewards };
      await services.save.replace(settlement.save);
      this.pendingCommit = undefined;
      this.renderRewards(settlement.stars, newRoute, settlement.rewards);
      return;
    }

    const mode = battleRewardMode(this.dataIn.endgameMode);
    if (wasBattleRewardCommitted(snapshot, stage.id, mode)) {
      this.renderSettlementNotice("이미 정산이 끝난 전투입니다. 보상은 중복 지급되지 않습니다.");
      return;
    }
    throw new Error("복구할 수 있는 승리 정산표가 없습니다. 항구에서 다시 확인해 주세요.");
  }

  private showCommitError(error: unknown): void {
    for (const object of this.commitErrorObjects) object.destroy();
    const shade = this.add.rectangle(W / 2, H / 2, W, H, 0x020507, 0.82).setDepth(2000).setInteractive();
    const panel = addPanel(this, 84, 400, 552, 390, COLORS.red, 0.99).setDepth(2001);
    const title = this.add.text(W / 2, 470, "보상 저장을 완료하지 못했습니다", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(27)}px`, color: "#ffd0c3",
      stroke: "#34130f", strokeThickness: 6,
    }).setOrigin(0.5).setDepth(2002);
    const detail = this.add.text(W / 2, 555, "보상은 현재 게임에 보존되어 있습니다.\n저장을 다시 시도해 안전하게 확정하세요.", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(16)}px`, lineSpacing: 8, color: "#d8e3dd", align: "center",
      wordWrap: { width: 460 },
    }).setOrigin(0.5).setDepth(2002);
    const reason = this.add.text(W / 2, 625, error instanceof Error ? error.message : "알 수 없는 저장 오류", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#b9a29c", align: "center", wordWrap: { width: 440 },
    }).setOrigin(0.5).setDepth(2002);
    const retry = addButton(this, W / 2, 710, "저장 다시 시도", {
      width: 360, height: 72, icon: "↻", accent: COLORS.gold, onClick: () => void this.retryPendingCommit(),
    }).setDepth(2003);
    this.commitErrorObjects = [shade, panel, title, detail, reason, retry];
  }

  private async retryPendingCommit(): Promise<void> {
    const pending = this.pendingCommit;
    if (!pending) return;
    try {
      await getServices().save.saveNow();
      for (const object of this.commitErrorObjects) object.destroy();
      this.commitErrorObjects = [];
      this.pendingCommit = undefined;
      if (pending.raidNextPhase !== undefined) this.renderRaidPhaseClear(pending.raidNextPhase);
      else this.renderRewards(pending.stars, pending.newRoute, pending.receipt);
    } catch (error) {
      this.showCommitError(error);
    }
  }

  private renderRaidPhaseClear(nextPhaseIndex: number): void {
    const next = ENDGAME.raid.phases[nextPhaseIndex]!;
    addPanel(this, 76, 560, 568, 330, 0x6d91b5, 0.98);
    this.add.text(W / 2, 620, `${nextPhaseIndex}페이즈 돌파`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(32)}px`, color: "#d8eaff",
    }).setOrigin(0.5);
    this.add.text(W / 2, 690, "파괴한 부위와 열린 안전 지형이 다음 전투로 이어집니다.\n보상은 3페이즈 최종 승리 때 한 번만 정산됩니다.", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(16)}px`, lineSpacing: 9, color: "#b8d0d9", align: "center",
    }).setOrigin(0.5);
    this.add.text(W / 2, 790, `다음 · ${next.name}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#f0cf78",
    }).setOrigin(0.5);
    addButton(this, W / 2, 950, `${nextPhaseIndex + 1}분대 출항`, {
      width: 390, height: 76, icon: "⚔", onClick: () => fadeTo(this, "Party", { stageId: "r08-s05", endgameMode: "scyllaRaid" }),
    });
    addButton(this, W / 2, 1048, "끝없는 해역으로", { width: 390, height: 64, onClick: () => fadeTo(this, "Endgame") });
  }

  private renderSettlementNotice(message: string): void {
    addPanel(this, 76, 570, 568, 250, COLORS.teal, 0.97);
    this.add.text(W / 2, 625, "정산 안내", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(26)}px`, color: "#a9e5dd",
    }).setOrigin(0.5);
    this.add.text(W / 2, 700, message, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(16)}px`, color: "#d7e2dd", align: "center", wordWrap: { width: 470 },
    }).setOrigin(0.5);
    addButton(this, W / 2, 900, this.dataIn.endgameMode ? "끝없는 해역으로" : "항로로 돌아가기", {
      width: 380, height: 72, icon: "↻", onClick: () => {
        if (this.dataIn.endgameMode) fadeTo(this, "Endgame");
        else fadeTo(this, "Route", { routeId: STAGE_BY_ID[this.dataIn.stageId]!.routeId });
      },
    });
    addButton(this, W / 2, 996, "항구로 귀환", { width: 380, height: 66, onClick: () => fadeTo(this, "Harbor") });
  }

  private renderRewards(stars: number, newRoute: string, rewards: StageRewardReceipt): void {
    const reducedMotion = getServices().save.getSnapshot().settings.reducedMotion;
    for (let i = 0; i < 3; i += 1) {
      const motion = rewardStarRevealPlan(reducedMotion, i);
      const star = this.add.text(270 + i * 90, 525, "★", { fontFamily: "Georgia, serif", fontSize: `${uiTextSize(62)}px`, color: i < stars ? "#f2ca63" : "#35494a", stroke: "#6b4522", strokeThickness: i < stars ? 4 : 1 }).setOrigin(0.5).setScale(motion.initialScale).setDepth(50);
      if (motion.animate) {
        this.tweens.add({ targets: star, scale: 1, angle: motion.targetAngle, duration: motion.duration, delay: motion.delay, ease: "Back.Out" });
      }
    }
    const milestoneBanner = formatRewardMilestoneBanner(rewards.starMilestones);
    if (milestoneBanner) {
      const motion = rewardMilestoneRevealPlan(reducedMotion);
      const panel = addPanel(this, 76, 565, 568, 50, COLORS.gold, 0.97)
        .setAlpha(motion.initialAlpha)
        .setDepth(44);
      const headline = this.add.text(W / 2, 577, milestoneBanner.headline, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`,
        color: "#f5d47c", align: "center",
      }).setOrigin(0.5).setAlpha(motion.initialAlpha).setDepth(45).setMaxLines(1);
      const detail = this.add.text(W / 2, 600, milestoneBanner.detail, {
        fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(11)}px`,
        color: "#d8e5dc", align: "center", wordWrap: { width: 530 },
      }).setOrigin(0.5).setAlpha(motion.initialAlpha).setDepth(45).setMaxLines(1);
      if (motion.animate) {
        this.tweens.add({
          targets: [panel, headline, detail],
          alpha: 1,
          duration: motion.duration,
          delay: motion.delay,
          ease: "Sine.Out",
        });
      }
    }
    addPanel(this, 76, 620, 568, 258, COLORS.gold, 0.95);
    const materialText = Object.entries(rewards.materials)
      .map(([id, amount]) => formatResourceAmount(id, amount))
      .join(", ") || "없음";
    this.add.text(112, 662, "획득 전리품", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#f0c66b" });
    this.add.text(112, 702, `●  골드   +${rewards.gold.toLocaleString()}\n✦  영웅 경험   +${rewards.heroXp} × ${rewards.heroXpHeroIds.length}명\n◆  재료   ${materialText}\n⚔  최고 연쇄   ${this.dataIn.bestCombo} HIT`, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(17)}px`, lineSpacing: 10, color: "#d6e2d8", wordWrap: { width: 315 } });
    const firstClearLines = this.describeFirstClearRewards(rewards);
    if (firstClearLines) this.add.text(608, 728, firstClearLines, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#d8b7ee", align: "right", wordWrap: { width: 195 } }).setOrigin(1, 0.5);
    const levelUps = rewards.heroProgress
      .filter((progress) => progress.levelsGained > 0)
      .map((progress) => `${HERO_BY_ID[progress.heroId]?.name ?? progress.heroId} Lv.${progress.levelBefore}→${progress.level}`);
    if (levelUps.length) {
      this.add.text(W / 2, 900, `LEVEL UP  ·  ${levelUps.join("  ·  ")}`, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(15)}px`, color: "#9ff6e9",
        stroke: "#071014", strokeThickness: 4, align: "center", wordWrap: { width: 620 },
      }).setOrigin(0.5);
    }
    const endgameLines = [
      rewards.endgameLabel,
      ...(rewards.endgameBonuses ?? []).map((bonus) => {
        if (bonus.kind === "relicDust" && bonus.sourceRelicId) {
          const relicName = RELIC_BY_ID[bonus.sourceRelicId]?.name ?? bonus.sourceRelicId;
          const reason = bonus.reason === "vault_full" ? "보물고 만석" : "중복 유물";
          return `${reason} · ${relicName} → 유물 가루 +${bonus.amount}`;
        }
        const name = bonus.kind === "fragment" || bonus.kind === "hero"
          ? HERO_BY_ID[bonus.id]?.name ?? resourceDisplayName(bonus.id)
          : bonus.kind === "relic"
            ? RELIC_BY_ID[bonus.id]?.name ?? bonus.id
            : bonus.kind === "title"
              ? `칭호 ${titleDisplayName(`title:${bonus.id}`) ?? bonus.id}`
              : resourceDisplayName(bonus.id);
        return `${name} +${bonus.amount}${bonus.granted ? "" : " (보유)"}`;
      }),
    ].filter((line): line is string => Boolean(line));
    if (endgameLines.length) {
      this.add.text(W / 2, levelUps.length ? 940 : 900, endgameLines.join("  ·  "), {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color: "#c9b5ef",
        align: "center", wordWrap: { width: 620 },
      }).setOrigin(0.5);
    }
    const totals = getServices().save.getSnapshot();
    this.add.text(608, 846, `보유 골드 ${totals.resources.gold.toLocaleString()}\n각성석 ${totals.resources.awakeningMaterials} · 유물 가루 ${totals.resources.relicDust} · 토벌 열쇠 ${totals.endgame.raidKeys}\n보물고 ${totals.inventory.relicIds.length}/${totals.resources.vaultSlots}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(11)}px`, color: "#91b8b3", align: "right",
    }).setOrigin(1, 1);
    if (newRoute) this.add.text(W / 2, levelUps.length ? 946 : 910, "새 항로가 해도에 나타났습니다", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(20)}px`, color: "#8de1d8", stroke: "#071014", strokeThickness: 5 }).setOrigin(0.5);

    if (this.dataIn.endgameMode) {
      addButton(this, W / 2, 1045, "끝없는 해역으로", { width: 380, height: 76, icon: "♜", onClick: () => fadeTo(this, "Endgame") });
    } else {
      const stage = STAGE_BY_ID[this.dataIn.stageId]!;
      const route = ROUTE_BY_ID[stage.routeId]!;
      const index = route.stageIds.indexOf(stage.id);
      const nextStageId = route.stageIds[index + 1];
      addButton(this, W / 2, 1012, nextStageId ? "다음 해역" : "항로 정산", {
        width: 380,
        height: 76,
        icon: nextStageId ? "⚔" : "⚓",
        onClick: () => void this.continueCampaign(
          nextStageId ? "Party" : "Route",
          nextStageId ? { stageId: nextStageId } : { routeId: newRoute || route.id },
        ),
      });
      addButton(this, W / 2, 1108, "항구로 귀환", {
        width: 380,
        height: 66,
        onClick: () => void this.continueCampaign("Harbor"),
      });
    }
  }

  private async continueCampaign(sceneKey: string, data?: Record<string, unknown>): Promise<void> {
    if (this.continuationPending) return;
    this.continuationPending = true;
    const save = getServices().save.getSnapshot();
    const crewDestination = resolveCrewJoinDestination(save, sceneKey, data);
    const stage = STAGE_BY_ID[this.dataIn.stageId]!;
    const route = ROUTE_BY_ID[stage.routeId]!;
    const destination = resolveStoryInterludeDestination(
      save,
      { kind: "stage", stageId: stage.id, timing: "after" },
      crewDestination.sceneKey,
      crewDestination.data,
    );
    const triggered = [
      ...resolveTriggeredCutscenes(save, { kind: "stage", stageId: stage.id, timing: "after" }),
      ...(route.stageIds.at(-1) === stage.id
        ? resolveTriggeredCutscenes(save, { kind: "route", routeId: route.id, timing: "postlude" })
        : []),
    ].filter((cutscene, index, all) => all.findIndex((candidate) => candidate.id === cutscene.id) === index);
    const available = [];
    const unavailableCutsceneIds: string[] = [];
    for (const cutscene of triggered) {
      try {
        if (await probeCutsceneAsset(cutscene)) available.push(cutscene);
        else unavailableCutsceneIds.push(cutscene.id);
      } catch {
        // Optional video lookup must never block campaign continuation.
        unavailableCutsceneIds.push(cutscene.id);
      }
    }
    if (unavailableCutsceneIds.length > 0) {
      try {
        await getServices().save.update((draft) => {
          markCutscenesSeen(draft, unavailableCutsceneIds);
        });
      } catch {
        // Canonical story/campaign navigation is authoritative even if the
        // optional-media seen marker cannot be persisted on this attempt.
      }
    }
    const [first, ...remaining] = available;
    if (first) {
      fadeTo(this, "Cutscene", {
        cutsceneId: first.id,
        remainingCutsceneIds: remaining.map((cutscene) => cutscene.id),
        nextScene: destination.sceneKey,
        nextData: destination.data,
      });
      return;
    }
    fadeTo(this, destination.sceneKey, destination.data);
  }

  private describeFirstClearRewards(rewards: StageRewardReceipt): string {
    const lines: string[] = [];
    if (rewards.firstClear) {
      const kind = { hero: "영웅", relic: "유물", fragment: "조각", material: "재료" }[rewards.firstClear.kind];
      const amount = rewards.firstClear.kind === "hero" || rewards.firstClear.kind === "relic"
        ? ""
        : ` ×${rewards.firstClear.amount}`;
      const displayName = rewards.firstClear.kind === "hero" || rewards.firstClear.kind === "fragment"
        ? HERO_BY_ID[rewards.firstClear.id]?.name ?? rewards.firstClear.id
        : rewards.firstClear.kind === "relic"
          ? RELIC_BY_ID[rewards.firstClear.id]?.name ?? rewards.firstClear.id
          : resourceDisplayName(rewards.firstClear.id);
      lines.push(`첫 돌파 · ${kind}`, `${displayName}${amount}`);
      if (rewards.firstClear.replacement) {
        const replacement = rewards.firstClear.replacement;
        lines.push(
          replacement.kind === "relicDust"
            ? `${replacement.reason === "vault_full" ? "보물고 만석 전환" : "중복 전환"} · 유물 가루 +${replacement.amount}`
            : `중복 전환 · ${HERO_BY_ID[replacement.id]?.name ?? replacement.id} 조각 +${replacement.amount}`,
        );
      } else if (!rewards.firstClear.granted) {
        lines.push("이미 보유한 보상");
      }
    }
    const joinedHeroes = rewards.storyHeroes
      .filter((hero) => hero.newlyOwned)
      .map((hero) => HERO_BY_ID[hero.heroId]?.name ?? hero.heroId);
    if (joinedHeroes.length) lines.push("동료 승선", joinedHeroes.join(" · "));
    if (rewards.raidKeys) lines.push("무료 토벌 열쇠", `+${rewards.raidKeys}`);
    return lines.join("\n");
  }

  private drawChest(): void {
    const g = this.add.graphics().setDepth(20);
    g.fillStyle(0x6f4227, 1).lineStyle(7, 0x2a1711, 1).fillRoundedRect(230, 330, 260, 150, 26).strokeRoundedRect(230, 330, 260, 150, 26);
    g.fillStyle(0x9d6733, 1).fillRoundedRect(230, 300, 260, 98, 45).lineStyle(5, 0xd6a94d, 1).strokeRoundedRect(230, 300, 260, 98, 45);
    g.fillStyle(0xe0b653, 1).fillRoundedRect(337, 372, 46, 72, 10);
    const glow = this.add.image(W / 2, 360, "glow").setScale(3.5).setTint(0xffd56d).setAlpha(0.25).setBlendMode(Phaser.BlendModes.ADD).setDepth(15);
    if (!getServices().save.getSnapshot().settings.reducedMotion) {
      this.tweens.add({ targets: glow, alpha: 0.55, scale: 4.2, duration: 1100, yoyo: true, repeat: -1 });
    }
  }

}
