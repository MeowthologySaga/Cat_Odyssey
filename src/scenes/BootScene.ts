import Phaser from "phaser";
import { CORE_IMAGE_ASSETS, queueImageAssets } from "../assets/assetStreaming";
import { assetUrl } from "../assets/assetUrl";
import { BGM_ASSETS, BOOT_BGM_KEYS, SFX_ASSETS } from "../audio/audioAssets";
import { fadeInScene, uiTextSize } from "../ui/gameUi";
import { getServices } from "../core/services";

export class BootScene extends Phaser.Scene {
  constructor() { super("Boot"); }

  preload(): void {
    queueImageAssets(this, CORE_IMAGE_ASSETS);
    // Keep startup light: only the title/hub cue is boot-critical. Route and
    // boss BGM is streamed on first use by AudioDirector.
    for (const key of BOOT_BGM_KEYS) this.load.audio(key, assetUrl(BGM_ASSETS[key]));
    for (const [key, source] of Object.entries(SFX_ASSETS)) this.load.audio(key, assetUrl(source));
    this.load.spritesheet("fx-ricochet-impact-sheet", assetUrl("assets/art/fx/ricochet-impact.webp"), {
      frameWidth: 128,
      frameHeight: 128,
    });
    this.load.spritesheet("fx-shield-break-sheet", assetUrl("assets/art/fx/shield-break.webp"), {
      frameWidth: 128,
      frameHeight: 128,
    });
    this.load.spritesheet("fx-friendship-link-sheet", assetUrl("assets/art/fx/friendship-link.webp"), {
      frameWidth: 128,
      frameHeight: 128,
    });
    this.load.on("progress", (progress: number) => {
      const bar = this.children.getByName("loadbar") as Phaser.GameObjects.Graphics | null;
      bar?.clear().fillStyle(0xd8a94a, 1).fillRoundedRect(160, 660, 400 * progress, 8, 4);
    });
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      const message = this.children.getByName("loadstatus") as Phaser.GameObjects.Text | null;
      message?.setText(`일부 항해 자료를 불러오지 못했습니다 · ${file.key}\n기본 그림으로 안전하게 계속합니다`);
    });
    this.add.text(360, 590, "별빛 항로를 펼치는 중", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(22)}px`, color: "#f7e7bb",
    }).setOrigin(0.5).setName("loadstatus");
    this.add.graphics().setName("loadbar");
  }

  create(): void {
    this.makeProceduralTextures();
    this.makeCombatAnimations();
    fadeInScene(this, 320);
    this.scene.start(getServices().debugMode ? "Debug" : "Title");
  }

  private makeCombatAnimations(): void {
    if (!this.anims.exists("fx-ricochet-impact")) {
      this.anims.create({
        key: "fx-ricochet-impact",
        frames: this.anims.generateFrameNumbers("fx-ricochet-impact-sheet", { start: 0, end: 3 }),
        frameRate: 17,
        repeat: 0,
        hideOnComplete: true,
      });
    }
    if (!this.anims.exists("fx-shield-break")) {
      this.anims.create({
        key: "fx-shield-break",
        frames: this.anims.generateFrameNumbers("fx-shield-break-sheet", { start: 0, end: 3 }),
        frameRate: 14,
        repeat: 0,
        hideOnComplete: true,
      });
    }
    if (!this.anims.exists("fx-friendship-link")) {
      this.anims.create({
        key: "fx-friendship-link",
        frames: this.anims.generateFrameNumbers("fx-friendship-link-sheet", { start: 0, end: 3 }),
        frameRate: 15,
        repeat: 0,
        hideOnComplete: true,
      });
    }
  }

  private makeProceduralTextures(): void {
    const p = this.make.graphics({ x: 0, y: 0 }, false);
    p.fillStyle(0xffffff, 1).fillCircle(8, 8, 8).generateTexture("particle", 16, 16).clear();
    p.fillStyle(0xffffff, 1).fillCircle(64, 64, 64).generateTexture("glow", 128, 128).clear();
    p.fillStyle(0xe6c076, 1).lineStyle(5, 0x4c261c, 1).fillCircle(42, 42, 38).strokeCircle(42, 42, 38);
    p.fillStyle(0x301b18, 1).fillTriangle(18, 20, 28, 2, 36, 23).fillTriangle(48, 23, 57, 2, 67, 20);
    p.fillStyle(0x122228, 1).fillCircle(30, 38, 5).fillCircle(54, 38, 5);
    p.generateTexture("cat-token", 84, 84).clear();
    p.fillStyle(0x8a5032, 1).lineStyle(4, 0x3a1d18, 1).fillCircle(44, 44, 40).strokeCircle(44, 44, 40);
    p.fillStyle(0x251719, 1).fillTriangle(18, 22, 29, 3, 38, 24).fillTriangle(50, 24, 60, 3, 70, 22);
    p.fillStyle(0xe9c46f, 1).fillCircle(33, 41, 5).fillCircle(56, 41, 5);
    p.generateTexture("enemy-token", 88, 88).destroy();
  }
}
