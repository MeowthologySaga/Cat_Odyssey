import Phaser from "phaser";
import { addAtmosphere, addButton, addTitle, COLORS, fadeInScene, fadeTo, H, uiTextSize, W } from "../ui/gameUi";
import { playBgm } from "../audio/AudioDirector";
import { getServices } from "../core/services";
import { hasCompletedOnboarding, resolveTitleVoyageDestination } from "../core/uxFlow";
import { partyImageAssets, queueImageAssets } from "../assets/assetStreaming";
import { HERO_BY_ID } from "../data";
import { HERO_FALLBACK_TEXTURE_KEY, resolveHeroTexture } from "../assets/runtimeAssetCatalog";
import {
  readPendingCampaignVictorySettlement,
  readPendingEndgameVictorySettlement,
  readRestorableBattleRescue,
  readRestorableCampaignBattle,
} from "../core/meta";

export class TitleScene extends Phaser.Scene {
  constructor() { super("Title"); }

  preload(): void {
    const rescue = readRestorableBattleRescue(getServices().save.getSnapshot());
    queueImageAssets(
      this,
      partyImageAssets(rescue?.rescue.deployedHeroIds ?? ["meow-dysseus"]),
      rescue ? "구조 선원을 불러오는 중" : "귀향의 별을 밝히는 중",
    );
  }

  create(): void {
    const save = getServices().save.getSnapshot();
    const pendingEndgameVictory = readPendingEndgameVictorySettlement(save);
    const pendingVictory = readPendingCampaignVictorySettlement(save);
    const pendingRescue = readRestorableBattleRescue(save);
    const activeBattle = readRestorableCampaignBattle(save);
    const bg = this.add.image(W / 2, H / 2, "arena-cyclops").setDisplaySize(W, H).setTint(0x356772).setAlpha(0.55);
    this.add.rectangle(W / 2, H / 2, W, H, 0x02090d, 0.46);
    this.add.rectangle(W / 2, 1040, W, 500, 0x031017, 0.72);
    addAtmosphere(this, 0xb4ffff, 34);

    const halo = this.add.image(W / 2, 430, "glow").setTint(0xe6b85c).setBlendMode(Phaser.BlendModes.ADD).setScale(3.5).setAlpha(0.2);
    if (!save.settings.reducedMotion) this.tweens.add({ targets: halo, alpha: 0.42, scale: 4.2, duration: 2400, yoyo: true, repeat: -1 });
    const heroDefinition = HERO_BY_ID["meow-dysseus"]!;
    const heroTexture = resolveHeroTexture(this.textures, heroDefinition);
    const hero = this.add.image(W / 2, 470, heroTexture)
      .setDisplaySize(heroTexture === HERO_FALLBACK_TEXTURE_KEY ? 260 : 410, heroTexture === HERO_FALLBACK_TEXTURE_KEY ? 260 : 410)
      .setAngle(-7);
    if (heroTexture === HERO_FALLBACK_TEXTURE_KEY) hero.setTint(0x78dce2);
    if (!save.settings.reducedMotion) this.tweens.add({ targets: hero, y: 454, angle: -3, duration: 1800, ease: "Sine.InOut", yoyo: true, repeat: -1 });

    this.add.text(W / 2, 118, "MEOWTHOLOGY SAGA", {
      fontFamily: "Georgia, serif", fontSize: `${uiTextSize(19)}px`, letterSpacing: 8, color: "#8cd6d2",
    }).setOrigin(0.5);
    addTitle(this, "고양이 오디세이", 760, 50);
    this.add.text(W / 2, 812, "별과 파도 사이, 집으로 향하는 위대한 항해", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(17)}px`, color: "#a9cbc5",
    }).setOrigin(0.5);
    const divider = this.add.graphics().lineStyle(2, COLORS.gold, 0.7);
    divider.lineBetween(180, 850, 540, 850);
    if (pendingEndgameVictory) {
      const modeLabel = pendingEndgameVictory.mode === "oracleTower"
        ? "아포나의 신탁탑"
        : pendingEndgameVictory.mode === "stormRoute"
          ? "포세이돈의 폭풍 항로"
          : `스킬라 토벌 ${Number(pendingEndgameVictory.scyllaPhaseIndex ?? 0) + 1}페이즈`;
      this.add.text(W / 2, 874, `${modeLabel} 승리 보상 정산이 기다리고 있습니다`, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#f2cf78",
      }).setOrigin(0.5);
    } else if (pendingVictory) {
      this.add.text(W / 2, 874, "승리한 전투의 보상 정산이 기다리고 있습니다", {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#f2cf78",
      }).setOrigin(0.5);
    } else if (pendingRescue) {
      this.add.text(W / 2, 874, `결제한 구조 전투가 기다립니다 · ${pendingRescue.rescue.stageId}`, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#f2cf78",
      }).setOrigin(0.5);
    } else if (activeBattle) {
      this.add.text(W / 2, 874, "저장된 전투가 있습니다 · 안전한 턴 경계부터 계속", {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#8fe2d7",
      }).setOrigin(0.5);
    }
    addButton(this, W / 2, 930, hasCompletedOnboarding(save) ? "항해 계속" : "첫 항해 시작", {
      width: 380, height: 86, icon: "⚓", primary: true, subtitle: hasCompletedOnboarding(save) ? "저장된 항로와 전투 기록을 불러옵니다" : "두 가지 조작만 익히고 실제 항로로 출항합니다", onClick: () => this.startVoyage(),
    });
    addButton(this, W / 2, 1030, "설정 · 도움말", {
      width: 300, height: 62, icon: "⚙", fontSize: 17, accent: 0x66888e, onClick: () => fadeTo(this, "Settings", { returnScene: "Title" }),
    });
    this.add.text(W / 2, 1110, "고양이를 당겨 튕기고 · 벽을 읽고 · 약점을 노려라", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, color: "#82a5a2",
    }).setOrigin(0.5);
    this.add.text(W / 2, 1228, "CAT ODYSSEY  ·  PLAYZONE EDITION", {
      fontFamily: "Georgia, serif", fontSize: `${uiTextSize(12)}px`, letterSpacing: 3, color: "#6c827f",
    }).setOrigin(0.5);
    bg.setInteractive().once("pointerup", () => undefined);
    fadeInScene(this, 360);
  }

  private startVoyage(): void {
    const save = getServices().save.getSnapshot();
    playBgm(this, "bgm-harbor-homeward");
    const destination = resolveTitleVoyageDestination(save);
    fadeTo(this, destination.sceneKey, destination.data);
  }
}
