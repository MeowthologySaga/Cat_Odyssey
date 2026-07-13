import Phaser from "phaser";
import { ROUTES, STAGE_BY_ID, type RouteDefinition } from "../data";
import { getServices } from "../core/services";
import { formatFirstClearPreview, formatMaterialRewards, getStageRewardPreview } from "../core/meta";
import { MAP_FALLBACK_TEXTURE_KEY, resolveRouteMapTexture } from "../assets/runtimeAssetCatalog";
import { queueImageAssets, routeSelectionImageAssets } from "../assets/assetStreaming";
import {
  addAtmosphere,
  addButton,
  addFocusableHitArea,
  addPanel,
  addTitle,
  addToast,
  addTopBar,
  COLORS,
  ensureUiFocus,
  fadeInScene,
  fadeTo,
  H,
  uiTextSize,
  W,
} from "../ui/gameUi";
import { playBgm, stageBgmKey } from "../audio/AudioDirector";
import { findPendingCrewJoin, hasSeenRouteStory, resolveRoutePreludeDestination } from "../core/uxFlow";
import { lockedStageMessage, nextStarReplayTarget, stageStarConditions, stageStarsText } from "./routePresentation";

interface RouteSceneData { routeId?: string }

export class RouteScene extends Phaser.Scene {
  private routeIndex = 0;
  private selectedStageId = "";

  constructor() { super("Route"); }

  init(data: RouteSceneData): void {
    const index = ROUTES.findIndex((route) => route.id === data.routeId);
    this.routeIndex = index >= 0 ? index : 0;
  }

  preload(): void {
    queueImageAssets(this, routeSelectionImageAssets(), "대해도를 펼치는 중");
  }

  create(): void {
    playBgm(this, stageBgmKey(ROUTES[this.routeIndex]!.id, false));
    const pendingCrew = findPendingCrewJoin(getServices().save.getSnapshot());
    if (pendingCrew) {
      this.scene.start("Story", { kind: "crew", heroId: pendingCrew.heroId, returnScene: "Route", returnData: { routeId: ROUTES[this.routeIndex]!.id } });
      return;
    }
    this.renderRoute();
    fadeInScene(this);
  }

  private renderRoute(): void {
    this.children.removeAll(true);
    const route = ROUTES[this.routeIndex]!;
    playBgm(this, stageBgmKey(route.id, false));
    const save = getServices().save.getSnapshot();
    const routeUnlocked = save.progress.unlockedRouteIds.includes(route.id) || route.order === 1;
    const storyReplayUnlocked = routeUnlocked && hasSeenRouteStory(save, route.id);
    const texture = resolveRouteMapTexture(this.textures, route.id);
    const background = this.add.image(W / 2, H / 2, texture).setDisplaySize(W, H).setAlpha(0.62);
    if (texture === MAP_FALLBACK_TEXTURE_KEY) background.setTint(this.routeTint(route.order));
    this.add.rectangle(W / 2, H / 2, W, H, 0x031017, 0.32);
    addAtmosphere(this, this.routeTint(route.order), 18);
    addTopBar(this, "대해도", () => fadeTo(this, "Harbor"));

    for (let i = 0; i < ROUTES.length; i += 1) {
      this.add.circle(138 + i * 49, 118, i === this.routeIndex ? 8 : 4, i === this.routeIndex ? COLORS.gold : 0x67817f, 1);
    }
    this.add.text(42, 146, `항로 ${String(route.order).padStart(2, "0")}  ·  ${route.coreRoute ? "핵심 항로" : "모험 항로"}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(15)}px`, color: route.coreRoute ? "#f0c66b" : "#78d9d1",
    });
    addTitle(this, route.name, 192, 30);
    this.add.text(W / 2, 230, this.mechanicLabel(route.signatureMechanic), {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, color: "#b3cfca",
    }).setOrigin(0.5);
    addButton(this, W / 2, 272, storyReplayUnlocked ? "항로 이야기 다시 보기" : "항로 이야기 미해금", {
      width: 290, height: 48, fontSize: 14, accent: 0x66888e,
      enabled: storyReplayUnlocked,
      focusKey: `route-story-${route.id}`,
      subtitle: storyReplayUnlocked ? undefined : routeUnlocked ? "첫 출항 시 이야기가 열립니다" : "항로를 먼저 해금하세요",
      onClick: () => fadeTo(this, "Story", { kind: "route", routeId: route.id, replay: true, returnScene: "Route", returnData: { routeId: route.id } }),
    });

    this.add.text(36, 194, "‹", { fontFamily: "Georgia, serif", fontSize: `${uiTextSize(58)}px`, color: this.routeIndex > 0 ? "#f7e7bb" : "#39484a" }).setOrigin(0.5);
    this.add.text(684, 194, "›", { fontFamily: "Georgia, serif", fontSize: `${uiTextSize(58)}px`, color: this.routeIndex < ROUTES.length - 1 ? "#f7e7bb" : "#39484a" }).setOrigin(0.5);
    if (this.routeIndex > 0) {
      addFocusableHitArea(this, 36, 194, 64, 80, {
        focusKey: "route-previous",
        onActivate: () => { this.routeIndex -= 1; this.renderRoute(); },
      });
    }
    if (this.routeIndex < ROUTES.length - 1) {
      addFocusableHitArea(this, 684, 194, 64, 80, {
        focusKey: "route-next",
        onActivate: () => { this.routeIndex += 1; this.renderRoute(); },
      });
    }

    const firstAvailable = route.stageIds.find((id, i) => this.isStageAvailable(route, i, save.progress.completedStageIds, routeUnlocked));
    const latest = [...route.stageIds].reverse().find((id, i) => {
      const actualIndex = route.stageIds.length - 1 - i;
      return this.isStageAvailable(route, actualIndex, save.progress.completedStageIds, routeUnlocked) && !save.progress.completedStageIds.includes(id);
    });
    const selectedIndex = route.stageIds.indexOf(this.selectedStageId);
    const selectedStillAvailable = selectedIndex >= 0
      && this.isStageAvailable(route, selectedIndex, save.progress.completedStageIds, routeUnlocked);
    if (!selectedStillAvailable) this.selectedStageId = latest ?? firstAvailable ?? route.stageIds[0]!;
    this.drawSeaPath(route, routeUnlocked);

    if (!routeUnlocked) {
      addPanel(this, 40, 864, 640, 214, COLORS.red, 0.92);
      this.add.text(W / 2, 930, "항로 봉인", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(23)}px`, color: "#efb0a4" }).setOrigin(0.5);
      this.add.text(W / 2, 982, "이전 항로의 수호자를 쓰러뜨리면 해도가 열린다", { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: "#bba9a1" }).setOrigin(0.5);
    } else {
      this.drawRewardPreview(this.selectedStageId);
    }
    const stage = STAGE_BY_ID[this.selectedStageId]!;
    const bestStars = save.progress.stageStars[this.selectedStageId] ?? 0;
    addButton(this, W / 2, 1168, routeUnlocked ? `${stage.name} ${bestStars > 0 ? "재도전" : "출항"}` : "잠긴 항로", {
      width: 430, height: 78, icon: routeUnlocked ? "⚔" : "◆", enabled: routeUnlocked, primary: true,
      focusKey: `route-launch-${this.selectedStageId}`,
      subtitle: routeUnlocked ? nextStarReplayTarget(bestStars, stage) : undefined,
      onClick: () => this.launchStage(route.id, this.selectedStageId),
    });
    ensureUiFocus(this, [
      `route-stage-${this.selectedStageId}`,
      this.routeIndex > 0 ? "route-previous" : "route-next",
      `route-story-${route.id}`,
      `route-launch-${this.selectedStageId}`,
    ]);
  }

  private drawSeaPath(route: RouteDefinition, routeUnlocked: boolean): void {
    const save = getServices().save.getSnapshot();
    const step = route.stageIds.length >= 5 ? 116 : 145;
    const points = route.stageIds.map((_, index) => ({ x: index % 2 === 0 ? 242 : 478, y: 310 + index * step }));
    const g = this.add.graphics();
    g.lineStyle(8, 0x06141c, 0.7).beginPath().moveTo(points[0]!.x, points[0]!.y);
    for (const point of points.slice(1)) g.lineTo(point.x, point.y);
    g.strokePath();
    g.lineStyle(3, 0xb9914e, 0.75).beginPath().moveTo(points[0]!.x, points[0]!.y);
    for (const point of points.slice(1)) g.lineTo(point.x, point.y);
    g.strokePath();

    route.stageIds.forEach((stageId, index) => {
      const point = points[index]!;
      const done = save.progress.completedStageIds.includes(stageId);
      const available = this.isStageAvailable(route, index, save.progress.completedStageIds, routeUnlocked);
      const boss = index === route.stageIds.length - 1;
      const selected = this.selectedStageId === stageId;
      const stars = save.progress.stageStars[stageId] ?? 0;
      this.add.circle(point.x, point.y, boss ? 44 : 34, selected ? 0x31536a : done ? 0x2f756b : available ? 0x143b46 : 0x172326, 1)
        .setStrokeStyle(selected ? 6 : boss ? 5 : 3, selected ? 0x87edf0 : done ? 0x9fe1c8 : available ? COLORS.gold : 0x4f5a59, 1);
      this.add.text(point.x, point.y - 6, available ? (boss ? "♛" : String(index + 1)) : "◆", {
        fontFamily: "Georgia, Malgun Gothic, serif", fontStyle: "bold", fontSize: `${uiTextSize(boss ? 28 : 22)}px`, color: done ? "#d4f1d5" : available ? "#f7e7bb" : "#566260",
      }).setOrigin(0.5);
      this.add.text(point.x, point.y + 25, stageStarsText(stars), { fontFamily: "Georgia, serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: stars > 0 ? "#f2ca63" : "#536365" }).setOrigin(0.5);
      this.add.text(point.x, point.y + 61, STAGE_BY_ID[stageId]!.name, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: available ? "#e1e7da" : "#73807d", backgroundColor: "#06141cdd", padding: { x: 8, y: 4 } }).setOrigin(0.5);
      addFocusableHitArea(this, point.x, point.y, boss ? 106 : 90, 104, {
        focusKey: `route-stage-${stageId}`,
        focusable: available,
        useHandCursor: true,
        onActivate: () => {
          if (!available) {
            const previousStageId = route.stageIds[index - 1];
            addToast(
              this,
              lockedStageMessage(route.order, routeUnlocked, previousStageId ? STAGE_BY_ID[previousStageId]?.name : undefined),
              COLORS.red,
            );
            return;
          }
          this.selectedStageId = stageId;
          this.renderRoute();
        },
      });
    });
  }

  private drawRewardPreview(stageId: string): void {
    const stage = STAGE_BY_ID[stageId]!;
    const preview = getStageRewardPreview(getServices().save.getSnapshot(), stageId)!;
    addPanel(this, 40, 864, 640, 230, stage.boss ? COLORS.red : COLORS.gold, 0.96);
    const bestStars = getServices().save.getSnapshot().progress.stageStars[stageId] ?? 0;
    this.add.text(68, 888, `${stage.name}  ·  권장 전투력 ${stage.recommendedPower}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(18)}px`, color: "#f7e7bb",
    });
    this.add.text(68, 922, `목표 · ${this.objectiveLabel(stage.objective.type, stage.objective.requiredCount)}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, color: "#b8d5d0",
    });
    this.add.text(68, 956, `최고 기록  ${stageStarsText(bestStars)}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(17)}px`, color: "#f0ca68",
    });
    this.add.text(68, 990, `반복 · 골드 ${preview.repeatable.gold.toLocaleString()} · XP ${preview.repeatable.heroXp}\n${formatMaterialRewards(preview.repeatable.materials)}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, lineSpacing: 6, color: "#d6e4dd", wordWrap: { width: 300 },
    });
    this.add.text(386, 954, stageStarConditions(stage).join("\n"), {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, lineSpacing: 7, color: "#d9e2d8", wordWrap: { width: 272 },
    });
    this.add.text(386, 1052, preview.firstClear.claimed ? "첫 돌파 보상 · 수령 완료" : `첫 돌파 · ${formatFirstClearPreview(preview).replace("\n", " · ")}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(14)}px`, color: preview.firstClear.claimed ? "#78918e" : "#e7c36f", wordWrap: { width: 270 },
    });
  }

  private objectiveLabel(type: string, required?: number): string {
    const label: Readonly<Record<string, string>> = {
      "defeat-all": "모든 적 격파", "break-parts": "약점 부위 파괴", assemble: "뗏목 부품 조립", survive: "제한 턴 생존",
      protect: "대상 보호·구출", seal: "봉인 완성", escape: "탈출 지점 도달",
    };
    return `${label[type] ?? type}${required && required > 1 ? ` ${required}회` : ""}`;
  }

  private isStageAvailable(route: RouteDefinition, index: number, completed: readonly string[], routeUnlocked: boolean): boolean {
    return routeUnlocked && (index === 0 || completed.includes(route.stageIds[index - 1]!));
  }

  private launchStage(routeId: string, stageId: string): void {
    const save = getServices().save.getSnapshot();
    const destination = resolveRoutePreludeDestination(save, routeId, "Party", { stageId });
    fadeTo(this, destination.sceneKey, destination.data);
  }

  private routeTint(order: number): number {
    return [0x4f9ea0, 0xa578a3, 0x9b6c49, 0x80a8c5, 0x8d6094, 0x58648a, 0x4f87a0, 0x4e6171, 0xd39b54, 0x6a9977][order - 1] ?? 0x6f9993;
  }

  private mechanicLabel(mechanic: string): string {
    return ({
      "moving-bumper-and-wave-current": "이동 범퍼 · 파도 해류",
      "slow-field-and-rescue": "감속장 · 동료 구출",
      "breakable-rock-and-rear-weakpoint": "파괴 바위 · 후방 약점",
      "wind-vector-and-moving-gates": "바람 벡터 · 이동 관문",
      "one-way-mirror-and-transformation": "일방 반사벽 · 변신",
      "paired-portals-and-spirit-walls": "쌍방 차원문 · 영체 벽",
      "rotating-sound-wave-bumper": "회전 음파 · 범퍼",
      "whirlpool-suction-and-multipart-break": "소용돌이 · 다중 부위 파괴",
      "forbidden-target-and-lightning-rod": "접촉 금지 대상 · 피뢰침",
      "directional-shields-and-twelve-axe-line": "방향 방패 · 열두 도끼",
    } as Readonly<Record<string, string>>)[mechanic] ?? mechanic.replaceAll("-", " · ");
  }
}
