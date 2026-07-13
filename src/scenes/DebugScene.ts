import Phaser from "phaser";
import { playBgm } from "../audio/AudioDirector";
import {
  clearDebugRunState,
  grantDebugResources,
  prepareCompleteDebugSave,
  summarizeDebugSave,
  unlockAllDebugEndgame,
  unlockAllDebugHeroes,
  unlockAllDebugStory,
} from "../core/debugMode";
import { getServices } from "../core/services";
import type { GameSaveV1 } from "../state";
import {
  addAtmosphere,
  addButton,
  addPanel,
  addTitle,
  addTopBar,
  COLORS,
  ensureUiFocus,
  fadeInScene,
  fadeTo,
  H,
  setUiFocusScope,
  uiTextSize,
  W,
} from "../ui/gameUi";

/** Game-styled control room available only inside the explicit volatile debug voyage. */
export class DebugScene extends Phaser.Scene {
  private busy = false;
  private lastAction = "실제 저장과 다이아 지갑은 이 항해에 연결되지 않습니다.";

  constructor() { super("Debug"); }

  create(): void {
    const services = getServices();
    if (!services.debugMode || !services.save.isVolatileSessionActive()) {
      this.scene.start("Title");
      return;
    }
    playBgm(this, "bgm-harbor-homeward");
    setUiFocusScope(this, "base");
    this.render();
    fadeInScene(this, 180);
  }

  private render(): void {
    this.children.removeAll(true);
    setUiFocusScope(this, "base");
    const save = getServices().save.getSnapshot();
    const summary = summarizeDebugSave(save);

    this.add.image(W / 2, H / 2, "harbor-hub").setDisplaySize(W, H).setTint(0x496b79).setAlpha(0.5);
    this.add.rectangle(W / 2, H / 2, W, H, 0x01090f, 0.72);
    addAtmosphere(this, 0x8fe1d8, 20);
    addTopBar(this, "선장의 비밀 해도", () => fadeTo(this, "Harbor"));
    addTitle(this, "개발 항해실", 138, 34);

    addPanel(this, 42, 178, 636, 116, COLORS.cyan, 0.98);
    this.add.text(W / 2, 207, "휘발성 시험 항해", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(21)}px`,
      color: "#8fe1d8",
    }).setOrigin(0.5);
    this.add.text(W / 2, 250, this.lastAction, {
      fontFamily: "Malgun Gothic, sans-serif",
      fontSize: `${uiTextSize(14)}px`,
      color: "#d7e5dd",
      align: "center",
      wordWrap: { width: 560, useAdvancedWrap: true },
    }).setOrigin(0.5).setMaxLines(2);

    addPanel(this, 42, 314, 636, 104, COLORS.gold, 0.96);
    this.add.text(W / 2, 346, `스토리 ${summary.completedStages}/${summary.totalStages}  ·  선원 ${summary.ownedHeroes}/${summary.totalHeroes}`, {
      fontFamily: "Malgun Gothic, sans-serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(18)}px`,
      color: "#f7e7bb",
    }).setOrigin(0.5);
    this.add.text(W / 2, 386, `토벌 열쇠 ${summary.raidKeys}  ·  골드 ${summary.gold.toLocaleString()}  ·  실제 다이아 사용 차단`, {
      fontFamily: "Malgun Gothic, sans-serif",
      fontSize: `${uiTextSize(14)}px`,
      color: "#9fc4bf",
    }).setOrigin(0.5);

    this.add.text(W / 2, 452, "시험 해도 각인", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(18)}px`,
      color: "#d7c179",
    }).setOrigin(0.5);

    this.actionButton(188, 522, "스토리 전부 개방", "43 스테이지 · EP1–20 회상", "✦", unlockAllDebugStory, "debug-story");
    this.actionButton(532, 522, "엔드 콘텐츠 개방", "탑 · 폭풍 · 스킬라 입장", "♜", unlockAllDebugEndgame, "debug-endgame");
    this.actionButton(188, 642, "전 선원 최대 성장", "16명 · 레벨 60 · 각성 5", "♞", unlockAllDebugHeroes, "debug-roster");
    this.actionButton(532, 642, "시험 보급 채우기", "골드 · 재료 · 전 유물", "◆", grantDebugResources, "debug-resources");
    this.actionButton(188, 762, "전체 테스트 준비", "모든 개방과 보급을 한 번에", "★", prepareCompleteDebugSave, "debug-all", true);
    this.actionButton(532, 762, "진행 중 항해 정리", "전투 · 정산 · 엔드런 초기화", "↻", clearDebugRunState, "debug-clear-runs");

    this.add.text(W / 2, 847, "바로 출항", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(18)}px`,
      color: "#8fb6b2",
    }).setOrigin(0.5);
    addButton(this, 132, 916, "항로", {
      width: 190, height: 72, icon: "⚓", fontSize: 17, focusKey: "debug-go-route",
      onClick: () => fadeTo(this, "Route", { routeId: save.progress.activeRouteId }),
    });
    addButton(this, 360, 916, "선원 편성", {
      width: 190, height: 72, icon: "♞", fontSize: 17, focusKey: "debug-go-party",
      onClick: () => fadeTo(this, "Party", { fromHarbor: true }),
    });
    addButton(this, 588, 916, "끝없는 해역", {
      width: 190, height: 72, icon: "♜", fontSize: 16, focusKey: "debug-go-endgame",
      onClick: () => fadeTo(this, "Endgame"),
    });

    addButton(this, W / 2, 1024, "시험 항해 시작 상태로 복원", {
      width: 460,
      height: 64,
      icon: "↶",
      fontSize: 16,
      accent: 0x8b6c8e,
      focusKey: "debug-restore-baseline",
      onClick: () => this.restoreBaseline(),
    });
    this.add.text(W / 2, 1072, "이 탭을 열었을 때의 실제 저장 복제본으로만 되돌립니다.", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontSize: `${uiTextSize(12)}px`,
      color: "#879f9c",
    }).setOrigin(0.5);

    addButton(this, W / 2, 1160, "항구로 돌아가기", {
      width: 360,
      height: 68,
      primary: true,
      focusKey: "debug-return-harbor",
      onClick: () => fadeTo(this, "Harbor"),
    });
    this.add.text(W / 2, 1231, "주소에서 ?catDebug=1을 제거하고 다시 열면 일반 저장으로 복귀합니다.", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontSize: `${uiTextSize(11)}px`,
      color: "#688481",
    }).setOrigin(0.5);
    ensureUiFocus(this, ["debug-all", "debug-story", "debug-return-harbor"]);
  }

  private actionButton(
    x: number,
    y: number,
    label: string,
    subtitle: string,
    icon: string,
    mutate: (save: GameSaveV1) => void,
    focusKey: string,
    primary = false,
  ): void {
    addButton(this, x, y, label, {
      width: 304,
      height: 96,
      icon,
      subtitle,
      fontSize: 17,
      accent: primary ? COLORS.gold : COLORS.cyan,
      primary,
      focusKey,
      enabled: !this.busy,
      onClick: () => void this.apply(label, mutate),
    });
  }

  private async apply(label: string, mutate: (save: GameSaveV1) => void): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await getServices().save.update(mutate);
      this.lastAction = `${label} 완료 · 이 탭의 휘발성 시험 저장에만 적용되었습니다.`;
    } catch (error) {
      this.lastAction = `${label} 실패 · ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private restoreBaseline(): void {
    getServices().save.restoreVolatileSessionBaseline();
    this.lastAction = "시험 항해 시작 상태를 복원했습니다. 실제 저장은 처음부터 변경되지 않았습니다.";
    this.render();
  }
}
