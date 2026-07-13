import Phaser from "phaser";
import { getServices } from "../core/services";
import {
  completeOnboarding,
  hasCompletedOnboarding,
  ONBOARDING_PREP_STEPS,
  readTutorialStep,
  resolveOnboardingExitDestination,
  writeTutorialStep,
} from "../core/uxFlow";
import { addButton, addPanel, addTitle, addTopBar, addUiTween, COLORS, fadeInScene, fadeTo, H, uiTextSize, W } from "../ui/gameUi";
import { TUTORIAL_PREP_LAYOUT } from "./tutorialPresentation";

interface TutorialSceneData {
  replay?: boolean;
  returnScene?: string;
  returnData?: Record<string, unknown>;
}

export class TutorialScene extends Phaser.Scene {
  private replay = false;
  private returnScene = "Harbor";
  private returnData?: Record<string, unknown>;
  private step = 0;
  private stepComplete = false;
  private advancing = false;
  private activePointerId: number | null = null;
  private dragStart?: Phaser.Math.Vector2;
  private practiceCat?: Phaser.GameObjects.Image;
  private guide?: Phaser.GameObjects.Graphics;
  private keyboardHandler?: (event: KeyboardEvent) => void;

  constructor() { super("Tutorial"); }

  init(data: TutorialSceneData): void {
    this.replay = Boolean(data.replay);
    this.returnScene = data.returnScene ?? "Harbor";
    this.returnData = data.returnData;
    const save = getServices().save.getSnapshot();
    this.step = this.replay || hasCompletedOnboarding(save)
      ? 0
      : Math.min(ONBOARDING_PREP_STEPS.length - 1, readTutorialStep(save));
    this.stepComplete = false;
    this.advancing = false;
    this.resetDrag();
  }

  create(): void {
    this.render();
    fadeInScene(this, 180);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unbindKeyboard());
  }

  private render(): void {
    this.children.removeAll(true);
    this.input.removeAllListeners();
    this.resetDrag();
    this.bindKeyboard();
    const current = ONBOARDING_PREP_STEPS[this.step]!;
    const layout = TUTORIAL_PREP_LAYOUT;

    this.add.image(W / 2, H / 2, "arena-cyclops").setDisplaySize(W, H).setTint(0x315d68).setAlpha(0.42);
    this.add.rectangle(W / 2, H / 2, W, H, 0x02090e, 0.74);
    addTopBar(this, this.replay ? "조작 준비 다시 보기" : "첫 출항 준비", () => void this.finish());
    this.add.text(W / 2, 116, `${this.step + 1} / ${ONBOARDING_PREP_STEPS.length}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: "#8fded6",
    }).setOrigin(0.5);
    const progress = this.add.graphics();
    progress.fillStyle(0x172d33, 1).fillRoundedRect(layout.progress.x, layout.progress.y, layout.progress.width, layout.progress.height, 5);
    progress.fillStyle(COLORS.gold, 1).fillRoundedRect(
      layout.progress.x,
      layout.progress.y,
      layout.progress.width * ((this.step + 1) / ONBOARDING_PREP_STEPS.length),
      layout.progress.height,
      5,
    );
    addTitle(this, current.title, 184, 34);
    this.add.text(W / 2, 244, current.summary, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#d9e9df",
      align: "center", wordWrap: { width: 600 },
    }).setOrigin(0.5);

    addPanel(this, layout.demoPanel.x, layout.demoPanel.y, layout.demoPanel.width, layout.demoPanel.height, COLORS.cyan, 0.96);
    this.drawPractice(current.id);

    addPanel(this, layout.copyPanel.x, layout.copyPanel.y, layout.copyPanel.width, layout.copyPanel.height, COLORS.gold, 0.96);
    this.add.text(W / 2, 832, current.inputHint, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(17)}px`, color: "#f0d17c",
      align: "center", wordWrap: { width: 560 },
    }).setOrigin(0.5);
    this.add.text(W / 2, 902, current.detail, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, lineSpacing: 7, color: "#b8ceca",
      align: "center", wordWrap: { width: 558 },
    }).setOrigin(0.5);

    addButton(this, W / 2, layout.primaryButton.y + layout.primaryButton.height / 2,
      this.step === ONBOARDING_PREP_STEPS.length - 1 ? "실전 출항" : "취소 연습으로", {
        width: layout.primaryButton.width,
        height: layout.primaryButton.height,
        icon: this.step === ONBOARDING_PREP_STEPS.length - 1 ? "⚔" : "›",
        enabled: this.stepComplete,
        primary: true,
        subtitle: this.stepComplete ? "r01-s01 실전에서 이어집니다" : this.step === 0
          ? "고양이를 뒤로 당겼다가 놓아 보세요"
          : "당긴 채 우클릭·Esc·두 번째 손가락 탭",
        onClick: () => void this.next(),
      });
    addButton(this, W / 2, layout.skipButton.y + layout.skipButton.height / 2,
      this.replay ? "도움말 닫기" : "준비 건너뛰고 출항", {
        width: layout.skipButton.width,
        height: layout.skipButton.height,
        fontSize: 16,
        accent: 0x607b80,
        onClick: () => void this.finish(),
      });
  }

  private drawPractice(id: "launch" | "cancel"): void {
    const targetY = 414;
    const originY = 556;
    const target = this.add.circle(W / 2, targetY, 38, 0xb54f49, 0.8).setStrokeStyle(4, 0xf1c66d, 0.9);
    this.add.text(W / 2, targetY, "적", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(17)}px`, color: "#fff0ca",
    }).setOrigin(0.5);
    if (id === "cancel") target.setAlpha(0.42);

    const cat = this.add.image(W / 2, originY, "cat-token").setDisplaySize(104, 104).setDepth(24);
    this.practiceCat = cat;
    this.guide = this.add.graphics().setDepth(22);
    const status = this.stepComplete
      ? id === "launch" ? "발사 준비 완료 · 실전에서는 놓는 순간 출발합니다" : "조준 취소 완료 · 이제 다시 안전하게 잡을 수 있습니다"
      : id === "launch" ? "고양이를 아래로 당겼다가 놓으세요" : "아래로 당긴 채, 놓기 전에 취소하세요";
    this.add.text(W / 2, 710, status, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`,
      color: this.stepComplete ? "#8ff0d2" : "#f0d17c", align: "center", wordWrap: { width: 560 },
    }).setOrigin(0.5);

    cat.setInteractive({ useHandCursor: true, draggable: true });
    cat.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0 || this.activePointerId !== null || this.stepComplete) return;
      this.activePointerId = pointer.id;
      this.dragStart = new Phaser.Math.Vector2(pointer.x, pointer.y);
    });
    const handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
      if (this.activePointerId === null) return;
      if (pointer.button === 2 || pointer.id !== this.activePointerId) this.cancelPracticeDrag(id === "cancel");
    };
    const handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.id !== this.activePointerId) return;
      const pulled = Math.max(0, (this.practiceCat?.y ?? originY) - originY);
      this.activePointerId = null;
      this.dragStart = undefined;
      if (id === "launch" && pulled >= 48) {
        this.stepComplete = true;
        addUiTween(this, {
          targets: cat,
          y: targetY + 58,
          duration: 240,
          ease: "Cubic.Out",
          onComplete: () => this.render(),
        });
        return;
      }
      cat.setY(originY);
      this.guide?.clear();
    };
    this.input.on("pointerdown", handlePointerDown);
    this.input.on("pointerdownoutside", handlePointerDown);
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.activePointerId || !this.dragStart) return;
      const dy = Phaser.Math.Clamp(pointer.y - this.dragStart.y, 0, 158);
      cat.setY(originY + dy);
      this.guide?.clear()
        .lineStyle(4, 0x8de1d8, 0.86)
        .lineBetween(W / 2, originY, W / 2, originY - Math.max(42, dy));
    });
    this.input.on("pointerup", handlePointerUp);
    this.input.on("pointerupoutside", handlePointerUp);
  }

  private cancelPracticeDrag(completeStep: boolean): void {
    if (this.activePointerId === null) return;
    this.resetDrag();
    this.stepComplete = completeStep;
    this.render();
  }

  private resetDrag(): void {
    this.activePointerId = null;
    this.dragStart = undefined;
    this.practiceCat = undefined;
    this.guide = undefined;
  }

  private bindKeyboard(): void {
    this.unbindKeyboard();
    this.keyboardHandler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Backspace") return;
      if (this.activePointerId !== null) {
        event.preventDefault();
        this.cancelPracticeDrag(ONBOARDING_PREP_STEPS[this.step]?.id === "cancel");
        return;
      }
      void this.finish();
    };
    this.input.keyboard?.on("keydown", this.keyboardHandler);
  }

  private unbindKeyboard(): void {
    if (this.keyboardHandler) this.input.keyboard?.off("keydown", this.keyboardHandler);
    this.keyboardHandler = undefined;
  }

  private async next(): Promise<void> {
    if (this.advancing || !this.stepComplete) return;
    this.advancing = true;
    try {
      if (this.step >= ONBOARDING_PREP_STEPS.length - 1) {
        await this.finish();
        return;
      }
      this.step += 1;
      this.stepComplete = false;
      if (!this.replay) await getServices().save.update((draft) => writeTutorialStep(draft, this.step));
      this.render();
    } finally {
      this.advancing = false;
    }
  }

  private async finish(): Promise<void> {
    if (this.advancing && this.step < ONBOARDING_PREP_STEPS.length - 1) return;
    if (!this.replay) await getServices().save.update((draft) => completeOnboarding(draft));
    const destination = resolveOnboardingExitDestination({
      replay: this.replay,
      returnScene: this.returnScene,
      returnData: this.returnData,
      save: getServices().save.getSnapshot(),
    });
    fadeTo(this, destination.sceneKey, destination.data);
  }
}
