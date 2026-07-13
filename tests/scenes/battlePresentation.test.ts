import { describe, expect, it } from "vitest";
import {
  BATTLE_HUD_LAYOUT,
  battleEffectLabel,
  battleTurnText,
  buildLimitedTrajectoryPreview,
  canStartAimFromActor,
  compactBattleHudLine,
  effectiveEnemyPresentationRadius,
  effectiveHeroPresentationRadius,
  effectivePreviewReflections,
  enemyPresentationDelay,
  enemyIntentBadgeText,
  isBattleArenaPointerY,
  objectiveProgressText,
  placeEnemyIntentBadge,
  projectBattleHudRegions,
  reconcileViewIds,
  resolveAimPull,
  selectBattleStatusEffects,
  shouldShowWallSprite,
  skillEffectProfile,
} from "../../src/scenes/battlePresentation";

describe("battle presentation", () => {
  it("keeps the enemy presentation tempo contract deterministic", () => {
    expect(enemyPresentationDelay(600, 1)).toBe(600);
    expect(enemyPresentationDelay(600, 1.5)).toBe(400);
    expect(enemyPresentationDelay(600, 2)).toBe(300);
  });

  it("separates skill families into readable colors and impact weights", () => {
    expect(skillEffectProfile("push-wave").family).toBe("damage");
    expect(skillEffectProfile("stun").family).toBe("control");
    expect(skillEffectProfile("temporary-wall").family).toBe("terrain");
    expect(skillEffectProfile("heal").family).toBe("healing");
    expect(skillEffectProfile("ally-launch").family).toBe("mobility");
    expect(skillEffectProfile("projectile-guard").family).toBe("guard");
    expect(skillEffectProfile("push-wave").color).not.toBe(skillEffectProfile("stun").color);
  });

  it("keeps urgent status effects visible and reports the hidden remainder", () => {
    const selected = selectBattleStatusEffects([
      { kind: "speed-up", remainingTurns: 3, appliedTurn: 1 },
      { kind: "regeneration", remainingTurns: 2, appliedTurn: 2 },
      { kind: "sleep-stack", remainingTurns: 3, appliedTurn: 3 },
      { kind: "bind", remainingTurns: 1, appliedTurn: 4 },
      { kind: "stun", remainingTurns: 1, appliedTurn: 5 },
    ], 3);

    expect(selected.visible.map((effect) => effect.kind)).toEqual(["stun", "bind", "sleep-stack"]);
    expect(selected.hiddenCount).toBe(2);
  });

  it("never exposes internal effect identifiers in player-facing labels", () => {
    expect(battleEffectLabel("mirror-trajectory")).toBe("반전 궤적");
    expect(battleEffectLabel("radius-multiplier")).toBe("몸집 변화");
    expect(battleEffectLabel("sleep-stack")).toBe("수면 누적");
    expect(battleEffectLabel("portal-affinity-spirit")).toBe("영체 차원 친화");
    expect(battleEffectLabel("relic-future-effect")).toBe("유물 효과");
    expect(battleEffectLabel("future-internal-id")).toBe("특수 효과");
  });

  it("matches runtime collider radii for stacked growth and enemy shrink effects", () => {
    const effects = [
      { targetId: "hero", kind: "radius-multiplier", value: 0.8, remainingTurns: 2 },
      { targetId: "hero", kind: "radius-multiplier", value: 0.5, remainingTurns: 2 },
      { targetId: "hero", kind: "radius-multiplier", value: 10, remainingTurns: 0 },
      { targetId: "enemy", kind: "shrink-enemy", value: 18, remainingTurns: 2 },
      { targetId: "enemy", kind: "shrink-enemy", value: 35, remainingTurns: 1 },
    ];

    expect(effectiveHeroPresentationRadius(40, "hero", effects)).toBe(18);
    expect(effectiveHeroPresentationRadius(6, "hero", effects)).toBe(4);
    expect(effectiveEnemyPresentationRadius(40, "enemy", effects)).toBe(26);
    expect(effectiveEnemyPresentationRadius(40, "other", effects)).toBe(40);
  });
  it("shows only the initial leg and a short faded first reflection", () => {
    const preview = buildLimitedTrajectoryPreview([
      { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
      { from: { x: 100, y: 0 }, to: { x: 100, y: 500 } },
      { from: { x: 100, y: 500 }, to: { x: 600, y: 500 } },
    ], { initialLength: 300, reflectedLength: 80, spacing: 20 });

    expect(preview.firstBounce).toEqual({ x: 100, y: 0 });
    expect(preview.dots.some((dot) => dot.reflected)).toBe(true);
    expect(Math.max(...preview.dots.map((dot) => dot.y))).toBe(80);
    expect(preview.dots.some((dot) => dot.x > 100)).toBe(false);
  });

  it("does not claim a bounce when the first collision is outside guide range", () => {
    const preview = buildLimitedTrajectoryPreview([
      { from: { x: 0, y: 0 }, to: { x: 900, y: 0 } },
      { from: { x: 900, y: 0 }, to: { x: 900, y: 500 } },
    ], { initialLength: 300 });

    expect(preview.firstBounce).toBeNull();
    expect(preview.dots.every((dot) => !dot.reflected)).toBe(true);
    expect(Math.max(...preview.dots.map((dot) => dot.x))).toBe(300);
  });

  it("continues the direct guide through pass-through contacts without drawing a fake bounce", () => {
    const preview = buildLimitedTrajectoryPreview([
      { from: { x: 0, y: 0 }, to: { x: 80, y: 0 }, bounceAfter: false },
      { from: { x: 80, y: 0 }, to: { x: 180, y: 0 }, bounceAfter: true },
      { from: { x: 180, y: 0 }, to: { x: 180, y: 300 }, bounceAfter: false },
    ], { initialLength: 300, reflectedLength: 60, spacing: 20 });

    expect(preview.firstBounce).toEqual({ x: 180, y: 0 });
    expect(preview.dots.find((dot) => dot.x === 80 && dot.y === 0)?.reflected).toBe(false);
    expect(preview.dots.some((dot) => dot.x === 180 && dot.y === 60 && dot.reflected)).toBe(true);
  });

  it("keeps the direct leg but hides every reflection when reflected guidance is disabled", () => {
    const preview = buildLimitedTrajectoryPreview([
      { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
      { from: { x: 100, y: 0 }, to: { x: 100, y: 180 } },
    ], { visibleReflections: 0, spacing: 20 });

    expect(preview.firstBounce).toBeNull();
    expect(preview.dots.every((dot) => !dot.reflected)).toBe(true);
    expect(Math.max(...preview.dots.map((dot) => dot.x))).toBe(100);
  });

  it("can reveal one extra bounce only when an assist explicitly grants it", () => {
    const preview = buildLimitedTrajectoryPreview([
      { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
      { from: { x: 100, y: 0 }, to: { x: 100, y: 100 } },
      { from: { x: 100, y: 100 }, to: { x: 500, y: 100 } },
      { from: { x: 500, y: 100 }, to: { x: 500, y: 500 } },
    ], { visibleReflections: 2, reflectedLength: 60, spacing: 20 });

    expect(preview.dots.some((dot) => dot.x === 160 && dot.y === 100)).toBe(true);
    expect(preview.dots.some((dot) => dot.x > 160 || dot.y > 100)).toBe(false);
  });

  it("clamps objective progress for a stable HUD", () => {
    expect(objectiveProgressText(-2, 3)).toBe("0 / 3");
    expect(objectiveProgressText(8, 3)).toBe("3 / 3");
    expect(objectiveProgressText(0, 0)).toBe("0 / 1");
  });

  it("extends aim guidance only while an active preview effect exists", () => {
    expect(effectivePreviewReflections(0, [])).toBe(0);
    expect(effectivePreviewReflections(1, [])).toBe(1);
    expect(effectivePreviewReflections(1, [{ kind: "preview-extend", value: 3 }])).toBe(4);
    expect(effectivePreviewReflections(1, [{ kind: "trajectory-perfect", value: 6 }])).toBe(6);
    expect(effectivePreviewReflections(2, [{ kind: "trajectory-perfect", value: 99 }], 6)).toBe(6);
  });

  it("reconciles views against newly spawned and retired runtime ids", () => {
    expect(reconcileViewIds(["old", "kept"], ["kept", "spawn-a", "spawn-b"])).toEqual({
      create: ["spawn-a", "spawn-b"],
      keep: ["kept"],
      remove: ["old"],
    });
  });

  it("hides broken wall sprites unless a broken-state asset was authored", () => {
    expect(shouldShowWallSprite({
      active: true,
      broken: false,
      hasTexture: true,
      hasBrokenVisual: false,
    })).toBe(true);
    expect(shouldShowWallSprite({
      active: true,
      broken: true,
      hasTexture: true,
      hasBrokenVisual: false,
    })).toBe(false);
    expect(shouldShowWallSprite({
      active: true,
      broken: true,
      hasTexture: true,
      hasBrokenVisual: true,
    })).toBe(true);
  });

  it("freezes the compact turn counter while enemy actions are being presented", () => {
    expect(battleTurnText(3, 14, 2)).toBe("적 행동  ·  2턴째");
    expect(battleTurnText(3, 14)).toBe("턴 3 / 14");
  });

  it("keeps enemy intent badges compact and avoids duplicated action wording", () => {
    expect(enemyIntentBadgeText({ behavior: "분열", countdown: 1, danger: true })).toBe("다음 공격 · 분열");
    expect(enemyIntentBadgeText({ behavior: "소환", countdown: 1, danger: true, summon: true })).toBe("소환 준비");
    expect(enemyIntentBadgeText({ behavior: "돌진", countdown: 0, acting: true })).toBe("행동 중 · 돌진");
    expect(enemyIntentBadgeText({ behavior: "사격", countdown: 2 })).toBe("2턴 · 사격");
  });

  it("keeps every persistent battle rail outside the playable arena", () => {
    expect(BATTLE_HUD_LAYOUT.footerTop).toBe(BATTLE_HUD_LAYOUT.arenaBottom);
    const persistentRects = [
      BATTLE_HUD_LAYOUT.turnRail,
      BATTLE_HUD_LAYOUT.objectiveRail,
      BATTLE_HUD_LAYOUT.lowerLeftRail,
      BATTLE_HUD_LAYOUT.lowerRightRail,
    ];
    for (const rect of persistentRects) {
      expect(rect.y).toBeGreaterThanOrEqual(BATTLE_HUD_LAYOUT.arenaBottom);
      expect(rect.y + rect.height).toBeLessThanOrEqual(BATTLE_HUD_LAYOUT.footerBottom);
    }
  });

  it("keeps transient phase and skill banners inside footer rails", () => {
    for (const rect of [
      BATTLE_HUD_LAYOUT.phaseOverlay,
      BATTLE_HUD_LAYOUT.skillOverlay,
      BATTLE_HUD_LAYOUT.coachmarkOverlay,
    ]) {
      expect(rect.y).toBeGreaterThanOrEqual(BATTLE_HUD_LAYOUT.arenaBottom);
      expect(rect.y + rect.height).toBeLessThanOrEqual(BATTLE_HUD_LAYOUT.footerBottom);
    }
  });

  it("keeps the full physical arena interactive without accepting footer input", () => {
    expect(isBattleArenaPointerY(BATTLE_HUD_LAYOUT.arenaTop + 12, 12)).toBe(true);
    expect(isBattleArenaPointerY(BATTLE_HUD_LAYOUT.arenaBottom - 12, 12)).toBe(true);
    expect(isBattleArenaPointerY(BATTLE_HUD_LAYOUT.arenaBottom - 11, 12)).toBe(false);
    expect(isBattleArenaPointerY(BATTLE_HUD_LAYOUT.footerTop + 1, 12)).toBe(false);
  });

  it("starts a slingshot only from the active cat's generous hit area", () => {
    const actor = { x: 360, y: 920 };
    expect(canStartAimFromActor({ x: 420, y: 920 }, actor, 42)).toBe(true);
    expect(canStartAimFromActor({ x: 520, y: 920 }, actor, 42)).toBe(false);
  });

  it("uses drag displacement so click-and-release cannot launch from an offset press", () => {
    expect(resolveAimPull({ x: 405, y: 920 }, { x: 405, y: 920 })).toBeNull();
    const pull = resolveAimPull({ x: 405, y: 920 }, { x: 305, y: 920 });
    expect(pull).toMatchObject({ direction: { x: 1, y: 0 } });
    expect(pull?.power).toBeCloseTo(100 / 210, 5);
    expect(pull?.displayOffset).toEqual({ x: -92, y: 0 });
  });

  it("compacts long actor and rule labels without splitting footer rows", () => {
    expect(compactBattleHudLine("현재 차례 · 안티-클로이아의 영혼", 18)).toHaveLength(18);
    expect(compactBattleHudLine("현재 차례 · 안티-클로이아의 영혼", 18)).toMatch(/…$/);
    expect(compactBattleHudLine("짧은 안내", 18)).toBe("짧은 안내");
  });

  it("keeps enemy intent badges visible at arena edges", () => {
    const topLeft = placeEnemyIntentBadge({
      enemyX: 12,
      enemyY: BATTLE_HUD_LAYOUT.arenaTop + 30,
      enemyRadius: 30,
      badgeWidth: 120,
      badgeHeight: 24,
    });
    expect(topLeft.x).toBeGreaterThanOrEqual(68);
    expect(topLeft.y).toBeGreaterThan(BATTLE_HUD_LAYOUT.arenaTop + 30);

    const bottomRight = placeEnemyIntentBadge({
      enemyX: 715,
      enemyY: BATTLE_HUD_LAYOUT.arenaBottom - 22,
      enemyRadius: 30,
      badgeWidth: 120,
      badgeHeight: 24,
    });
    expect(bottomRight.x).toBeLessThanOrEqual(652);
    expect(bottomRight.y + 12).toBeLessThanOrEqual(BATTLE_HUD_LAYOUT.arenaBottom - 8);
  });

  it.each([
    [640, 960],
    [720, 1280],
    [1280, 720],
    [1920, 1080],
  ])("preserves arena/footer separation under FIT scaling at %ix%i", (width, height) => {
    const projected = projectBattleHudRegions(width, height);
    expect(projected.footerTop).toBeCloseTo(projected.arenaBottom, 6);
    expect(projected.arenaTop).toBeGreaterThanOrEqual(0);
    expect(projected.footerBottom).toBeLessThanOrEqual(height);
    expect(projected.gameLeft).toBeGreaterThanOrEqual(0);
    expect(projected.gameRight).toBeLessThanOrEqual(width);
  });
});
