import Phaser from "phaser";
import { ROUTES, STAGES } from "../data";
import { getServices } from "../core/services";
import { addAtmosphere, addButton, addFocusableHitArea, addPanel, addTitle, addTopBar, addUiTween, bindBackNavigation, COLORS, ensureUiFocus, fadeInScene, fadeTo, H, isReducedMotion, registerFocusableContainer, setUiEscapeHandler, setUiFocusScope, uiTextSize, W } from "../ui/gameUi";
import { playBgm } from "../audio/AudioDirector";
import {
  findPendingCrewJoin,
  resolvePendingVoyageRecoveryDestination,
  resolveTitleVoyageDestination,
} from "../core/uxFlow";
import { getOwnedTitleIds, selectTitle, titleDisplayName } from "../core/meta";
import { hasSeenCutscene } from "../core/cutsceneFlow";
import { CUTSCENE_MANIFEST } from "../data/cutscenes";
import { COLLECTION_SCENE_KEY } from "./collectionPresentation";
import {
  readPendingCampaignVictorySettlement,
  readPendingEndgameVictorySettlement,
  readRestorableBattleRescue,
  readRestorableCampaignBattle,
} from "../core/meta";
import { hoverScaleTarget } from "./motionPresentation";

export class HarborScene extends Phaser.Scene {
  constructor() { super("Harbor"); }

  create(): void {
    playBgm(this, "bgm-harbor-homeward");
    const services = getServices();
    const save = services.save.getSnapshot();
    const pendingEndgameVictory = readPendingEndgameVictorySettlement(save);
    const pendingVictory = readPendingCampaignVictorySettlement(save);
    const pendingRescue = readRestorableBattleRescue(save);
    const recoveryDestination = resolvePendingVoyageRecoveryDestination(save);
    const pendingCrew = recoveryDestination ? undefined : findPendingCrewJoin(save);
    if (pendingCrew) {
      this.scene.start("Story", { kind: "crew", heroId: pendingCrew.heroId, returnScene: "Harbor" });
      return;
    }
    this.add.image(W / 2, H / 2, "harbor-hub").setDisplaySize(W, H).setTint(0x87aaa4).setAlpha(0.78);
    this.add.rectangle(W / 2, H / 2, W, H, 0x031017, 0.34);
    addAtmosphere(this, 0xa5f4e6, 22);
    addTopBar(this, "이타카 전초항");
    bindBackNavigation(this, () => fadeTo(this, "Title"));

    this.add.text(42, 128, "귀향선 · 아르고냥", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#99d5cf",
    });
    const titleName = titleDisplayName(save.inventory.selectedTitleId);
    if (titleName) {
      const titleText = this.add.text(678, 130, `칭호 · ${titleName}  ›`, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color: "#e5c97e",
      }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
      titleText.on("pointerup", () => void this.cycleTitle());
    }
    addTitle(this, "오늘의 항해", 184, 36);
    const completed = save.progress.completedStageIds.length;
    this.add.text(W / 2, 225, `${completed} / ${STAGES.length} 해역 돌파  ·  ${save.roster.ownedHeroIds.length}명 승선`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(16)}px`, color: "#c8d9c8",
    }).setOrigin(0.5);

    const wheel = this.add.graphics();
    wheel.lineStyle(16, 0x8b542d, 1).strokeCircle(W / 2, 470, 146);
    wheel.lineStyle(5, 0xe0b55b, 0.9).strokeCircle(W / 2, 470, 111);
    for (let i = 0; i < 8; i += 1) {
      const angle = Phaser.Math.DegToRad(i * 45);
      wheel.lineBetween(W / 2 + Math.cos(angle) * 35, 470 + Math.sin(angle) * 35, W / 2 + Math.cos(angle) * 174, 470 + Math.sin(angle) * 174);
    }
    wheel.fillStyle(0x0b2d36, 0.95).fillCircle(W / 2, 470, 110);
    wheel.lineStyle(3, COLORS.cyan, 0.7).strokeCircle(W / 2, 470, 106);
    const voyage = this.add.container(W / 2, 470, [
      this.add.text(0, -30, "⚓", { fontSize: `${uiTextSize(54)}px`, color: "#f4d27d" }).setOrigin(0.5),
      this.add.text(0, 34, "항로 선택", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(25)}px`, color: "#f7e7bb" }).setOrigin(0.5),
    ]).setSize(220, 220).setInteractive({ useHandCursor: true });
    const setVoyageHovered = (hovered: boolean) => {
      const scale = hoverScaleTarget(isReducedMotion(), hovered, 1.035);
      addUiTween(this, { targets: [voyage, wheel], scaleX: scale, scaleY: scale, duration: 100 });
    };
    voyage.on("pointerover", () => setVoyageHovered(true));
    voyage.on("pointerout", () => setVoyageHovered(false));
    voyage.on("pointerup", () => {
      if (recoveryDestination) {
        fadeTo(this, recoveryDestination.sceneKey, recoveryDestination.data);
      } else {
        fadeTo(this, "Route", { routeId: save.progress.activeRouteId ?? ROUTES[0]!.id });
      }
    });
    registerFocusableContainer(this, voyage, true);

    const activeBattle = readRestorableCampaignBattle(save);
    if (pendingEndgameVictory) {
      const modeLabel = pendingEndgameVictory.mode === "oracleTower"
        ? "신탁탑"
        : pendingEndgameVictory.mode === "stormRoute"
          ? "폭풍 항로"
          : `스킬라 ${Number(pendingEndgameVictory.scyllaPhaseIndex ?? 0) + 1}페이즈`;
      addButton(this, W / 2, 670, "엔드게임 승리 정산 계속", {
        width: 390,
        height: 58,
        icon: "✦",
        subtitle: `${modeLabel} · ${pendingEndgameVictory.stars}성 달성`,
        accent: COLORS.gold,
        primary: true,
        onClick: () => {
          const destination = resolveTitleVoyageDestination(save);
          fadeTo(this, destination.sceneKey, destination.data);
        },
      });
    } else if (pendingVictory) {
      addButton(this, W / 2, 670, "승리 보상 정산 계속", {
        width: 390,
        height: 58,
        icon: "★",
        subtitle: `${pendingVictory.stageId} · ${pendingVictory.stars}성 달성`,
        accent: COLORS.gold,
        primary: true,
        onClick: () => {
          const destination = resolveTitleVoyageDestination(save);
          fadeTo(this, destination.sceneKey, destination.data);
        },
      });
    } else if (pendingRescue) {
      addButton(this, W / 2, 670, "결제한 구조 전투 계속", {
        width: 390,
        height: 58,
        icon: "◆",
        subtitle: `${pendingRescue.rescue.stageId} · ${pendingRescue.rescue.mode}`,
        accent: COLORS.gold,
        primary: true,
        onClick: () => {
          const destination = resolveTitleVoyageDestination(save);
          fadeTo(this, destination.sceneKey, destination.data);
        },
      });
    } else if (activeBattle) {
      addButton(this, W / 2, 670, "중단한 전투 계속", {
        width: 390,
        height: 58,
        icon: "▶",
        subtitle: `${activeBattle.checkpoint.stageId} · 턴 ${activeBattle.snapshot.turnNumber}`,
        accent: COLORS.cyan,
        primary: true,
        onClick: () => fadeTo(this, "Battle", {
          stageId: activeBattle.checkpoint.stageId,
          resumeCampaign: true,
        }),
      });
    }

    addPanel(this, 34, 700, 652, 104, COLORS.teal, 0.88);
    const activeRoute = ROUTES.find((route) => route.id === save.progress.activeRouteId) ?? ROUTES[0]!;
    this.add.text(68, 724, `항해일지  ${String(activeRoute.order).padStart(2, "0")}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: "#78d9d1",
    });
    this.add.text(68, 755, activeRoute.name, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(23)}px`, color: "#f7e7bb",
    });
    this.add.text(654, 756, "›", { fontFamily: "Georgia, serif", fontSize: `${uiTextSize(44)}px`, color: "#d9b45d" }).setOrigin(1, 0.5);
    const materialTotal = Object.values(save.resources.materials).reduce((sum, amount) => sum + amount, 0);
    this.add.text(W / 2, 824, `보유 재화  ·  각성석 ${save.resources.awakeningMaterials}  ·  유물 가루 ${save.resources.relicDust}  ·  항해 재료 ${materialTotal}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, color: "#9fc4bf",
    }).setOrigin(0.5);

    this.add.text(W / 2, 864, "선내 시설", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#8fb6b2",
    }).setOrigin(0.5);
    addButton(this, 184, 952, "선원 편성", { width: 276, height: 86, icon: "♞", subtitle: "영웅 · 성장", onClick: () => fadeTo(this, "Party", { fromHarbor: true }) });
    addButton(this, 536, 952, "별의 신탁", { width: 276, height: 86, icon: "✦", subtitle: "영웅 소환", accent: 0x9d7bd2, onClick: () => fadeTo(this, "Summon") });
    addButton(this, 184, 1064, "끝없는 해역", { width: 276, height: 86, icon: "♜", subtitle: "탑 · 폭풍 · 토벌", accent: 0x6fa7bd, onClick: () => fadeTo(this, "Endgame") });
    addButton(this, 536, 1064, "항해 도감", {
      width: 276,
      height: 86,
      icon: "☷",
      subtitle: `선원 ${save.roster.ownedHeroIds.length}/16 · 유물 ${save.inventory.relicIds.length}/32`,
      accent: 0x8b8e76,
      onClick: () => fadeTo(this, COLLECTION_SCENE_KEY),
    });

    addButton(this, 184, 1164, "항해 회상", {
      width: 276,
      height: 58,
      icon: "▶",
      fontSize: 16,
      subtitle: `EP1–${CUTSCENE_MANIFEST.length} 전체본`,
      accent: 0x9d7bd2,
      focusKey: "harbor-memories-open",
      onClick: () => this.showCutsceneMemories(),
    });
    addButton(this, 536, 1164, "설정 · 도움말", { width: 276, height: 58, icon: "⚙", fontSize: 16, accent: 0x66888e, onClick: () => fadeTo(this, "Settings", { returnScene: "Harbor" }) });

    if (services.debugMode) {
      addButton(this, W / 2, 1241, "개발 항해실", {
        width: 260,
        height: 42,
        icon: "⚒",
        fontSize: 14,
        accent: COLORS.cyan,
        focusKey: "harbor-debug-room",
        onClick: () => fadeTo(this, "Debug"),
      });
    } else {
      this.add.text(W / 2, 1244, services.hostMode === "mock" ? "로컬 항해 모드 · 다이아 지갑 모의 연결" : "Language Miner 지갑 연결됨", {
        fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#5f817f",
      }).setOrigin(0.5);
    }
    fadeInScene(this);
  }

  private showCutsceneMemories(): void {
    const save = getServices().save.getSnapshot();
    setUiFocusScope(this, "harbor-memories", "harbor-memory-close");
    const shade = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.72).setDepth(1800).setInteractive();
    const panel = addPanel(this, 42, 176, 636, 892, 0x9d7bd2, 0.99).setDepth(1801);
    const content = this.add.container(0, 0).setDepth(1802);
    content.add(this.add.text(W / 2, 218, "항해 회상 · 전체 에피소드", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(27)}px`, color: "#f7e7bb",
    }).setOrigin(0.5));
    content.add(this.add.text(W / 2, 258, "시청한 전체본은 다시 볼 수 있습니다 · 미시청 에피소드는 항해 중 해금됩니다", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, color: "#a8c4c0",
    }).setOrigin(0.5));

    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(CUTSCENE_MANIFEST.length / pageSize));
    const latestSeenIndex = CUTSCENE_MANIFEST.reduce(
      (latest, cutscene, index) => hasSeenCutscene(save, cutscene.id) ? index : latest,
      -1,
    );
    let page = Math.max(0, Math.floor(latestSeenIndex / pageSize));
    let replayHits: Phaser.GameObjects.Container[] = [];
    const pageContent = this.add.container(0, 0).setDepth(1802);
    const pageLabel = this.add.text(W / 2, 912, "", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(13)}px`,
      color: "#9fc4bf",
    }).setOrigin(0.5).setDepth(1804);
    content.add([pageContent, pageLabel]);

    const renderPage = (): void => {
      pageContent.removeAll(true);
      replayHits = [];
      const start = page * pageSize;
      CUTSCENE_MANIFEST.slice(start, start + pageSize).forEach((cutscene, rowIndex) => {
        const y = 314 + rowIndex * 58;
        const seen = hasSeenCutscene(save, cutscene.id);
        const ready = cutscene.enabled && cutscene.status === "ready" && Boolean(cutscene.source);
        const replayable = ready && seen;
        const row = this.add.rectangle(W / 2, y, 560, 48, replayable ? 0x153a45 : 0x101e24, 0.98)
          .setStrokeStyle(2, replayable ? 0x8bdcd4 : ready ? 0x826f45 : 0x3f4a4d, 0.82)
          .setDepth(1803);
        const label = this.add.text(96, y, `EP${String(cutscene.episode).padStart(2, "0")}  ${cutscene.title}`, {
          fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: ready ? "#e9dfbd" : "#788789",
        }).setOrigin(0, 0.5).setDepth(1804);
        const status = this.add.text(632, y, replayable ? "▶ 전체본 재생" : ready ? "스토리에서 해금" : "영상 준비 중", {
          fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(12)}px`, color: replayable ? "#8fe2d7" : ready ? "#d2b86f" : "#657476",
        }).setOrigin(1, 0.5).setDepth(1804);
        pageContent.add([row, label, status]);
        if (replayable) {
          const hit = addFocusableHitArea(this, W / 2, y, 560, 48, {
            focusKey: `harbor-memory-${cutscene.id}`,
            onActivate: () => fadeTo(this, "Cutscene", { cutsceneId: cutscene.id, replay: true, nextScene: "Harbor" }),
          }).setDepth(1805);
          replayHits.push(hit);
          pageContent.add(hit);
        }
      });
      pageLabel.setText(`${page + 1} / ${pageCount}  ·  EP${String(start + 1).padStart(2, "0")}–EP${String(Math.min(start + pageSize, CUTSCENE_MANIFEST.length)).padStart(2, "0")}`);
      previousPage.setVisible(page > 0);
      nextPage.setVisible(page < pageCount - 1);
    };

    const previousPage = addButton(this, 176, 956, "‹ 이전", {
      width: 220,
      height: 52,
      fontSize: 15,
      focusKey: "harbor-memory-previous",
      onClick: () => {
        if (page <= 0) return;
        page -= 1;
        renderPage();
        ensureUiFocus(this, [replayHits[0]?.getData("uiFocusKey") as string, "harbor-memory-next", "harbor-memory-close"].filter(Boolean));
      },
    }).setDepth(1808);
    const nextPage = addButton(this, 544, 956, "다음 ›", {
      width: 220,
      height: 52,
      fontSize: 15,
      focusKey: "harbor-memory-next",
      onClick: () => {
        if (page >= pageCount - 1) return;
        page += 1;
        renderPage();
        ensureUiFocus(this, [replayHits[0]?.getData("uiFocusKey") as string, "harbor-memory-previous", "harbor-memory-close"].filter(Boolean));
      },
    }).setDepth(1808);
    content.add([previousPage, nextPage]);
    renderPage();

    const closeModal = (): void => {
      setUiEscapeHandler(this, undefined);
      setUiFocusScope(this, "base", "harbor-memories-open");
      shade.destroy();
      panel.destroy();
      content.destroy(true);
      close.destroy(true);
      ensureUiFocus(this, ["harbor-memories-open"]);
    };
    const close = addButton(this, W / 2, 1018, "회상 닫기", {
      width: 280,
      height: 58,
      focusKey: "harbor-memory-close",
      onClick: closeModal,
    }).setDepth(1810);
    setUiEscapeHandler(this, closeModal);
    ensureUiFocus(this, [replayHits[0]?.getData("uiFocusKey") as string, "harbor-memory-close"].filter(Boolean));
  }

  private async cycleTitle(): Promise<void> {
    const services = getServices();
    const save = services.save.getSnapshot();
    const titles = getOwnedTitleIds(save);
    if (!titles.length) return;
    const current = save.inventory.selectedTitleId;
    const next = titles[(Math.max(-1, titles.indexOf(current ?? "")) + 1) % titles.length] ?? null;
    await services.save.replace(selectTitle(save, next));
    this.scene.restart();
  }
}
