import Phaser from "phaser";
import { CUTSCENE_BY_ID, type CutsceneDefinition } from "../data/cutscenes";
import { cutsceneSubtitleAt } from "../data/cutsceneSubtitles";
import type { GameLanguage } from "../state/saveSchema";
import { markCutsceneSeen, resolveCutsceneNext } from "../core/cutsceneFlow";
import { getServices } from "../core/services";
import { pauseManagedAudio, resumeManagedAudio } from "../audio/AudioDirector";
import { addButton, addPanel, COLORS, fadeTo, H, uiTextSize, W } from "../ui/gameUi";

interface CutsceneSceneData {
  cutsceneId?: string;
  replay?: boolean;
  nextScene?: string;
  nextData?: Readonly<Record<string, unknown>>;
  remainingCutsceneIds?: readonly string[];
}

export class CutsceneScene extends Phaser.Scene {
  private definition?: CutsceneDefinition;
  private replay = false;
  private nextScene?: string;
  private nextData?: Readonly<Record<string, unknown>>;
  private remainingCutsceneIds: string[] = [];
  private video?: Phaser.GameObjects.Video;
  private statusText?: Phaser.GameObjects.Text;
  private timeText?: Phaser.GameObjects.Text;
  private subtitleText?: Phaser.GameObjects.Text;
  private progressFill?: Phaser.GameObjects.Graphics;
  private loadWatchdog?: Phaser.Time.TimerEvent;
  private autoplayWatchdog?: Phaser.Time.TimerEvent;
  private fallbackTimer?: Phaser.Time.TimerEvent;
  private finishing = false;
  private playbackStarted = false;
  private mutedAutoplayFallback = false;
  private gameAudioPaused = false;
  private resumeAudioOnShutdown = true;
  private keyHandler?: (event: KeyboardEvent) => void;
  private language: GameLanguage = "ko";

  constructor() { super("Cutscene"); }

  init(data: CutsceneSceneData): void {
    this.definition = data.cutsceneId ? CUTSCENE_BY_ID[data.cutsceneId] : undefined;
    this.replay = Boolean(data.replay);
    this.nextScene = data.nextScene;
    this.nextData = data.nextData;
    this.remainingCutsceneIds = [...(data.remainingCutsceneIds ?? [])];
    this.video = undefined;
    this.statusText = undefined;
    this.timeText = undefined;
    this.subtitleText = undefined;
    this.progressFill = undefined;
    this.loadWatchdog = undefined;
    this.autoplayWatchdog = undefined;
    this.fallbackTimer = undefined;
    this.finishing = false;
    this.playbackStarted = false;
    this.mutedAutoplayFallback = false;
    this.gameAudioPaused = false;
    this.resumeAudioOnShutdown = true;
    this.keyHandler = undefined;
    this.language = "ko";
  }

  create(): void {
    pauseManagedAudio();
    this.gameAudioPaused = true;
    this.language = getServices().save.getSnapshot().settings.language;
    this.drawFrame();
    this.bindSkipInputs();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    if (!this.definition) {
      this.showFallback("영상 정보를 찾지 못했습니다. 이야기 화면으로 계속합니다.");
      return;
    }
    this.startVideo(this.definition);
  }

  private drawFrame(): void {
    const title = this.definition?.title ?? "항해의 기억";
    this.add.rectangle(W / 2, H / 2, W, H, 0x010407, 1);
    this.add.rectangle(W / 2, 56, W, 112, 0x041016, 0.98).setDepth(100);
    this.add.rectangle(W / 2, 111, W, 2, COLORS.gold, 0.72).setDepth(101);
    this.add.text(34, 34, this.replay ? "항해 회상" : "STORY CUTSCENE", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#75d9d0", letterSpacing: 2,
    }).setDepth(102);
    this.add.text(34, 66, title, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(20)}px`, color: "#f7e7bb",
    }).setDepth(102);
    addButton(this, 620, 58, "SKIP", {
      width: 160,
      height: 54,
      fontSize: 18,
      primary: true,
      accent: COLORS.gold,
      onClick: () => void this.finish(true),
    }).setDepth(2200);

    addPanel(this, 24, 142, 672, 824, COLORS.cyan, 0.99).setDepth(5);
    this.add.rectangle(W / 2, 552, 640, 760, 0x000000, 1).setStrokeStyle(2, 0x264d55, 0.9).setDepth(10);
    const resumeZone = this.add.zone(W / 2, 552, 640, 760).setInteractive({ useHandCursor: true }).setDepth(80);
    resumeZone.on("pointerup", () => {
      if (this.finishing) return;
      if (this.mutedAutoplayFallback) this.enableVideoAudio();
      else if (!this.playbackStarted) this.attemptPlay();
    });

    this.statusText = this.add.text(W / 2, 920, "전체 에피소드를 불러오는 중…", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: "#b7d5d0", align: "center",
      wordWrap: { width: 590 },
    }).setOrigin(0.5).setDepth(120);

    const subtitleBackdrop = this.add.rectangle(W / 2, 978, 640, 72, 0x010407, 0.96)
      .setStrokeStyle(1, 0x264d55, 0.72)
      .setDepth(126)
      .setVisible(true);
    this.subtitleText = this.add.text(W / 2, 978, "", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(20)}px`,
      color: "#fff4cf",
      align: "center",
      lineSpacing: 3,
      stroke: "#000000",
      strokeThickness: 5,
      wordWrap: { width: 610 },
    }).setOrigin(0.5).setDepth(127).setVisible(true);
    subtitleBackdrop.setData("localizedSubtitle", true);

    const progressBackground = this.add.graphics().setDepth(120);
    progressBackground.fillStyle(0x152b31, 1).fillRoundedRect(58, 1026, 604, 12, 6);
    this.progressFill = this.add.graphics().setDepth(121);
    this.timeText = this.add.text(W / 2, 1068, "00:00 / --:--", {
      fontFamily: "Consolas, monospace", fontStyle: "bold", fontSize: `${uiTextSize(15)}px`, color: "#9fc9c3",
    }).setOrigin(0.5).setDepth(121);
    this.add.text(W / 2, 1160, "전체 에피소드 재생 · 언제든 SKIP으로 이야기 흐름을 계속할 수 있습니다", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: "#718e8b", align: "center",
      wordWrap: { width: 620 },
    }).setOrigin(0.5).setDepth(120);
  }

  private startVideo(definition: CutsceneDefinition): void {
    if (!definition.enabled || definition.status !== "ready" || !definition.source) {
      this.showFallback("이 에피소드 영상은 아직 준비 중입니다.");
      return;
    }
    const video = this.add.video(W / 2, 552).setDepth(40);
    this.video = video;
    video.once("metadata", () => { this.fitVideo(); this.applyVideoVolume(); });
    video.once("created", () => { this.fitVideo(); this.applyVideoVolume(); });
    video.on("playing", () => this.onPlaying());
    video.once("complete", () => void this.finish(true));
    video.once("locked", () => this.onAutoplayLocked());
    video.once("error", () => this.showFallback("영상을 불러오지 못했습니다. 이야기 화면으로 계속합니다."));
    video.once("unsupported", () => this.showFallback("이 기기에서 지원하지 않는 영상 형식입니다."));
    video.loadURL(definition.source, false);
    this.applyVideoVolume();
    video.play(false);

    this.loadWatchdog = this.time.delayedCall(10_000, () => {
      if (!this.playbackStarted) this.showFallback("영상 로딩 시간이 초과되었습니다. 이야기 화면으로 계속합니다.");
    });
    this.time.addEvent({ delay: 250, loop: true, callback: () => this.updateProgress() });
  }

  private fitVideo(): void {
    const element = this.video?.video;
    if (!element || element.videoWidth <= 0 || element.videoHeight <= 0 || !this.video) return;
    const scale = Math.min(640 / element.videoWidth, 760 / element.videoHeight);
    this.video.setDisplaySize(element.videoWidth * scale, element.videoHeight * scale);
  }

  private attemptPlay(): void {
    if (!this.video || this.finishing) return;
    this.autoplayWatchdog?.remove(false);
    this.autoplayWatchdog = undefined;
    this.beginMutedAutoplayFallback();
  }

  private beginMutedAutoplayFallback(): void {
    if (!this.video || this.finishing) return;
    this.mutedAutoplayFallback = true;
    this.video.setMute(true);
    this.statusText?.setText("브라우저 정책으로 무음 재생 중 · 화면을 누르면 소리가 켜집니다");
    // Phaser keeps `_playCalled` true after an autoplay rejection, so a second
    // `play()` becomes a no-op. A muted retry is allowed by strict webviews;
    // Phaser's normal success handler then clears the lock and installs events.
    this.video.createPlayPromise(false);
  }

  private enableVideoAudio(): void {
    if (!this.video) return;
    this.mutedAutoplayFallback = false;
    this.video.setMute(false);
    this.applyVideoVolume();
    this.statusText?.setText("");
  }

  private onPlaying(): void {
    if (this.playbackStarted) return;
    this.playbackStarted = true;
    this.loadWatchdog?.remove(false);
    this.autoplayWatchdog?.remove(false);
    this.statusText?.setText(this.mutedAutoplayFallback
      ? "브라우저 정책으로 무음 재생 중 · 화면을 누르면 소리가 켜집니다"
      : "");
    this.fitVideo();
    this.applyVideoVolume();
  }

  private applyVideoVolume(): void {
    if (!this.video) return;
    const settings = getServices().save.getSnapshot().settings;
    this.video.setVolume(Phaser.Math.Clamp(settings.masterVolume * settings.musicVolume, 0, 1));
  }

  private onAutoplayLocked(): void {
    if (this.finishing) return;
    this.loadWatchdog?.remove(false);
    this.loadWatchdog = undefined;
    this.beginMutedAutoplayFallback();
    this.autoplayWatchdog?.remove(false);
    this.autoplayWatchdog = this.time.delayedCall(30_000, () => {
      if (!this.playbackStarted) this.showFallback("자동 재생을 시작하지 못했습니다. 이야기 화면으로 계속합니다.");
    });
  }

  private updateProgress(): void {
    if (!this.video || this.finishing) return;
    const current = Math.max(0, this.video.getCurrentTime() || 0);
    // Some Chromium webviews advance the media element without forwarding the
    // HTML `playing` event through Phaser. Time advancement is authoritative.
    if (current > 0.01 && !this.playbackStarted) this.onPlaying();
    const mediaDuration = this.video.getDuration();
    const duration = Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : this.definition?.durationSeconds ?? 0;
    const progress = duration > 0 ? Phaser.Math.Clamp(current / duration, 0, 1) : 0;
    this.progressFill?.clear().fillStyle(COLORS.gold, 1).fillRoundedRect(58, 1026, 604 * progress, 12, 6);
    this.timeText?.setText(`${formatTime(current)} / ${duration > 0 ? formatTime(duration) : "--:--"}`);
    this.subtitleText?.setText(this.definition
      ? cutsceneSubtitleAt(this.definition.id, current, this.language)
      : "");
  }

  private showFallback(message: string): void {
    if (this.finishing || this.fallbackTimer) return;
    this.loadWatchdog?.remove(false);
    this.autoplayWatchdog?.remove(false);
    this.statusText?.setText(message);
    // A packaged local MP4 that reaches this path is missing, corrupt, timed
    // out, or unsupported. Mark the optional presentation layer as handled so
    // the canonical story/campaign destination is not delayed on every visit.
    // Manual replay remains available because replay resolution ignores seen.
    this.fallbackTimer = this.time.delayedCall(900, () => void this.finish(true));
  }

  private bindSkipInputs(): void {
    this.keyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "Escape" || event.key === " " || event.key === "Enter") {
        event.preventDefault();
        void this.finish(true);
      }
    };
    this.input.keyboard?.on("keydown", this.keyHandler);
  }

  private async finish(markSeen: boolean): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    this.video?.stop();
    if (markSeen && this.definition) {
      try {
        await getServices().save.update((draft) => markCutsceneSeen(draft, this.definition!.id));
      } catch {
        // Save failure must never trap the player inside a cutscene.
      }
    }
    const nextCutsceneId = this.remainingCutsceneIds.shift();
    if (nextCutsceneId && CUTSCENE_BY_ID[nextCutsceneId]) {
      this.resumeAudioOnShutdown = false;
      fadeTo(this, "Cutscene", {
        cutsceneId: nextCutsceneId,
        remainingCutsceneIds: this.remainingCutsceneIds,
        nextScene: this.nextScene,
        nextData: this.nextData,
      });
      return;
    }
    const destination = this.definition
      ? resolveCutsceneNext(this.definition, { nextScene: this.nextScene, nextData: this.nextData })
      : { sceneKey: this.nextScene ?? "Harbor", ...(this.nextData ? { data: this.nextData } : {}) };
    fadeTo(this, destination.sceneKey, destination.data as Record<string, unknown> | undefined);
  }

  private cleanup(): void {
    if (this.keyHandler) this.input.keyboard?.off("keydown", this.keyHandler);
    this.video?.stop();
    if (this.gameAudioPaused && this.resumeAudioOnShutdown) resumeManagedAudio();
    this.gameAudioPaused = false;
  }
}

function formatTime(value: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
