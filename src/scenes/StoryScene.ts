import Phaser from "phaser";
import { HERO_BY_ID } from "../data";
import { resolveHeroTexture, HERO_FALLBACK_TEXTURE_KEY } from "../assets/runtimeAssetCatalog";
import { partyImageAssets, queueImageAssets } from "../assets/assetStreaming";
import { getServices } from "../core/services";
import { withDeadline } from "../core/asyncDeadline";
import { persistStoryProgress, STORY_PROGRESS_SAVE_TIMEOUT_MS } from "../core/storyProgress";
import { crewJoinContent, findPendingCrewJoin, markCrewJoinSeen, markRouteStorySeen, routeStoryContent } from "../core/uxFlow";
import { addButton, addPanel, addTitle, bindBackNavigation, fadeInScene, fadeTo, H, uiTextSize, W } from "../ui/gameUi";

interface StorySceneData {
  kind?: "route" | "crew";
  routeId?: string;
  heroId?: string;
  replay?: boolean;
  returnScene?: string;
  returnData?: object;
}

export class StoryScene extends Phaser.Scene {
  private kind: "route" | "crew" = "route";
  private routeId = "route-01-ogygia";
  private heroId = "meow-dysseus";
  private replay = false;
  private returnScene = "Harbor";
  private returnData?: object;
  private closing = false;

  constructor() { super("Story"); }

  init(data: StorySceneData): void {
    this.kind = data.kind ?? "route";
    this.routeId = data.routeId ?? "route-01-ogygia";
    this.heroId = data.heroId ?? "meow-dysseus";
    this.replay = Boolean(data.replay);
    this.returnScene = data.returnScene ?? "Harbor";
    this.returnData = data.returnData;
    this.closing = false;
  }

  preload(): void {
    if (this.kind === "crew") queueImageAssets(this, partyImageAssets([this.heroId]), "동료의 기억을 불러오는 중");
  }

  create(): void {
    const content = this.kind === "crew" ? crewJoinContent(this.heroId) : routeStoryContent(this.routeId);
    this.add.image(W / 2, H / 2, "arena-cyclops").setDisplaySize(W, H).setTint(this.kind === "crew" ? 0x6d7351 : 0x315d68).setAlpha(0.58);
    this.add.rectangle(W / 2, H / 2, W, H, 0x02070c, 0.62);
    this.add.rectangle(W / 2, 110, W, 220, 0x031017, 0.78);
    this.add.text(W / 2, 88, content.eyebrow, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(17)}px`, color: "#8fded5", letterSpacing: 2,
    }).setOrigin(0.5);
    addPanel(this, 50, 210, 620, 760, content.accent, 0.97);

    if (this.kind === "crew") this.drawCrewPortrait();
    else this.drawRouteEmblem(content.accent);

    addTitle(this, content.title, this.kind === "crew" ? 620 : 565, 38);
    this.add.text(W / 2, this.kind === "crew" ? 690 : 640, content.body.join("\n\n"), {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(19)}px`, lineSpacing: 12, color: "#d7e4dc", align: "center", wordWrap: { width: 540 },
    }).setOrigin(0.5);
    this.add.text(W / 2, 902, this.kind === "crew" ? "편성 화면에서 새로운 동료의 능력과 우정 스킬을 확인할 수 있습니다." : "이 항로의 기믹은 스테이지 선택 화면과 전투 목표에서 다시 확인할 수 있습니다.", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, color: "#8ea9a5", align: "center", wordWrap: { width: 540 },
    }).setOrigin(0.5);
    addButton(this, W / 2, 1062, this.kind === "crew" ? "동료 맞이하기" : "항로 펼치기", {
      width: 390, height: 78, icon: this.kind === "crew" ? "✦" : "⚓", primary: true, onClick: () => void this.close(),
    });
    addButton(this, W / 2, 1156, this.replay ? "회상 닫기" : "연출 건너뛰기", {
      width: 300, height: 58, fontSize: 16, accent: 0x5c777d, onClick: () => void this.close(),
    });
    bindBackNavigation(this, () => void this.close());
    fadeInScene(this);
  }

  private drawCrewPortrait(): void {
    const hero = HERO_BY_ID[this.heroId];
    if (!hero) return;
    const texture = resolveHeroTexture(this.textures, hero);
    const glow = this.add.image(W / 2, 405, "glow").setTint(0xe6c66d).setScale(3.3).setAlpha(0.28).setBlendMode(Phaser.BlendModes.ADD);
    const image = this.add.image(W / 2, 420, texture).setDisplaySize(340, 340);
    if (texture === HERO_FALLBACK_TEXTURE_KEY) image.setTint(0xd8a94a);
    if (!getServices().save.getSnapshot().settings.reducedMotion) {
      this.tweens.add({ targets: [image, glow], y: "-=12", duration: 1500, ease: "Sine.InOut", yoyo: true, repeat: -1 });
    }
  }

  private drawRouteEmblem(accent: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x0b2832, 0.95).lineStyle(8, accent, 0.9).fillCircle(W / 2, 385, 130).strokeCircle(W / 2, 385, 130);
    g.lineStyle(4, 0xf2db91, 0.75).strokeCircle(W / 2, 385, 96);
    for (let i = 0; i < 8; i += 1) {
      const angle = Phaser.Math.DegToRad(i * 45);
      g.lineBetween(W / 2 + Math.cos(angle) * 38, 385 + Math.sin(angle) * 38, W / 2 + Math.cos(angle) * 112, 385 + Math.sin(angle) * 112);
    }
    this.add.text(W / 2, 385, "✦", { fontFamily: "Georgia, serif", fontSize: `${uiTextSize(72)}px`, color: "#f4d27d" }).setOrigin(0.5);
  }

  private async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const services = getServices();
    const result = await persistStoryProgress(services.save, (draft) => {
      if (this.kind === "crew") markCrewJoinSeen(draft, this.heroId);
      else markRouteStorySeen(draft, this.routeId);
    });
    const save = result.save;
    if (!result.persisted) {
      try {
        services.host.ui.toast("저장 연결이 지연되었습니다. 항해는 계속하며 자동으로 다시 저장합니다.");
      } catch {
        // Host UI feedback is optional and must never become another navigation gate.
      }
      try {
        void withDeadline(
          services.save.flushForUnload(),
          STORY_PROGRESS_SAVE_TIMEOUT_MS,
          "Story progress retry",
        ).catch(() => undefined);
      } catch {
        // The in-memory marker still prevents this story card from looping this session.
      }
    }
    if (this.kind === "crew" && !this.replay) {
      const nextCrew = findPendingCrewJoin(save);
      if (nextCrew) {
        fadeTo(this, "Story", {
          kind: "crew",
          heroId: nextCrew.heroId,
          returnScene: this.returnScene,
          returnData: this.returnData,
        });
        return;
      }
    }
    fadeTo(this, this.returnScene, this.returnData);
  }
}
