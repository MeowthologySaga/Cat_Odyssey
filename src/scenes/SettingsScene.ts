import Phaser from "phaser";
import { playBgm, refreshAudioSettings } from "../audio/AudioDirector";
import { getServices } from "../core/services";
import { COMBAT_HELP_CARDS } from "../core/uxFlow";
import { adjustAudioVolume, type AudioVolumeKey } from "../state/audioVolume";
import type { ColorVisionMode, GameLanguage, TextScale } from "../state/saveSchema";
import {
  accessibilityPaletteFor,
  addButton,
  addPanel,
  addTitle,
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
import {
  colorVisionLabel,
  nextColorVisionMode,
  SETTINGS_LAYOUT,
  SETTINGS_PAGES,
  textScaleLabel,
  type SettingsPage,
} from "./settingsPresentation";

interface SettingsSceneData { returnScene?: string; page?: SettingsPage }
type VolumeKey = AudioVolumeKey;
type ToggleKey = "reducedMotion" | "screenShake" | "aimAssist";

export class SettingsScene extends Phaser.Scene {
  private returnScene = "Harbor";
  private resetBusy = false;
  private page: SettingsPage = "sound";

  constructor() { super("Settings"); }

  init(data: SettingsSceneData): void {
    this.returnScene = data.returnScene ?? "Harbor";
    this.page = SETTINGS_PAGES.some((entry) => entry.id === data.page) ? data.page! : "sound";
  }

  create(): void {
    this.resetBusy = false;
    playBgm(this, "bgm-harbor-homeward");
    setUiFocusScope(this, "base");
    this.render();
    fadeInScene(this, 180);
  }

  private render(): void {
    this.children.removeAll(true);
    setUiEscapeHandler(this, undefined);
    setUiFocusScope(this, "base");
    const settings = getServices().save.getSnapshot().settings;
    this.add.image(W / 2, H / 2, "harbor-hub").setDisplaySize(W, H).setTint(0x4c7474).setAlpha(0.4);
    this.add.rectangle(W / 2, H / 2, W, H, settings.highContrast ? 0x000000 : 0x02090e, settings.highContrast ? 0.84 : 0.7);
    addTopBar(this, "설정 · 도움말", () => fadeTo(this, this.returnScene));
    addTitle(this, "항해 환경", SETTINGS_LAYOUT.headingY, 28);
    this.add.text(W / 2, SETTINGS_LAYOUT.descriptionY, "소리·조작·표시 방식을 언제든 안전하게 바꿀 수 있습니다.", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontSize: `${uiTextSize(14)}px`,
      color: settings.highContrast ? "#e8ffff" : "#a9c8c3",
      align: "center",
      wordWrap: { width: 650, useAdvancedWrap: true },
    }).setOrigin(0.5).setMaxLines(2);

    SETTINGS_PAGES.forEach((entry, index) => {
      addButton(this, 190 + index * 340, SETTINGS_LAYOUT.tabsY, entry.label, {
        width: 310,
        height: SETTINGS_LAYOUT.tabHeight,
        fontSize: 17,
        accent: this.page === entry.id ? COLORS.gold : 0x54767c,
        primary: this.page === entry.id,
        focusKey: `settings-page-${entry.id}`,
        onClick: () => {
          if (this.page === entry.id) return;
          this.page = entry.id;
          this.render();
        },
      });
    });

    addPanel(
      this,
      48,
      SETTINGS_LAYOUT.panelTop,
      624,
      SETTINGS_LAYOUT.panelBottom - SETTINGS_LAYOUT.panelTop,
      this.page === "sound" ? COLORS.cyan : COLORS.gold,
      0.98,
    );
    if (this.page === "sound") this.drawSoundPage(settings);
    else this.drawAccessibilityPage(settings);

    addButton(this, W / 2, SETTINGS_LAYOUT.resetY, "진행 데이터 초기화", {
      width: 306,
      height: 46,
      fontSize: 14,
      accent: COLORS.red,
      focusKey: "settings-reset-progress",
      onClick: () => void this.resetProgress(),
    });
    this.add.text(W / 2, SETTINGS_LAYOUT.resetY + 31, "학습으로 얻은 다이아 잔액은 초기화되지 않습니다", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontSize: `${uiTextSize(11)}px`,
      color: settings.highContrast ? "#f4dddd" : "#9b8582",
    }).setOrigin(0.5);
    addButton(this, W / 2, SETTINGS_LAYOUT.doneY, "설정 완료", {
      width: 330,
      height: 60,
      icon: "✓",
      focusKey: "settings-done",
      onClick: () => fadeTo(this, this.returnScene),
    });
    ensureUiFocus(this, [`settings-page-${this.page}`, "settings-done"]);
  }

  private drawSoundPage(settings: ReturnType<ReturnType<typeof getServices>["save"]["getSnapshot"]>["settings"]): void {
    this.add.text(76, 277, "소리", this.sectionHeading("#8fe1d8"));
    this.add.text(76, 309, "각 음량은 전체 음량과 곱해져 적용됩니다.", this.descriptionStyle());
    this.drawVolumeRow(385, "전체 음량", "masterVolume", settings.masterVolume, settings.lastNonZeroMasterVolume);
    this.drawVolumeRow(505, "배경 음악", "musicVolume", settings.musicVolume, settings.lastNonZeroMusicVolume);
    this.drawVolumeRow(625, "효과음", "sfxVolume", settings.sfxVolume, settings.lastNonZeroSfxVolume);
    this.drawLanguageRow(758, settings.language);

    addButton(this, W / 2, 914, "전투 도움말 다시 보기", {
      width: 440,
      height: 78,
      icon: "?",
      subtitle: "조준 취소 · 우정 연계 · 적 예고 · 해역 목표",
      focusKey: "settings-combat-help",
      onClick: () => this.showCombatHelp(),
    });
    this.add.text(W / 2, 1003, "컷신 언어는 영상 아래 자막에만 적용되며, 게임 진행과 보상에는 영향을 주지 않습니다.", {
      ...this.descriptionStyle(),
      align: "center",
      wordWrap: { width: 540, useAdvancedWrap: true },
    }).setOrigin(0.5).setMaxLines(2);
  }

  private drawAccessibilityPage(settings: ReturnType<ReturnType<typeof getServices>["save"]["getSnapshot"]>["settings"]): void {
    this.add.text(76, 277, "조작과 화면", this.sectionHeading("#efd27f"));
    this.drawToggleRow(355, "모션 줄이기", "화면 이동과 반복 애니메이션을 최소화", "reducedMotion", settings.reducedMotion);
    this.drawToggleRow(
      460,
      "화면 흔들림",
      settings.reducedMotion ? "모션 줄이기 설정으로 현재 비활성" : "강한 타격의 카메라 반응",
      "screenShake",
      settings.screenShake,
      !settings.reducedMotion,
      settings.reducedMotion ? "비활성" : undefined,
    );
    this.drawToggleRow(565, "조준 보조", "첫 반사까지 예상 궤적 표시", "aimAssist", settings.aimAssist);

    this.add.text(76, 642, "읽기와 색상 구분", this.sectionHeading("#efd27f"));
    this.drawChoiceRow(710, "글자 크기", "공용 UI·도감·전투 핵심 정보", textScaleLabel(settings.textScale), "settings-text-scale", () => void this.toggleTextScale());
    this.drawChoiceRow(815, "고대비 표시", "더 굵은 윤곽선과 밝은 경고", settings.highContrast ? "켜짐" : "꺼짐", "settings-high-contrast", () => void this.toggleHighContrast(), settings.highContrast ? COLORS.green : 0x6a7477);
    this.drawChoiceRow(920, "색각 구분", "색뿐 아니라 아이콘과 선 모양도 변경", colorVisionLabel(settings.colorVision), "settings-color-vision", () => void this.cycleColorVision(), COLORS.cyan, 178);
    this.drawAccessibilityLegend(settings.highContrast, settings.colorVision);
  }

  private drawVolumeRow(
    y: number,
    label: string,
    key: VolumeKey,
    value: number,
    rememberedValue: number,
  ): void {
    this.add.text(82, y, label, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#e7eee7",
    }).setOrigin(0, 0.5);
    const bar = this.add.graphics();
    bar.fillStyle(0x132a31, 1).fillRoundedRect(245, y - 9, 242, 18, 9);
    bar.fillStyle(COLORS.cyan, 1).fillRoundedRect(248, y - 6, 236 * value, 12, 6);
    this.add.text(528, y, `${Math.round(value * 100)}%`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(17)}px`, color: "#bde8e0",
    }).setOrigin(0.5);
    if (value === 0) {
      this.add.text(366, y + 27, `+ 버튼으로 ${Math.round(rememberedValue * 100)}% 복원`, {
        fontFamily: "Malgun Gothic, sans-serif",
        fontSize: `${uiTextSize(11)}px`,
        color: "#8fb9b3",
      }).setOrigin(0.5);
    }
    addButton(this, 590, y, "−", {
      width: 52, height: 50, fontSize: 22, focusKey: `settings-${key}-down`, enabled: value > 0, onClick: () => void this.adjustVolume(key, -0.1),
    });
    addButton(this, 646, y, "+", {
      width: 52, height: 50, fontSize: 22, focusKey: `settings-${key}-up`, enabled: value < 1, onClick: () => void this.adjustVolume(key, 0.1),
    });
  }

  private drawToggleRow(
    y: number,
    label: string,
    description: string,
    key: ToggleKey,
    value: boolean,
    interactive = true,
    statusLabel?: string,
  ): void {
    this.add.text(82, y - 15, label, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#eee7d1",
    }).setOrigin(0, 0.5);
    this.add.text(82, y + 19, description, {
      ...this.descriptionStyle(), wordWrap: { width: 420, useAdvancedWrap: true },
    }).setOrigin(0, 0.5).setMaxLines(2);
    addButton(this, 585, y, statusLabel ?? (value ? "켜짐" : "꺼짐"), {
      width: 126,
      height: 60,
      fontSize: 17,
      focusKey: `settings-${key}`,
      enabled: interactive,
      accent: value && interactive ? COLORS.green : 0x6a7477,
      onClick: () => void this.toggle(key),
    });
  }

  private drawChoiceRow(
    y: number,
    label: string,
    description: string,
    value: string,
    focusKey: string,
    onClick: () => void,
    accent: number = COLORS.gold,
    buttonWidth: number = 156,
  ): void {
    this.add.text(82, y - 15, label, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#eee7d1",
    }).setOrigin(0, 0.5);
    this.add.text(82, y + 19, description, {
      ...this.descriptionStyle(), wordWrap: { width: 405, useAdvancedWrap: true },
    }).setOrigin(0, 0.5).setMaxLines(2);
    addButton(this, 574, y, value, {
      width: buttonWidth, height: 60, fontSize: 15, accent, focusKey, onClick,
    });
  }

  private drawLanguageRow(y: number, language: GameLanguage): void {
    this.add.text(82, y - 15, "컷신 언어 · 자막", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#eee7d1",
    }).setOrigin(0, 0.5);
    this.add.text(82, y + 20, language === "ko" ? "원본 영상 아래에 한국어 자막 표시" : "영상에 포함된 English captions 사용", {
      ...this.descriptionStyle(), wordWrap: { width: 420, useAdvancedWrap: true },
    }).setOrigin(0, 0.5).setMaxLines(2);
    addButton(this, 585, y, language === "ko" ? "한국어" : "English", {
      width: 126, height: 60, fontSize: 16, accent: COLORS.cyan, focusKey: "settings-language", onClick: () => void this.toggleLanguage(),
    });
  }

  private drawAccessibilityLegend(highContrast: boolean, colorVision: ColorVisionMode): void {
    const palette = accessibilityPaletteFor({ highContrast, colorVision });
    const legend = [
      { x: 126, label: "● 아군", color: palette.ally },
      { x: 280, label: "× 적", color: palette.enemy },
      { x: 424, label: "◆ 목표", color: palette.objective },
      { x: 574, label: "⚠ 위험", color: palette.danger },
    ];
    legend.forEach((entry) => this.add.text(entry.x, 1008, entry.label, {
      fontFamily: "Malgun Gothic, sans-serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(15)}px`,
      color: `#${entry.color.toString(16).padStart(6, "0")}`,
      stroke: "#000000",
      strokeThickness: highContrast ? 5 : 3,
    }).setOrigin(0.5));
    this.add.text(W / 2, 1053, "전투에서는 원형·파선·마름모·경고 무늬가 색상과 함께 표시됩니다.", {
      ...this.descriptionStyle(), align: "center", wordWrap: { width: 560, useAdvancedWrap: true },
    }).setOrigin(0.5).setMaxLines(2);
  }

  private showCombatHelp(): void {
    setUiFocusScope(this, "settings-help", "settings-help-close");
    const shade = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.82).setDepth(1800).setInteractive();
    const panel = addPanel(this, 42, 104, 636, 1060, COLORS.cyan, 0.995).setDepth(1801);
    const content = this.add.container(0, 0).setDepth(1802);
    content.add(this.add.text(W / 2, 156, "전투 도움말", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(29)}px`, color: "#f7e7bb",
    }).setOrigin(0.5));
    content.add(this.add.text(W / 2, 202, "필요할 때만 펼쳐 보는 핵심 규칙 · 진행도와 코치마크는 초기화되지 않습니다", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(13)}px`, color: "#9fc4bf",
      wordWrap: { width: 560, useAdvancedWrap: true }, align: "center",
    }).setOrigin(0.5).setMaxLines(2));

    COMBAT_HELP_CARDS.forEach((card, index) => {
      const y = 282 + index * 156;
      const cardPanel = this.add.rectangle(W / 2, y, 560, 124, 0x10252d, 0.98)
        .setStrokeStyle(2, index === 0 ? 0xe2bd61 : 0x568b8b, 0.86);
      const title = this.add.text(96, y - 36, card.title, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: index === 0 ? "#efd27f" : "#8fe1d8",
      });
      const body = this.add.text(96, y - 4, card.body, {
        fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, lineSpacing: 5, color: "#c3d5d1",
        wordWrap: { width: 520, useAdvancedWrap: true },
      }).setMaxLines(3);
      content.add([cardPanel, title, body]);
    });

    let closed = false;
    const closeHelp = () => {
      if (closed) return;
      closed = true;
      setUiEscapeHandler(this, undefined);
      shade.destroy();
      panel.destroy();
      content.destroy(true);
      practice.destroy(true);
      close.destroy(true);
      setUiFocusScope(this, "base", "settings-combat-help");
    };
    const practice = addButton(this, W / 2, 958, "당기기·취소 연습 다시 보기", {
      width: 400,
      height: 66,
      icon: "↺",
      subtitle: "우클릭 · Esc · 두 번째 손가락 탭",
      focusKey: "settings-help-practice",
      onClick: () => fadeTo(this, "Tutorial", {
        replay: true,
        returnScene: "Settings",
        returnData: { returnScene: this.returnScene, page: this.page },
      }),
    }).setDepth(1810);
    const close = addButton(this, W / 2, 1062, "도움말 닫기", {
      width: 300,
      height: 58,
      primary: true,
      focusKey: "settings-help-close",
      onClick: closeHelp,
    }).setDepth(1810);
    setUiEscapeHandler(this, closeHelp);
  }

  private sectionHeading(color: string): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(22)}px`, color };
  }

  private descriptionStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    const highContrast = getServices().save.getSnapshot().settings.highContrast;
    return { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: highContrast ? "#d7efec" : "#92aaa7" };
  }

  private async adjustVolume(key: VolumeKey, delta: number): Promise<void> {
    try {
      await getServices().save.update((draft) => {
        draft.settings = adjustAudioVolume(draft.settings, key, delta);
      });
      refreshAudioSettings(this);
      this.render();
    } catch {
      addToast(this, "설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", COLORS.red);
    }
  }

  private async toggle(key: ToggleKey): Promise<void> {
    try {
      await getServices().save.update((draft) => { draft.settings[key] = !draft.settings[key]; });
      refreshAudioSettings(this);
      this.render();
    } catch {
      addToast(this, "설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", COLORS.red);
    }
  }

  private async toggleLanguage(): Promise<void> {
    try {
      await getServices().save.update((draft) => {
        draft.settings.language = draft.settings.language === "ko" ? "en" : "ko";
      });
      this.render();
    } catch {
      addToast(this, "언어 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", COLORS.red);
    }
  }

  private async toggleTextScale(): Promise<void> {
    await this.updateAccessibility((settings) => {
      settings.textScale = settings.textScale === 100 ? 115 : 100;
    }, "글자 크기 설정");
  }

  private async toggleHighContrast(): Promise<void> {
    await this.updateAccessibility((settings) => {
      settings.highContrast = !settings.highContrast;
    }, "고대비 설정");
  }

  private async cycleColorVision(): Promise<void> {
    await this.updateAccessibility((settings) => {
      settings.colorVision = nextColorVisionMode(settings.colorVision);
    }, "색각 구분 설정");
  }

  private async updateAccessibility(
    update: (settings: { textScale: TextScale; highContrast: boolean; colorVision: ColorVisionMode }) => void,
    label: string,
  ): Promise<void> {
    try {
      await getServices().save.update((draft) => update(draft.settings));
      this.render();
    } catch {
      addToast(this, `${label}을 저장하지 못했습니다.`, COLORS.red);
    }
  }

  private async resetProgress(): Promise<void> {
    if (this.resetBusy) return;
    this.resetBusy = true;
    try {
      const approved = await getServices().host.ui.confirm({
        title: "모든 진행 데이터를 초기화할까요?",
        message: "스토리, 영웅, 장비, 재료와 설정이 처음 상태로 돌아갑니다. 학습으로 얻은 다이아 잔액은 유지됩니다.",
      });
      if (!approved) return;
      await getServices().save.clear();
      fadeTo(this, "Title");
    } catch {
      addToast(this, "진행 데이터를 초기화하지 못했습니다. 잠시 후 다시 시도해 주세요.", COLORS.red);
    } finally {
      this.resetBusy = false;
    }
  }
}
