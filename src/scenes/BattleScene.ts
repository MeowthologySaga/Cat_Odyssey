import Phaser from "phaser";
import {
  ENEMY_BY_ID,
  ENEMY_BEHAVIOR_BY_ID,
  HERO_BY_ID,
  STAGE_BY_ID,
  type HeroDefinition,
  type StageDefinition,
} from "../data";
import {
  createBattleRuntime,
  restoreBattleRuntime,
  soundWaveAngularPattern,
  type BattleEvent,
  type BattleSetup,
  type BattleRuntime,
  type BattleSnapshot,
  type BattleTrajectory,
} from "../core/battle";
import {
  buildEndgameBattleOverride,
  createBattleHeroDefinition,
  createBattlePartyDefinitions,
  createBattleRescueReward,
  createCampaignBattleCheckpoint,
  clearCampaignBattleCheckpoint,
  battleRescueEndgameMode,
  battleRescueMode,
  consumePreparedBattleRescue,
  getCurrentScyllaSquad,
  prepareCampaignVictorySettlement,
  prepareEndgameVictorySettlement,
  readPendingBattleRewardTicket,
  readRestorableBattleRescue,
  readRestorableCampaignBattle,
  type RestorableBattleRescue,
  type RestorableCampaignBattle,
} from "../core/meta";
import { getServices, reconcileWalletAfterPurchase } from "../core/services";
import { translateText } from "../localization";
import {
  markTutorialCoachmarkSeen,
  shouldOfferTutorialCoachmark,
  TUTORIAL_COACHMARK_CONTENT,
  type TutorialCoachmarkId,
} from "../core/uxFlow";
import {
  ENEMY_FALLBACK_TEXTURE_KEY,
  hazardTextureKey,
  HERO_FALLBACK_TEXTURE_KEY,
  MAP_FALLBACK_TEXTURE_KEY,
  resolveEnemyTexture,
  resolveHeroTexture,
  resolveStageBackgroundTexture,
  stageMapTextureKey,
  stagePropTextureKey,
  stageWallTextureKey,
} from "../assets/runtimeAssetCatalog";
import {
  battleImageAssets,
  queueImageAssets,
  releaseBattleImageAssetsOnShutdown,
} from "../assets/assetStreaming";
import {
  accessibilityPaletteFor,
  addButton,
  addPanel,
  addToast,
  addTopBar,
  COLORS,
  fadeTo,
  fadeInScene,
  H,
  setUiFocusScope,
  uiTextSize,
  W,
} from "../ui/gameUi";
import { playBgm, playSfx, refreshAudioSettings, stageBgmKey } from "../audio/AudioDirector";
import { toggleAudioMute, type GameSaveV1 } from "../state";
import { calculateStageStars } from "./stageStarRules";
import { AimDragSession } from "../input/gameInput";
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
  reconcileViewIds,
  resolveAimPull,
  selectBattleStatusEffects,
  shouldShowWallSprite,
  skillEffectProfile,
  type EnemyActionTempo,
} from "./battlePresentation";

const ARENA_Y = 92;
const ARENA_H = 1040;

interface BattleSceneData {
  stageId?: string;
  /** Explicit opt-in keeps a paid rescue from being consumed by unrelated navigation. */
  resumeRescue?: boolean;
  /** Explicit opt-in prevents a newly selected battle from silently loading an older run. */
  resumeCampaign?: boolean;
  endgameMode?: "oracleTower" | "stormRoute" | "scyllaRaid";
}

interface EnemyView {
  body: Phaser.GameObjects.Image;
  semantic: Phaser.GameObjects.Graphics;
  hp: Phaser.GameObjects.Graphics;
  facing: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  weakpointIds: Set<string>;
}

interface HeroView {
  body: Phaser.GameObjects.Image;
  semantic: Phaser.GameObjects.Graphics;
  hp: Phaser.GameObjects.Graphics;
  guard: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
}

interface StagePropView {
  body: Phaser.GameObjects.Image;
  halo: Phaser.GameObjects.Arc;
  status: Phaser.GameObjects.Text;
  hp: Phaser.GameObjects.Graphics;
}

interface WallView {
  art?: Phaser.GameObjects.Image;
  debug: Phaser.GameObjects.Graphics;
  renderSignature?: string;
}

interface WallPresentationState {
  offset: { x: number; y: number };
  rotation: number;
  active: boolean;
}

interface HazardView {
  aura: Phaser.GameObjects.Arc;
  decal?: Phaser.GameObjects.Image;
  pulse: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  guide?: Phaser.GameObjects.Graphics;
  warning: Phaser.GameObjects.Graphics;
}

interface EnemyTelegraphView {
  actorId: string;
  targetId?: string;
  targetIds: string[];
  countdown: number;
  behavior: string;
  attackKind: string;
  intentKind: BattleSnapshot["enemyIntents"][number]["intentKind"];
  status: BattleSnapshot["enemyIntents"][number]["status"];
  targetPosition?: { x: number; y: number };
  areaRadius: number;
  beam: Phaser.GameObjects.Graphics;
  reticle: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

interface PendingSkillPlacement {
  actorId: string;
  kind: "temporary-bumper" | "portal-pair";
  firstPosition?: { x: number; y: number };
}

interface ObjectiveMarkerView {
  ring: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
}

export class BattleScene extends Phaser.Scene {
  private stage!: StageDefinition;
  private runtime!: BattleRuntime;
  private readonly aimDrag = new AimDragSession();
  private ended = false;
  private rescued = false;
  private rescueResumeRequested = false;
  private battleRescue?: RestorableBattleRescue;
  private preloadHeroIds: string[] = [];
  private endgameMode?: BattleSceneData["endgameMode"];
  private resumeCampaignRequested = false;
  private campaignResume?: RestorableCampaignBattle;
  private battlePartyDefinitions: HeroDefinition[] = [];
  private lastCheckpointSequence = -1;
  private checkpointWritePending = false;
  private checkpointRetryAfter = 0;
  private preview!: Phaser.GameObjects.Graphics;
  private aimElastic!: Phaser.GameObjects.Graphics;
  private activeMarker!: Phaser.GameObjects.Graphics;
  private redirectLinks!: Phaser.GameObjects.Graphics;
  private heroViews = new Map<string, HeroView>();
  private enemyViews = new Map<string, EnemyView>();
  private weakpointViews = new Map<string, Phaser.GameObjects.Arc>();
  private weakpointHpViews = new Map<string, Phaser.GameObjects.Graphics>();
  private propViews = new Map<string, StagePropView>();
  private hazardViews = new Map<string, HazardView>();
  private wallViews = new Map<string, WallView>();
  private objectiveMarkerViews = new Map<string, ObjectiveMarkerView>();
  private enemyTelegraphs = new Map<string, EnemyTelegraphView>();
  private retiringEnemyIds = new Set<string>();
  private turnText!: Phaser.GameObjects.Text;
  private turnBanner!: Phaser.GameObjects.Graphics;
  private phaseBadgeText!: Phaser.GameObjects.Text;
  private currentTurnText!: Phaser.GameObjects.Text;
  private nextTurnText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private sceneRuleText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private objectiveProgress!: Phaser.GameObjects.Text;
  private activeHeroText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private activeSkillGauge!: Phaser.GameObjects.Graphics;
  private activeSkillButton?: Phaser.GameObjects.Container;
  private activeSkillSignature = "";
  private pendingSkillPlacement?: PendingSkillPlacement;
  private skillPlacementMarker?: Phaser.GameObjects.Arc;
  private totalDamage = 0;
  private bestCombo = 0;
  private lastPointerPower = 0;
  private aimStart?: { x: number; y: number };
  private aimPullOffset = { x: 0, y: 0 };
  private capturedDomPointerId?: number;
  private gamepadAimActive = false;
  private gamepadSkillCursor?: { x: number; y: number };
  private gamepadPlacementCursor?: Phaser.GameObjects.Arc;
  private previewReflections = 1;
  private aimAssistEnabled = true;
  private screenShakeEnabled = true;
  private reducedMotion = false;
  private endgameRuleLabels: readonly string[] = [];
  private hideCrystalOrderAfterFirst = false;
  private weeklyScoreEnabled = false;
  private enemyPresentationActive = false;
  private enemyActionVisualIndex = 0;
  private enemyActionVisualDelays = new Map<string, number>();
  private enemyActionImpactOffsets = new Map<string, number>();
  private enemyActionsWithMovement = new Set<string>();
  private playedEnemyAttackActions = new Set<string>();
  private activeEnemyActorId?: string;
  private enemyPresentationTurnNumber?: number;
  private displayedHeroHp = new Map<string, number>();
  private displayedHeroAlive = new Map<string, boolean>();
  private displayedHeroPositions = new Map<string, { x: number; y: number }>();
  private heroMotionTweens = new Map<string, Phaser.Tweens.Tween>();
  private displayedEnemyHp = new Map<string, number>();
  private displayedObjectiveHp = new Map<string, number>();
  private displayedObjectiveState = new Map<string, BattleSnapshot["props"][number]["state"]>();
  private displayedEnemyPositions = new Map<string, { x: number; y: number }>();
  private displayedHazardPositions = new Map<string, { x: number; y: number }>();
  private hazardMotionTweens = new Map<string, Phaser.Tweens.Tween>();
  private displayedWallStates = new Map<string, WallPresentationState>();
  private wallMotionTweens = new Map<string, Phaser.Tweens.Tween>();
  private deferredPlayerTurnBanner = false;
  private combatPhaseOverlay?: Phaser.GameObjects.Container;
  private rescuePurchasePending = false;
  private pauseOpen = false;
  private pauseObjects: Phaser.GameObjects.GameObject[] = [];
  private enemyActionTempo: EnemyActionTempo = 1.5;
  private hitstopUntil = 0;
  private lastProjectileTrailAt = 0;
  private requestedTutorialCoachmarks = new Set<TutorialCoachmarkId>();
  private tutorialCoachmarkQueue: TutorialCoachmarkId[] = [];
  private tutorialCoachmarkActive = false;
  private tutorialCoachmarkObjects: Phaser.GameObjects.GameObject[] = [];
  private tutorialCoachmarkTimer?: Phaser.Time.TimerEvent;
  private victorySaveRetrying = false;
  private victorySaveErrorObjects: Phaser.GameObjects.GameObject[] = [];
  private battleSettings!: GameSaveV1["settings"];
  private semanticPalette!: ReturnType<typeof accessibilityPaletteFor>;
  private playerTurnFontSize = 19;
  private enemyTurnFontSize = 17;

  constructor() { super("Battle"); }

  init(data: BattleSceneData): void {
    this.rescued = false;
    this.rescueResumeRequested = Boolean(data.resumeRescue);
    this.endgameMode = data.endgameMode;
    const preloadSave = getServices().save.getSnapshot();
    const requestedRescue = this.rescueResumeRequested
      ? readRestorableBattleRescue(preloadSave, {
          ...(data.stageId ? { stageId: data.stageId } : {}),
          ...(data.endgameMode ? { mode: battleRescueMode(data.endgameMode) } : {}),
        })
      : undefined;
    this.battleRescue = requestedRescue;
    if (requestedRescue) {
      this.endgameMode = battleRescueEndgameMode(requestedRescue.rescue.mode);
    }
    this.resumeCampaignRequested = Boolean(data.resumeCampaign)
      && !this.endgameMode
      && !this.rescueResumeRequested;
    const requestedResume = this.resumeCampaignRequested
      ? readRestorableCampaignBattle(preloadSave)
      : undefined;
    this.campaignResume = requestedResume
      && (!data.stageId || requestedResume.checkpoint.stageId === data.stageId)
      ? requestedResume
      : undefined;
    this.stage = STAGE_BY_ID[
      this.battleRescue?.rescue.stageId
      ?? this.campaignResume?.checkpoint.stageId
      ?? data.stageId
      ?? "r01-s01"
    ]
      ?? STAGE_BY_ID["r01-s01"]!;
    this.preloadHeroIds = [...(this.endgameMode === "scyllaRaid"
      ? this.battleRescue?.rescue.deployedHeroIds ?? getCurrentScyllaSquad(preloadSave)
      : this.battleRescue?.rescue.deployedHeroIds
        ?? this.campaignResume?.checkpoint.deployedHeroIds
        ?? preloadSave.roster.partyHeroIds)];
    this.aimDrag.reset();
    this.ended = false;
    this.victorySaveRetrying = false;
    this.victorySaveErrorObjects = [];
    this.totalDamage = 0;
    this.bestCombo = 0;
    this.heroViews = new Map();
    this.enemyViews = new Map();
    this.weakpointViews = new Map();
    this.weakpointHpViews = new Map();
    this.propViews = new Map();
    this.hazardViews = new Map();
    this.wallViews = new Map();
    this.objectiveMarkerViews = new Map();
    this.enemyTelegraphs = new Map();
    this.retiringEnemyIds = new Set();
    this.activeSkillButton = undefined;
    this.activeSkillSignature = "";
    this.pendingSkillPlacement = undefined;
    this.skillPlacementMarker = undefined;
    this.previewReflections = 1;
    this.aimAssistEnabled = true;
    this.screenShakeEnabled = true;
    this.reducedMotion = false;
    this.endgameRuleLabels = [];
    this.hideCrystalOrderAfterFirst = false;
    this.weeklyScoreEnabled = false;
    this.enemyPresentationActive = false;
    this.enemyActionVisualIndex = 0;
    this.enemyActionVisualDelays = new Map();
    this.enemyActionImpactOffsets = new Map();
    this.enemyActionsWithMovement = new Set();
    this.playedEnemyAttackActions = new Set();
    this.activeEnemyActorId = undefined;
    this.enemyPresentationTurnNumber = undefined;
    this.displayedHeroHp = new Map();
    this.displayedHeroAlive = new Map();
    this.displayedHeroPositions = new Map();
    this.heroMotionTweens = new Map();
    this.displayedEnemyHp = new Map();
    this.displayedObjectiveHp = new Map();
    this.displayedObjectiveState = new Map();
    this.displayedEnemyPositions = new Map();
    this.displayedHazardPositions = new Map();
    this.hazardMotionTweens = new Map();
    this.displayedWallStates = new Map();
    this.wallMotionTweens = new Map();
    this.deferredPlayerTurnBanner = false;
    this.combatPhaseOverlay = undefined;
    this.rescuePurchasePending = false;
    this.pauseOpen = false;
    this.pauseObjects = [];
    this.enemyActionTempo = 1.5;
    this.hitstopUntil = 0;
    this.lastProjectileTrailAt = 0;
    this.aimStart = undefined;
    this.aimPullOffset = { x: 0, y: 0 };
    this.capturedDomPointerId = undefined;
    this.gamepadAimActive = false;
    this.gamepadSkillCursor = undefined;
    this.gamepadPlacementCursor = undefined;
    this.requestedTutorialCoachmarks = new Set();
    this.tutorialCoachmarkQueue = [];
    this.tutorialCoachmarkActive = false;
    this.tutorialCoachmarkObjects = [];
    this.tutorialCoachmarkTimer = undefined;
    this.battlePartyDefinitions = [];
    this.lastCheckpointSequence = -1;
    this.checkpointWritePending = false;
    this.checkpointRetryAfter = 0;
    this.playerTurnFontSize = 19;
    this.enemyTurnFontSize = 17;
  }

  preload(): void {
    const assets = battleImageAssets(this.stage, this.preloadHeroIds);
    queueImageAssets(this, assets, "전장을 정찰하는 중");
    releaseBattleImageAssetsOnShutdown(this, assets);
  }

  create(): void {
    const services = getServices();
    let save = services.save.getSnapshot();
    const battleRescue = this.rescueResumeRequested
      ? readRestorableBattleRescue(save, {
          stageId: this.stage.id,
          mode: battleRescueMode(this.endgameMode),
        })
      : undefined;
    this.battleRescue = battleRescue;
    if (this.rescueResumeRequested && !battleRescue) {
      services.host.ui.toast(translateText("구조 기록이 현재 콘텐츠와 맞지 않아 소비하지 않았습니다."));
      this.scene.start("Harbor");
      return;
    }
    this.rescued = Boolean(battleRescue);
    this.aimAssistEnabled = save.settings.aimAssist;
    this.reducedMotion = save.settings.reducedMotion;
    this.screenShakeEnabled = save.settings.screenShake && !this.reducedMotion;
    this.battleSettings = { ...save.settings };
    this.semanticPalette = accessibilityPaletteFor(this.battleSettings);
    this.playerTurnFontSize = uiTextSize(19);
    this.enemyTurnFontSize = uiTextSize(17);
    this.enemyActionTempo = this.battleSettings.enemyActionTempo;
    const campaignResume = this.resumeCampaignRequested
      ? readRestorableCampaignBattle(save)
      : undefined;
    this.campaignResume = campaignResume?.checkpoint.stageId === this.stage.id
      ? campaignResume
      : undefined;
    const requestedParty = battleRescue?.rescue.deployedHeroIds
      ?? (this.endgameMode === "scyllaRaid"
        ? getCurrentScyllaSquad(save)
        : this.campaignResume?.checkpoint.deployedHeroIds ?? save.roster.partyHeroIds);
    const party = battleRescue
      ? battleRescue.partyDefinitions.map((hero) => structuredClone(hero))
      : this.campaignResume
        ? this.campaignResume.partyDefinitions.map((hero) => structuredClone(hero))
        : createBattlePartyDefinitions(save, requestedParty);
    const safeParty = party.length
      ? party
      : [createBattleHeroDefinition(save, HERO_BY_ID["meow-dysseus"]!)];
    // Freeze pre-mode definitions. Endgame rules are recompiled exactly once on
    // rescue restore; storing their output here would apply those rules twice.
    this.battlePartyDefinitions = safeParty.map((hero) => structuredClone(hero));
    const override = this.endgameMode
      ? buildEndgameBattleOverride(save, this.endgameMode, this.stage, safeParty, ENEMY_BY_ID)
      : undefined;
    if (override) {
      this.stage = override.stage;
      this.endgameRuleLabels = override.ruleLabels;
      this.hideCrystalOrderAfterFirst = override.hideCrystalOrderAfterFirst;
      this.weeklyScoreEnabled = override.weeklyScoreEnabled;
    }
    const isBossStage = Boolean(this.stage.boss);
    playBgm(this, stageBgmKey(this.stage.arena.musicKey, isBossStage), {
      role: isBossStage ? "boss" : "battle",
    });
    const battleSetup: BattleSetup = {
      stage: this.stage,
      party: override?.party ?? safeParty,
      enemyCatalog: override?.enemyCatalog ?? ENEMY_BY_ID,
      enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
      seed: `${this.stage.id}:${save.records.wins + save.records.losses + 1}:${this.rescued ? "rescue" : "voyage"}`,
      config: { ...(override?.config ?? {}) },
    };
    if (battleRescue) {
      let restored: BattleRuntime;
      try {
        restored = restoreBattleRuntime(battleSetup, battleRescue.preparedSnapshot);
      } catch {
        services.host.ui.toast(translateText("구조 전투를 복원하지 못해 기록을 소비하지 않았습니다."));
        this.scene.start("Harbor");
        return;
      }
      // Consumption happens only after the runtime accepted the fully validated
      // frozen snapshot and party definitions.
      const consumed = consumePreparedBattleRescue(save, battleRescue);
      if (!consumed.ok) {
        services.host.ui.toast(translateText(consumed.message));
        this.scene.start("Harbor");
        return;
      }
      this.runtime = restored;
      save = consumed.save;
      if (battleRescue.rescue.mode === "campaign") {
        save.recovery.activeCampaignBattle = createCampaignBattleCheckpoint(
          this.runtime.getSnapshot(),
          this.battlePartyDefinitions,
        );
        this.lastCheckpointSequence = this.runtime.getSnapshot().eventSequence;
      }
      void services.save.replace(save).catch(() => {
        if (this.scene.isActive()) addToast(this, "구조 기록 저장을 다시 시도합니다.", COLORS.gold);
        this.time.delayedCall(900, () => { void services.save.saveNow().catch(() => undefined); });
      });
    } else if (this.campaignResume) {
      try {
        this.runtime = restoreBattleRuntime(battleSetup, this.campaignResume.snapshot);
      } catch {
        this.campaignResume = undefined;
        this.discardCampaignCheckpoint();
        this.runtime = createBattleRuntime(battleSetup);
      }
    } else {
      if (this.resumeCampaignRequested) this.discardCampaignCheckpoint();
      this.runtime = createBattleRuntime(battleSetup);
    }
    if (
      override?.protectTargetHpPercent !== undefined
      && !battleRescue
      && !this.campaignResume
    ) {
      const adjusted = this.runtime.getSnapshot();
      for (const target of adjusted.objective.targets.filter((entry) => entry.kind === "prop")) {
        target.maxHp = Math.max(1, Math.round(target.maxHp * override.protectTargetHpPercent / 100));
        target.hp = target.maxHp;
      }
      for (const prop of adjusted.props) {
        const target = adjusted.objective.targets.find((entry) => entry.id === prop.id);
        if (target) { prop.maxHp = target.maxHp; prop.hp = target.hp; }
      }
      this.runtime = restoreBattleRuntime(battleSetup, adjusted);
    }
    this.previewReflections = this.resolvePreviewReflections(this.runtime.getSnapshot());
    if (override?.previewReflections !== undefined) {
      this.previewReflections = Math.min(this.previewReflections, override.previewReflections);
    }

    this.drawArena();
    this.drawWallsAndHazards();
    this.drawStageProps();
    this.createActors();
    this.createHud();
    this.preview = this.add.graphics().setDepth(210);
    this.aimElastic = this.add.graphics().setDepth(118);
    this.activeMarker = this.add.graphics().setDepth(164);
    this.redirectLinks = this.add.graphics().setDepth(114);
    this.bindInput();
    const openingEvents = this.runtime.drainEvents();
    const relicDelay = openingEvents.find((event) => event.effectKind === "relic-first-countdown-delay");
    if (relicDelay) {
      this.time.delayedCall(380, () => addToast(
        this,
        `유물 효과 · 적의 첫 공격 ${Math.max(1, Math.round(relicDelay.amount ?? 1))}턴 지연`,
        COLORS.cyan,
      ));
    }
    this.syncViews(this.runtime.getSnapshot());
    this.showPlayerTurnBanner(this.runtime.getSnapshot(), 120);
    this.persistCampaignCheckpoint(this.runtime.getSnapshot());
    fadeInScene(this, 220);
  }

  override update(_time: number, delta: number): void {
    if (!this.runtime || this.ended || this.pauseOpen) return;
    let snapshot = this.runtime.getSnapshot();
    if (snapshot.phase === "projectile" && _time >= this.hitstopUntil) {
      this.runtime.advance(Math.min(0.04, delta / 1000) * 1.35);
      snapshot = this.runtime.getSnapshot();
    }
    if (snapshot.phase === "projectile") this.spawnHighSpeedTrail(snapshot, _time);
    if (!this.enemyPresentationActive && (snapshot.phase === "awaitingAim" || snapshot.phase === "aiming")) {
      const availability = this.runtime.getActionAvailability();
      if (!availability.allowed && availability.reason) {
        this.aimDrag.reset();
        this.resetAimPresentation();
        this.preview.clear();
        this.runtime.skipBlockedTurn();
        snapshot = this.runtime.getSnapshot();
      }
    }
    this.updateGamepadTargeting(snapshot, delta);
    snapshot = this.runtime.getSnapshot();
    this.processEvents(this.runtime.drainEvents());
    this.syncViews(snapshot);
    if (this.enemyPresentationActive) return;
    this.persistCampaignCheckpoint(snapshot);
    if (snapshot.phase === "victory") this.finishBattle(true, snapshot);
    else if (snapshot.phase === "defeat") this.finishBattle(false, snapshot);
  }

  /**
   * Persists at most once per authoritative runtime event sequence. The last
   * stable checkpoint remains installed while a shot, enemy retaliation, or
   * its presentation is in progress, so a crash can never resume halfway
   * through an enemy action.
   */
  private persistCampaignCheckpoint(snapshot: BattleSnapshot): void {
    if (
      this.endgameMode
      || this.ended
      || this.enemyPresentationActive
      || this.checkpointWritePending
      || Date.now() < this.checkpointRetryAfter
      || snapshot.eventSequence === this.lastCheckpointSequence
    ) {
      return;
    }
    const services = getServices();
    const save = services.save.getSnapshot();
    if (!readPendingBattleRewardTicket(save, this.stage.id, "campaign")) return;

    let checkpoint: ReturnType<typeof createCampaignBattleCheckpoint>;
    try {
      checkpoint = createCampaignBattleCheckpoint(snapshot, this.battlePartyDefinitions);
    } catch {
      return;
    }
    this.lastCheckpointSequence = snapshot.eventSequence;
    this.checkpointWritePending = true;
    void services.save.update((draft) => {
      draft.recovery.activeCampaignBattle = checkpoint;
    }).catch(() => {
      // GameSaveStore installs the checkpoint in memory before awaiting the
      // host write. A later turn or unload flush retries without blocking play.
      this.lastCheckpointSequence = -1;
      this.checkpointRetryAfter = Date.now() + 2_000;
    }).finally(() => {
      this.checkpointWritePending = false;
    });
  }

  private discardCampaignCheckpoint(): void {
    if (this.endgameMode) return;
    const services = getServices();
    const current = services.save.getSnapshot();
    if (current.recovery.activeCampaignBattle?.stageId !== this.stage.id) return;
    const cleared = clearCampaignBattleCheckpoint(current);
    if (cleared === current) return;
    void services.save.replace(cleared).catch(() => {
      // The cleared snapshot is already authoritative in memory. Unload or the
      // next normal save will retry it; navigation must never be held hostage.
      void services.save.saveNow().catch(() => undefined);
    });
  }

  private drawArena(): void {
    const themeTint = this.themeTint();
    const texture = resolveStageBackgroundTexture(
      this.textures,
      this.stage.routeId,
      this.stage.arena.backgroundKey,
    );
    const background = this.add.image(W / 2, ARENA_Y + ARENA_H / 2, texture).setDisplaySize(W, ARENA_H).setDepth(0);
    if (texture === MAP_FALLBACK_TEXTURE_KEY) background.setTint(themeTint);
    const variant = this.arenaVariant(this.stage.arena.backgroundKey);
    const hasStageArt = texture === stageMapTextureKey(this.stage.arena.backgroundKey);
    this.add.rectangle(
      W / 2,
      ARENA_Y + ARENA_H / 2,
      W,
      ARENA_H,
      variant.color,
      hasStageArt ? Math.min(0.035, variant.alpha) : variant.alpha,
    ).setDepth(1);
    // Authored per-stage plates already carry their own composition. Runtime
    // geometric motifs are retained only as a safe route-art fallback.
    if (!hasStageArt) this.drawArenaMotif(variant.color, variant.motif);
    const border = this.add.graphics().setDepth(10);
    border.lineStyle(7, 0x041016, 0.95).strokeRect(3, ARENA_Y, W - 6, ARENA_H);
    border.lineStyle(2, COLORS.gold, 0.38).strokeRect(9, ARENA_Y + 6, W - 18, ARENA_H - 12);
  }

  private arenaVariant(backgroundKey: string): { color: number; alpha: number; motif: number } {
    let hash = 2166136261;
    for (const character of backgroundKey) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const palette = [0x0b5664, 0x315d49, 0x5e3e72, 0x77512d, 0x183f69, 0x6f3437];
    return {
      color: palette[Math.abs(hash) % palette.length]!,
      alpha: this.stage.boss ? 0.16 : this.stage.arena.theme === "cyclops-cave" ? 0.07 : 0.11,
      motif: Math.abs(hash >>> 3) % 3,
    };
  }

  private drawArenaMotif(color: number, motif: number): void {
    const graphics = this.add.graphics().setDepth(2);
    graphics.lineStyle(2, color, 0.16);
    if (motif === 0) {
      graphics.strokeCircle(72, ARENA_Y + 260, 96).strokeCircle(W - 54, ARENA_Y + 760, 130);
      graphics.lineStyle(1, COLORS.gold, 0.1).strokeCircle(W / 2, ARENA_Y + ARENA_H / 2, 230);
    } else if (motif === 1) {
      for (let offset = -180; offset <= 520; offset += 175) {
        graphics.lineBetween(offset, ARENA_Y + 90, offset + 380, ARENA_Y + 390);
        graphics.lineBetween(W - offset, ARENA_Y + 650, W - offset - 380, ARENA_Y + 950);
      }
    } else {
      graphics.strokeTriangle(38, ARENA_Y + 260, 170, ARENA_Y + 126, 250, ARENA_Y + 310);
      graphics.strokeTriangle(W - 42, ARENA_Y + 760, W - 190, ARENA_Y + 910, W - 270, ARENA_Y + 700);
      graphics.lineStyle(1, COLORS.teal, 0.12).lineBetween(88, ARENA_Y + 520, W - 88, ARENA_Y + 520);
    }
  }

  private drawWallsAndHazards(): void {
    const snapshot = this.runtime.getSnapshot();
    for (const hazard of this.stage.hazards) {
      const color = hazard.type.includes("wind") || hazard.type === "current" || hazard.type === "wave-front" ? 0x78d9d1 : hazard.type === "slow-field" ? 0xb177bb : 0xd6ad54;
      const guide = this.drawHazardPresentationGuide(hazard, snapshot, color);
      const aura = this.add.circle(hazard.x, hazard.y + ARENA_Y, hazard.radius, color, 0.11)
        .setStrokeStyle(hazard.type === "moving-bumper" ? 4 : 2, color, hazard.type === "moving-bumper" ? 0.78 : 0.35)
        .setDepth(16);
      const textureKey = hazardTextureKey(hazard.type);
      let decal: Phaser.GameObjects.Image | undefined;
      if (this.textures.exists(textureKey)) {
        const decalAlpha = this.hazardDecalAlpha(hazard.type);
        const waveLength = Number(hazard.parameters.length ?? this.stage.arena.width);
        const displayWidth = hazard.type === "wave-front" ? waveLength : hazard.radius * 2.25;
        const displayHeight = hazard.type === "wave-front"
          ? hazard.radius * 2.4
          : hazard.type === "one-way-wall"
            ? hazard.radius * 0.82
            : displayWidth;
        decal = this.add.image(hazard.x, hazard.y + ARENA_Y, textureKey)
          .setDisplaySize(displayWidth, displayHeight)
          .setAlpha(decalAlpha)
          .setDepth(this.hazardDecalDepth(hazard.type));
        if (hazard.type === "one-way-wall") decal.setAngle(Number(hazard.parameters.allowedAngle ?? 0));
        if (hazard.type === "wave-front" && String(hazard.parameters.axis ?? "y") === "x") decal.setAngle(90);
        if (!this.reducedMotion) {
          if (["wind-vector", "current", "whirlpool", "portal"].includes(hazard.type)) {
            this.tweens.add({ targets: decal, angle: 360, duration: hazard.type === "whirlpool" ? 3600 : 6200, repeat: -1 });
          } else {
            this.tweens.add({ targets: decal, alpha: Math.max(0.18, decalAlpha * 0.62), scaleX: decal.scaleX * 1.06, scaleY: decal.scaleY * 1.06, duration: 900, yoyo: true, repeat: -1 });
          }
        }
      }
      const pulse = this.add.circle(hazard.x, hazard.y + ARENA_Y, Math.max(12, hazard.radius * 0.12), color, 0.25).setDepth(17);
      if (this.reducedMotion) pulse.setAlpha(0.14);
      else this.tweens.add({ targets: pulse, scale: Math.max(1.5, hazard.radius / 20), alpha: 0, duration: 1800, repeat: -1 });
      const label = this.add.text(hazard.x, hazard.y + ARENA_Y + hazard.radius + 10, this.hazardLabel(hazard.type), {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(11)}px`, color: "#d7e9df", stroke: "#061014", strokeThickness: 4,
      }).setOrigin(0.5, 0).setDepth(28);
      const warning = this.add.graphics().setDepth(27);
      this.hazardViews.set(hazard.id, { aura, decal, pulse, label, guide, warning });
    }
    for (const wall of snapshot.walls) {
      const view = this.ensureWallView(wall.id);
      if (view) this.redrawWallView(view, wall);
    }
  }

  /** Large floor decals must explain the field without masking actors or objectives. */
  private hazardDecalAlpha(type: string): number {
    if (type === "current") return 0.24;
    if (type === "wind-vector") return 0.28;
    if (type === "slow-field") return 0.3;
    if (type === "wave-front") return 0.84;
    if (type === "moving-bumper") return 0.9;
    if (type === "one-way-wall") return 0.86;
    if (type === "forbidden-target") return 0.7;
    if (type === "lightning") return 0.62;
    if (type === "portal" || type === "whirlpool") return 0.56;
    if (type === "sound-wave") return 0.48;
    return 0.58;
  }

  private hazardDecalDepth(type: string): number {
    return ["current", "wind-vector", "slow-field"].includes(type) ? 14 : 18;
  }

  private drawHazardMotionGuide(hazard: Pick<StageDefinition["hazards"][number], "x" | "y" | "radius" | "parameters">, color: number): Phaser.GameObjects.Graphics {
    const distance = Math.max(70, Number(hazard.parameters.distance ?? hazard.radius * 2.5));
    const axis = String(hazard.parameters.axis ?? "x");
    const unit = axis === "y" ? { x: 0, y: 1 } : axis === "diagonal" ? { x: 0.707, y: 0.707 } : { x: 1, y: 0 };
    const guide = this.add.graphics().setDepth(14);
    guide.lineStyle(2, color, 0.24).lineBetween(
      hazard.x - unit.x * distance,
      hazard.y + ARENA_Y - unit.y * distance,
      hazard.x + unit.x * distance,
      hazard.y + ARENA_Y + unit.y * distance,
    );
    for (let step = -0.5; step <= 0.5; step += 0.125) {
      guide.fillStyle(color, Math.abs(step) > 0.4 ? 0.72 : 0.34).fillCircle(
        hazard.x + unit.x * distance * step * 2,
        hazard.y + ARENA_Y + unit.y * distance * step * 2,
        Math.abs(step) > 0.4 ? 5 : 3,
      );
    }
    return guide;
  }

  private drawHazardPresentationGuide(
    hazard: StageDefinition["hazards"][number],
    _snapshot: BattleSnapshot,
    color: number,
  ): Phaser.GameObjects.Graphics | undefined {
    const moving = hazard.type === "moving-bumper" || hazard.parameters.moving === true;
    return moving ? this.drawHazardMotionGuide(hazard, color) : undefined;
  }

  private drawGuideArrow(
    graphics: Phaser.GameObjects.Graphics,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: number,
  ): void {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const wing = 13;
    graphics.lineStyle(4, 0x061014, 0.72).lineBetween(fromX, fromY, toX, toY);
    graphics.lineStyle(2, color, 0.92)
      .lineBetween(fromX, fromY, toX, toY)
      .lineBetween(toX, toY, toX - Math.cos(angle - 0.55) * wing, toY - Math.sin(angle - 0.55) * wing)
      .lineBetween(toX, toY, toX - Math.cos(angle + 0.55) * wing, toY - Math.sin(angle + 0.55) * wing);
  }

  private drawStageProps(): void {
    for (const prop of this.runtime.getSnapshot().props) this.ensurePropView(prop);
  }

  private heroPresentationRadius(
    snapshot: BattleSnapshot,
    hero: BattleSnapshot["party"][number],
  ): number {
    return effectiveHeroPresentationRadius(hero.radius, hero.id, snapshot.effects);
  }

  private enemyPresentationRadius(
    snapshot: BattleSnapshot,
    enemy: BattleSnapshot["enemies"][number],
  ): number {
    return effectiveEnemyPresentationRadius(enemy.radius, enemy.id, snapshot.effects);
  }

  private targetPresentationRadius(
    snapshot: BattleSnapshot,
    target: { readonly id: string; readonly radius: number },
  ): number {
    const hero = snapshot.party.find((entry) => entry.id === target.id);
    if (hero) return this.heroPresentationRadius(snapshot, hero);
    const enemy = snapshot.enemies.find((entry) => entry.id === target.id);
    if (enemy) return this.enemyPresentationRadius(snapshot, enemy);
    return target.radius;
  }

  /**
   * Resizes an actor only when its authoritative collider radius changes. The
   * ratio-preserving update keeps ricochet stretch and short impact tweens
   * intact while refreshing their shared base scale for future animations.
   */
  private syncActorPresentationRadius(
    body: Phaser.GameObjects.Image,
    baseRadius: number,
    presentationRadius: number,
  ): void {
    const previousRadius = Number(body.getData("presentationRadius"));
    if (Number.isFinite(previousRadius) && Math.abs(previousRadius - presentationRadius) < 0.001) return;
    const authoredScaleX = Number(body.getData("authoredBaseScaleX")) || body.scaleX;
    const authoredScaleY = Number(body.getData("authoredBaseScaleY")) || body.scaleY;
    const previousBaseScaleX = Number(body.getData("baseScaleX")) || authoredScaleX;
    const previousBaseScaleY = Number(body.getData("baseScaleY")) || authoredScaleY;
    const radiusRatio = baseRadius > 0 ? presentationRadius / baseRadius : 1;
    const nextBaseScaleX = authoredScaleX * radiusRatio;
    const nextBaseScaleY = authoredScaleY * radiusRatio;
    const currentRatioX = previousBaseScaleX !== 0 ? body.scaleX / previousBaseScaleX : 1;
    const currentRatioY = previousBaseScaleY !== 0 ? body.scaleY / previousBaseScaleY : 1;
    body
      .setData("presentationRadius", presentationRadius)
      .setData("baseScaleX", nextBaseScaleX)
      .setData("baseScaleY", nextBaseScaleY)
      .setScale(nextBaseScaleX * currentRatioX, nextBaseScaleY * currentRatioY);
  }

  private createActors(): void {
    const snapshot = this.runtime.getSnapshot();
    for (const hero of snapshot.party) {
      const definition = HERO_BY_ID[hero.definitionId]!;
      const texture = resolveHeroTexture(this.textures, definition);
      const image = this.add.image(hero.position.x, hero.position.y + ARENA_Y, texture).setDisplaySize(hero.radius * (texture === HERO_FALLBACK_TEXTURE_KEY ? 2.15 : 2.5), hero.radius * (texture === HERO_FALLBACK_TEXTURE_KEY ? 2.15 : 2.5));
      if (texture === HERO_FALLBACK_TEXTURE_KEY) image.setTint(this.heroTint(definition));
      image.setDepth(120)
        .setData("authoredBaseScaleX", image.scaleX)
        .setData("authoredBaseScaleY", image.scaleY)
        .setData("baseScaleX", image.scaleX)
        .setData("baseScaleY", image.scaleY);
      const presentationRadius = this.heroPresentationRadius(snapshot, hero);
      this.syncActorPresentationRadius(image, hero.radius, presentationRadius);
      const semantic = this.add.graphics().setDepth(119);
      const hp = this.add.graphics().setDepth(152);
      const guard = this.add.graphics().setDepth(116);
      const name = this.add.text(hero.position.x, hero.position.y + ARENA_Y - presentationRadius - 34, definition.name, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(12)}px`, color: "#d9f5ef", stroke: "#071014", strokeThickness: 4,
      }).setOrigin(0.5).setDepth(153);
      const status = this.add.text(hero.position.x, hero.position.y + ARENA_Y + presentationRadius + 8, "", {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(10)}px`, color: "#9ff6e9", stroke: "#071014", strokeThickness: 3,
        align: "center", wordWrap: { width: 180, useAdvancedWrap: true },
      }).setOrigin(0.5, 0).setMaxLines(2).setDepth(154);
      this.displayedHeroHp.set(hero.id, hero.hp);
      this.displayedHeroPositions.set(hero.id, { ...hero.position });
      this.heroViews.set(hero.id, { body: image, semantic, hp, guard, name, status });
    }
    for (const enemy of snapshot.enemies) {
      if (enemy.alive) this.ensureEnemyView(enemy, snapshot);
    }
  }

  private ensureEnemyView(
    enemy: BattleSnapshot["enemies"][number],
    snapshot = this.runtime.getSnapshot(),
  ): EnemyView | undefined {
    const existing = this.enemyViews.get(enemy.id);
    if (existing) {
      this.ensureWeakpointViews(enemy, existing);
      return existing;
    }
    if (!enemy.alive || this.retiringEnemyIds.has(enemy.id)) return undefined;
    const definition = ENEMY_BY_ID[enemy.definitionId];
    if (!definition) return undefined;
    const texture = resolveEnemyTexture(this.textures, definition);
    const displayScale = texture === ENEMY_FALLBACK_TEXTURE_KEY
      ? definition.boss ? 2.45 : 2.1
      : definition.boss ? 2.75 : 2.35;
    const body = this.add.image(enemy.position.x, enemy.position.y + ARENA_Y, texture)
      .setDisplaySize(enemy.radius * displayScale, enemy.radius * displayScale);
    if (texture === ENEMY_FALLBACK_TEXTURE_KEY) body.setTint(this.enemyTint(definition.element));
    body.setDepth(90)
      .setData("authoredBaseScaleX", body.scaleX)
      .setData("authoredBaseScaleY", body.scaleY)
      .setData("baseScaleX", body.scaleX)
      .setData("baseScaleY", body.scaleY);
    const presentationRadius = this.enemyPresentationRadius(snapshot, enemy);
    this.syncActorPresentationRadius(body, enemy.radius, presentationRadius);
    const semantic = this.add.graphics().setDepth(89);
    const hp = this.add.graphics().setDepth(150);
    const facing = this.add.graphics().setDepth(96);
    const suffix = enemy.generation > 0 ? " · 증원" : "";
    const name = this.add.text(enemy.position.x, enemy.position.y + ARENA_Y - presentationRadius - 34, `${definition.name}${suffix}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(definition.boss ? 15 : 12)}px`, color: definition.boss ? "#f4cf76" : "#d8e2d7", stroke: "#071014", strokeThickness: 4,
    }).setOrigin(0.5).setDepth(151);
    const view: EnemyView = { body, semantic, hp, facing, name, weakpointIds: new Set() };
    this.enemyViews.set(enemy.id, view);
    this.ensureWeakpointViews(enemy, view);
    if (this.reducedMotion) body.setScale(body.getData("baseScaleX"), body.getData("baseScaleY")).setAlpha(1);
    else {
      body.setScale(0.35).setAlpha(0);
      this.tweens.add({
        targets: body,
        scaleX: body.getData("baseScaleX"),
        scaleY: body.getData("baseScaleY"),
        alpha: 1,
        duration: 240,
        ease: "Back.Out",
        onComplete: () => body.setScale(body.getData("baseScaleX"), body.getData("baseScaleY")),
      });
    }
    return view;
  }

  private ensureWeakpointViews(enemy: BattleSnapshot["enemies"][number], view: EnemyView): void {
    for (const weakpoint of enemy.weakpoints) {
      if (!this.weakpointViews.has(weakpoint.id)) {
        const eye = this.add.circle(weakpoint.position.x, weakpoint.position.y + ARENA_Y, weakpoint.radius, 0x8de057, 0.6)
          .setStrokeStyle(3, 0xf2e279, 0.95)
          .setDepth(130);
        if (!this.reducedMotion) this.tweens.add({ targets: eye, scale: 1.16, alpha: 0.9, duration: 650, yoyo: true, repeat: -1 });
        this.weakpointViews.set(weakpoint.id, eye);
      }
      if (!this.weakpointHpViews.has(weakpoint.id)) {
        this.weakpointHpViews.set(weakpoint.id, this.add.graphics().setDepth(132));
      }
      view.weakpointIds.add(weakpoint.id);
    }
  }

  private retireEnemyView(enemyId: string): void {
    const view = this.enemyViews.get(enemyId);
    if (!view || this.retiringEnemyIds.has(enemyId)) return;
    this.retiringEnemyIds.add(enemyId);
    this.clearEnemyTelegraph(enemyId);
    view.hp.clear();
    view.facing.clear();
    view.semantic.clear();
    view.name.setVisible(false);
    for (const weakpointId of view.weakpointIds) {
      const weakpointView = this.weakpointViews.get(weakpointId);
      if (weakpointView) {
        this.tweens.killTweensOf(weakpointView);
        weakpointView.destroy();
      }
      this.weakpointViews.delete(weakpointId);
      this.weakpointHpViews.get(weakpointId)?.destroy();
      this.weakpointHpViews.delete(weakpointId);
    }
    this.tweens.add({
      targets: view.body,
      alpha: 0,
      scaleX: view.body.getData("baseScaleX") * 0.4,
      scaleY: view.body.getData("baseScaleY") * 0.4,
      angle: 18,
      duration: enemyPresentationDelay(260, this.enemyActionTempo),
      onComplete: () => {
        view.body.destroy();
        view.hp.destroy();
        view.facing.destroy();
        view.semantic.destroy();
        view.name.destroy();
        this.enemyViews.delete(enemyId);
      },
    });
  }

  private createHud(): void {
    addTopBar(this, this.stage.name, () => this.confirmRetreat(), { bindKeyboardBack: false });
    addButton(this, 425, 46, "Ⅱ", {
      width: 50,
      height: 48,
      fontSize: 20,
      accent: 0x6c8c8b,
      focusKey: "battle-open-pause",
      onClick: () => this.showPauseMenu(),
    }).setDepth(540);
    const footer = this.add.graphics().setDepth(400);
    footer.fillStyle(0x031017, 0.985).fillRect(
      0,
      BATTLE_HUD_LAYOUT.footerTop,
      W,
      BATTLE_HUD_LAYOUT.footerBottom - BATTLE_HUD_LAYOUT.footerTop,
    );
    footer.lineStyle(2, COLORS.gold, 0.72)
      .lineBetween(0, BATTLE_HUD_LAYOUT.footerTop + 1, W, BATTLE_HUD_LAYOUT.footerTop + 1);
    footer.lineStyle(1, 0x6fa6a2, 0.3)
      .lineBetween(BATTLE_HUD_LAYOUT.footerDividerX, 1140, BATTLE_HUD_LAYOUT.footerDividerX, 1274);
    footer.fillStyle(0x071b22, 0.98)
      .fillRoundedRect(
        BATTLE_HUD_LAYOUT.objectiveRail.x,
        BATTLE_HUD_LAYOUT.objectiveRail.y,
        BATTLE_HUD_LAYOUT.objectiveRail.width,
        BATTLE_HUD_LAYOUT.objectiveRail.height,
        10,
      );
    footer.lineStyle(1, COLORS.gold, 0.45)
      .strokeRoundedRect(
        BATTLE_HUD_LAYOUT.objectiveRail.x,
        BATTLE_HUD_LAYOUT.objectiveRail.y,
        BATTLE_HUD_LAYOUT.objectiveRail.width,
        BATTLE_HUD_LAYOUT.objectiveRail.height,
        10,
      );

    this.turnBanner = this.add.graphics().setDepth(430);
    this.phaseBadgeText = this.add.text(24, 1148, "아군 차례", {
      fontFamily: "Georgia, Malgun Gothic, serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(11)}px`,
      color: "#071014",
      backgroundColor: "#f1c967",
      padding: { x: 8, y: 4 },
    }).setMaxLines(1).setDepth(433);
    this.currentTurnText = this.add.text(132, 1146, "현재 차례", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(15)}px`,
      color: "#fff0b8",
      stroke: "#071014",
      strokeThickness: 3,
      wordWrap: { width: 225, useAdvancedWrap: true },
    }).setMaxLines(1).setDepth(433);
    this.nextTurnText = this.add.text(132, 1172, "", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontSize: `${uiTextSize(10)}px`,
      color: "#9bb9b6",
      stroke: "#071014",
      strokeThickness: 2,
      wordWrap: { width: 225, useAdvancedWrap: true },
    }).setMaxLines(1).setDepth(433);
    this.sceneRuleText = this.add.text(404, 1178, "", {
      fontFamily: "Malgun Gothic, sans-serif",
      fontStyle: "bold",
      fontSize: `${uiTextSize(8)}px`,
      color: "#c9f4eb",
      wordWrap: { width: 200, useAdvancedWrap: true },
    }).setOrigin(0, 0).setMaxLines(1).setDepth(430).setVisible(false);
    this.objectiveText = this.add.text(404, 1148, this.objectiveLabel(), {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color: "#e0c574",
      wordWrap: { width: 214, useAdvancedWrap: true },
    }).setMaxLines(1).setDepth(420);
    this.objectiveProgress = this.add.text(694, 1146, "0 / 1", {
      fontFamily: "Georgia, Malgun Gothic, serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: "#fff0b8", backgroundColor: "#183137", padding: { x: 10, y: 5 },
    }).setOrigin(1, 0).setDepth(421);
    this.turnText = this.add.text(24, 1210, "턴 1", {
      fontFamily: "Georgia, Malgun Gothic, serif", fontStyle: "bold", fontSize: `${uiTextSize(19)}px`, color: "#f7e7bb",
    }).setMaxLines(1).setDepth(420);
    this.activeHeroText = this.add.text(150, 1211, "", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(10)}px`, color: "#8de1d8",
      wordWrap: { width: 218, useAdvancedWrap: true },
    }).setMaxLines(2).setDepth(420);
    this.hintText = this.add.text(24, 1245, "캐릭터를 뒤로 당겨 발사하세요", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(12)}px`, color: "#91b9b4",
      wordWrap: { width: 344, useAdvancedWrap: true },
    }).setMaxLines(2).setDepth(420);
    this.comboText = this.add.text(694, 1180, "", {
      fontFamily: "Georgia, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(11)}px`, color: "#f5cf69", align: "right",
    }).setOrigin(1, 0.5).setDepth(420);
    this.activeSkillGauge = this.add.graphics().setDepth(424);
  }

  private showPauseMenu(): void {
    if (this.pauseOpen || this.ended) return;
    this.pauseOpen = true;
    this.aimDrag.reset();
    this.resetAimPresentation();
    this.lastPointerPower = 0;
    this.runtime.clearAim();
    this.preview.clear();
    this.cancelSkillPlacement();
    this.persistCampaignCheckpoint(this.runtime.getSnapshot());
    this.time.paused = true;
    this.tweens.pauseAll();
    setUiFocusScope(this, "battle-pause", "battle-pause-resume");
    this.renderPauseMenu();
  }

  private renderPauseMenu(): void {
    for (const object of this.pauseObjects) object.destroy();
    this.pauseObjects = [];
    const settings = this.battleSettings;
    const objects: Phaser.GameObjects.GameObject[] = [];
    objects.push(this.add.rectangle(W / 2, H / 2, W, H, 0x010407, 0.82).setDepth(3000).setInteractive());
    objects.push(addPanel(this, 84, 278, 552, 790, COLORS.cyan, 0.995).setDepth(3010));
    objects.push(this.add.text(W / 2, 344, "항해 일시정지", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(34)}px`, color: "#f7e7bb",
      stroke: "#071014", strokeThickness: 6,
    }).setOrigin(0.5).setDepth(3020));
    objects.push(this.add.text(W / 2, 401, "전투는 멈춘 상태입니다. 빠른 설정은 즉시 저장됩니다.", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, color: "#9fc9c3",
    }).setOrigin(0.5).setDepth(3020));
    objects.push(addButton(this, W / 2, 492, "전투 계속", {
      width: 400, height: 70, icon: "▶", primary: true, focusKey: "battle-pause-resume", onClick: () => this.resumeBattle(),
    }).setDepth(3030));
    objects.push(addButton(this, W / 2, 594, `조준 가이드  ${this.aimAssistEnabled ? "켜짐" : "꺼짐"}`, {
      width: 400, height: 64, subtitle: "예상 반사선 표시 단계 변경", accent: this.aimAssistEnabled ? COLORS.cyan : 0x6a7477,
      focusKey: "battle-pause-aim-assist",
      onClick: () => this.togglePauseSetting("aimAssist"),
    }).setDepth(3030));
    objects.push(addButton(this, W / 2, 682, `화면 흔들림  ${this.screenShakeEnabled ? "켜짐" : "꺼짐"}`, {
      width: 400, height: 64, subtitle: this.reducedMotion ? "모션 줄이기 설정으로 비활성" : "강한 타격의 카메라 반응", accent: this.screenShakeEnabled ? COLORS.gold : 0x6a7477,
      enabled: !this.reducedMotion,
      focusKey: "battle-pause-screen-shake",
      onClick: () => this.togglePauseSetting("screenShake"),
    }).setDepth(3030));
    objects.push(addButton(this, W / 2, 770, `효과음  ${settings.sfxVolume > 0 ? "켜짐" : "꺼짐"}`, {
      width: 400, height: 64, subtitle: settings.sfxVolume > 0
        ? `${Math.round(settings.sfxVolume * 100)}% · 눌러 음소거`
        : `눌러 ${Math.round(settings.lastNonZeroSfxVolume * 100)}%로 복원`,
      accent: settings.sfxVolume > 0 ? COLORS.green : 0x6a7477,
      focusKey: "battle-pause-sfx",
      onClick: () => this.togglePauseSetting("sfx"),
    }).setDepth(3030));
    objects.push(addButton(this, W / 2, 858, `적 행동 속도  ${this.enemyActionTempo}×`, {
      width: 400, height: 64, subtitle: "1× / 1.5× / 2× 순환", accent: COLORS.gold,
      focusKey: "battle-pause-enemy-speed",
      onClick: () => this.cycleEnemyActionTempo(),
    }).setDepth(3030));
    objects.push(addButton(this, W / 2, 972, "전투 포기", {
      width: 360, height: 60, accent: COLORS.red,
      focusKey: "battle-pause-retreat",
      onClick: () => {
        this.resumeBattle();
        void this.confirmRetreat();
      },
    }).setDepth(3030));
    this.pauseObjects = objects;
  }

  private cycleEnemyActionTempo(): void {
    this.enemyActionTempo = this.enemyActionTempo === 1 ? 1.5 : this.enemyActionTempo === 1.5 ? 2 : 1;
    this.battleSettings = { ...this.battleSettings, enemyActionTempo: this.enemyActionTempo };
    void getServices().save.update((draft) => {
      draft.settings.enemyActionTempo = this.enemyActionTempo;
    }).catch((error: unknown) => {
      addToast(this, error instanceof Error ? error.message : "적 행동 속도를 저장하지 못했습니다", COLORS.red);
    });
    this.renderPauseMenu();
  }

  private togglePauseSetting(key: "aimAssist" | "screenShake" | "sfx"): void {
    const services = getServices();
    if (key === "aimAssist") {
      this.aimAssistEnabled = !this.aimAssistEnabled;
      this.previewReflections = this.resolvePreviewReflections(this.runtime.getSnapshot());
      this.preview.clear();
    }
    if (key === "screenShake") this.screenShakeEnabled = !this.screenShakeEnabled;
    let nextSettings = { ...this.battleSettings };
    if (key === "aimAssist") nextSettings.aimAssist = this.aimAssistEnabled;
    if (key === "screenShake") nextSettings.screenShake = this.screenShakeEnabled;
    if (key === "sfx") nextSettings = toggleAudioMute(nextSettings, "sfxVolume");
    this.battleSettings = nextSettings;
    void services.save.update((draft) => {
      draft.settings = { ...nextSettings };
    }).catch((error: unknown) => {
      addToast(this, error instanceof Error ? error.message : "빠른 설정을 저장하지 못했습니다", COLORS.red);
    });
    if (key === "sfx") refreshAudioSettings(this);
    this.renderPauseMenu();
  }

  private resumeBattle(): void {
    if (!this.pauseOpen) return;
    for (const object of this.pauseObjects) object.destroy();
    this.pauseObjects = [];
    this.pauseOpen = false;
    setUiFocusScope(this, "base", "battle-open-pause");
    this.time.paused = false;
    this.tweens.resumeAll();
    this.hintText.setText(this.idleAimHint(this.runtime.getSnapshot()));
  }

  private bindInput(): void {
    const handlePointerDown = (pointer: Phaser.Input.Pointer, canStartAim: boolean): void => {
      if (this.aimDrag.cancelForAlternatePointer(pointer.id)) {
        this.presentAimCancellation("터치 조준 취소 · 다시 당겨 발사하세요");
        return;
      }
      if (pointer.button === 2) {
        if (this.pendingSkillPlacement) {
          this.cancelSkillPlacement();
          playSfx(this, "sfx-ui-cancel", 0.42);
          addToast(this, "스킬 배치를 취소했습니다", COLORS.teal);
          return;
        }
        if (this.aimDrag.cancelForSecondaryButton(pointer.button)) {
          this.presentAimCancellation("조준 취소 · 다시 당겨 발사하세요");
        }
        return;
      }
      if (pointer.button !== 0 || !canStartAim) return;
      this.lastPointerPower = 0;
      if (this.enemyPresentationActive) {
        this.hintText.setText("적의 행동이 끝난 뒤 조준할 수 있습니다");
        return;
      }
      if (this.pendingSkillPlacement) {
        this.handleSkillPlacement(pointer);
        return;
      }
      const snapshot = this.runtime.getSnapshot();
      if (snapshot.phase !== "awaitingAim" && snapshot.phase !== "aiming") return;
      const availability = this.runtime.getActionAvailability();
      if (!availability.allowed) {
        const message = availability.reason === "stun"
          ? "기절 상태 · 이번 차례에는 행동할 수 없습니다"
          : "현재는 행동할 수 없습니다";
        this.hintText.setText(message);
        addToast(this, message, COLORS.red);
        playSfx(this, "sfx-ui-error", 0.38, 0.92);
        return;
      }
      if (!isBattleArenaPointerY(pointer.y, 12)) return;
      const actor = snapshot.party[snapshot.activePartyIndex];
      if (!actor || !canStartAimFromActor(
        { x: pointer.x, y: pointer.y },
        { x: actor.position.x, y: actor.position.y + ARENA_Y },
        this.heroPresentationRadius(snapshot, actor),
      )) {
        this.hintText.setText("현재 차례 고양이를 잡고 뒤로 당겨 발사하세요");
        return;
      }
      if (!this.aimDrag.start(pointer.id, pointer.button)) return;
      this.captureAimPointer(pointer);
      this.gamepadAimActive = false;
      this.aimStart = { x: pointer.x, y: pointer.y };
      this.aimPullOffset = { x: 0, y: 0 };
      this.updateAim(pointer);
    };
    const handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
      if (!this.aimDrag.release(pointer.id)) return;
      this.releaseAimPointer();
      if (this.lastPointerPower < 0.08) {
        this.runtime.clearAim();
        this.preview.clear();
        this.resetAimPresentation();
        return;
      }
      const launched = this.runtime.launch();
      this.preview.clear();
      this.resetAimPresentation();
      this.hintText.setText(launched ? "충돌 경로 계산 중…" : "캐릭터를 뒤로 당겨 발사하세요");
    };

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => handlePointerDown(pointer, true));
    this.input.on("pointerdownoutside", (pointer: Phaser.Input.Pointer) => handlePointerDown(pointer, false));
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.aimDrag.tracks(pointer.id)) this.updateAim(pointer);
    });
    this.input.on("pointerup", handlePointerUp);
    this.input.on("pointerupoutside", handlePointerUp);
    const handleCancelInput = (event?: KeyboardEvent): void => {
      if (this.pendingSkillPlacement) {
        event?.preventDefault();
        this.cancelSkillPlacement();
        addToast(this, "스킬 배치를 취소했습니다", COLORS.teal);
        return;
      }
      if (this.gamepadAimActive) {
        event?.preventDefault();
        this.presentAimCancellation("게임패드 조준 취소 · 다시 조준하세요");
        return;
      }
      if (this.aimDrag.cancel()) {
        event?.preventDefault();
        this.presentAimCancellation("Esc 조준 취소 · 다시 당겨 발사하세요");
        return;
      }
      if (this.pauseOpen) this.resumeBattle();
      else this.showPauseMenu();
    };
    const handleKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" && event.key !== "Backspace") return;
      handleCancelInput(event);
    };
    const handleGamepad = (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button): void => {
      if (button.index === 0) {
        if (this.pendingSkillPlacement && this.gamepadSkillCursor) {
          this.handleSkillPlacementAt(this.gamepadSkillCursor);
          return;
        }
        if (this.gamepadAimActive) {
          const launched = this.lastPointerPower >= 0.08 && this.runtime.launch();
          this.preview.clear();
          this.resetAimPresentation();
          this.hintText.setText(launched ? "충돌 경로 계산 중…" : "왼쪽 스틱으로 조준하세요");
          return;
        }
      }
      if (button.index === 1) handleCancelInput();
    };
    this.input.keyboard?.on("keydown", handleKeyboard);
    this.input.gamepad?.on("down", handleGamepad);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown", handleKeyboard);
      this.input.gamepad?.off("down", handleGamepad);
    });
  }

  private presentAimCancellation(message: string): void {
    this.releaseAimPointer();
    this.lastPointerPower = 0;
    this.runtime.clearAim();
    this.preview.clear();
    this.resetAimPresentation();
    this.hintText.setText(message);
    playSfx(this, "sfx-ui-cancel", 0.42);
    addToast(this, "조준을 취소했습니다", COLORS.teal);
  }

  private captureAimPointer(pointer: Phaser.Input.Pointer): void {
    const pointerId = Number((pointer.event as PointerEvent | undefined)?.pointerId);
    if (!Number.isFinite(pointerId)) return;
    try {
      this.game.canvas.setPointerCapture(pointerId);
      this.capturedDomPointerId = pointerId;
    } catch {
      this.capturedDomPointerId = undefined;
    }
  }

  private releaseAimPointer(): void {
    const pointerId = this.capturedDomPointerId;
    this.capturedDomPointerId = undefined;
    if (pointerId === undefined) return;
    try {
      if (this.game.canvas.hasPointerCapture(pointerId)) this.game.canvas.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already have ended after a window-level release.
    }
  }

  private requestTutorialCoachmark(id: TutorialCoachmarkId): void {
    if (this.ended || this.requestedTutorialCoachmarks.has(id)) return;
    const services = getServices();
    const snapshot = this.runtime.getSnapshot();
    const context = {
      stageId: this.stage.id,
      modifierIds: this.stage.modifiers,
      partySize: snapshot.party.length,
    };
    const save = services.save.getSnapshot();
    if (!shouldOfferTutorialCoachmark(save, id, context)) return;

    this.requestedTutorialCoachmarks.add(id);
    this.tutorialCoachmarkQueue.push(id);
    this.showNextTutorialCoachmark();
    void services.save.update((draft) => {
      if (shouldOfferTutorialCoachmark(draft, id, context)) markTutorialCoachmarkSeen(draft, id);
    }).catch(() => {
      // The in-memory request set still prevents repetition during this battle.
      // A future battle may retry persistence safely.
    });
  }

  private showNextTutorialCoachmark(): void {
    if (this.tutorialCoachmarkActive || this.ended) return;
    const id = this.tutorialCoachmarkQueue.shift();
    if (!id) return;
    const content = TUTORIAL_COACHMARK_CONTENT[id];
    this.tutorialCoachmarkActive = true;
    const overlay = BATTLE_HUD_LAYOUT.coachmarkOverlay;
    const copyX = overlay.x + 22;
    const panel = addPanel(this, overlay.x, overlay.y, overlay.width, overlay.height, COLORS.gold, 0.992).setDepth(760);
    const eyebrow = this.add.text(copyX, overlay.y + 12, "실전 코치 · 한 번만 표시", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(10)}px`, color: "#8fe1d8",
    }).setDepth(761);
    const title = this.add.text(copyX, overlay.y + 33, content.title, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: "#f4d27d",
    }).setDepth(761);
    const body = this.add.text(copyX, overlay.y + 61, content.body, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(11)}px`, lineSpacing: 3, color: "#d4e2dc",
      wordWrap: { width: overlay.width - 44, useAdvancedWrap: true },
    }).setDepth(761);
    this.tutorialCoachmarkObjects = [panel, eyebrow, title, body];
    if (content.inputHint) {
      this.tutorialCoachmarkObjects.push(this.add.text(copyX, overlay.y + overlay.height - 10, content.inputHint, {
        fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(9)}px`, color: "#9fd8d2",
        wordWrap: { width: overlay.width - 44, useAdvancedWrap: true },
      }).setOrigin(0, 1).setDepth(761));
    }
    this.tutorialCoachmarkTimer = this.time.delayedCall(4200, () => this.dismissTutorialCoachmark());
  }

  private dismissTutorialCoachmark(): void {
    const timer = this.tutorialCoachmarkTimer;
    this.tutorialCoachmarkTimer = undefined;
    timer?.remove(false);
    for (const object of this.tutorialCoachmarkObjects) object.destroy();
    this.tutorialCoachmarkObjects = [];
    this.tutorialCoachmarkActive = false;
    this.showNextTutorialCoachmark();
  }

  private updateAim(pointer: Phaser.Input.Pointer): void {
    const snapshot = this.runtime.getSnapshot();
    const actor = snapshot.party[snapshot.activePartyIndex];
    if (!actor || !this.aimStart) return;
    const pull = resolveAimPull(this.aimStart, { x: pointer.x, y: pointer.y });
    if (!pull) {
      this.lastPointerPower = 0;
      this.aimPullOffset = { x: 0, y: 0 };
      this.runtime.clearAim();
      this.preview.clear();
      return;
    }
    this.lastPointerPower = pull.power;
    this.aimPullOffset = { ...pull.displayOffset };
    const result = this.runtime.setAim({ direction: pull.direction, power: pull.power });
    if (result) {
      this.drawPreview(result.trajectory);
      this.requestTutorialCoachmark("first-aim");
    }
    this.hintText.setText(this.aimingHint(snapshot, pull.power));
  }

  private updateGamepadTargeting(snapshot: BattleSnapshot, delta: number): void {
    const pad = this.input.gamepad?.pad1;
    if (!pad || this.enemyPresentationActive || this.pauseOpen || this.ended) return;
    const stickX = pad.leftStick?.x ?? 0;
    const stickY = pad.leftStick?.y ?? 0;
    const magnitude = Math.hypot(stickX, stickY);

    if (this.pendingSkillPlacement) {
      const actor = snapshot.party.find((entry) => entry.id === this.pendingSkillPlacement?.actorId)
        ?? snapshot.party[snapshot.activePartyIndex];
      this.gamepadSkillCursor ??= {
        x: actor?.position.x ?? W / 2,
        y: Phaser.Math.Clamp((actor?.position.y ?? ARENA_H * 0.7) - 150, 52, ARENA_H - 52),
      };
      if (magnitude > 0.18) {
        const speed = 430 * Math.min(1, magnitude) * Math.min(0.05, Math.max(0, delta / 1000));
        this.gamepadSkillCursor.x = Phaser.Math.Clamp(this.gamepadSkillCursor.x + stickX / magnitude * speed, 24, W - 24);
        this.gamepadSkillCursor.y = Phaser.Math.Clamp(this.gamepadSkillCursor.y + stickY / magnitude * speed, 24, ARENA_H - 24);
      }
      const radius = this.pendingSkillPlacement.kind === "portal-pair" ? 34 : 42;
      const valid = this.isSkillPlacementOpen(
        this.gamepadSkillCursor,
        radius,
        this.pendingSkillPlacement.firstPosition,
      );
      if (!this.gamepadPlacementCursor) {
        this.gamepadPlacementCursor = this.add.circle(0, 0, radius, 0x8de1d8, 0.14).setDepth(238);
      }
      this.gamepadPlacementCursor
        .setPosition(this.gamepadSkillCursor.x, this.gamepadSkillCursor.y + ARENA_Y)
        .setRadius(radius)
        .setFillStyle(valid ? 0x8de1d8 : 0xe66d5d, 0.14)
        .setStrokeStyle(4, valid ? 0xb8fff2 : 0xff9f8e, 0.92)
        .setVisible(true);
      this.hintText.setText("왼쪽 스틱으로 위치 이동 · A 선택 · B 취소");
      return;
    }

    this.gamepadPlacementCursor?.setVisible(false);
    if (this.aimDrag.active || (snapshot.phase !== "awaitingAim" && snapshot.phase !== "aiming")) return;
    if (magnitude <= 0.18) return;
    const power = Phaser.Math.Clamp((magnitude - 0.18) / 0.82, 0.08, 1);
    const direction = { x: stickX / magnitude, y: stickY / magnitude };
    this.gamepadAimActive = true;
    setUiFocusScope(this, "battle-aim");
    this.aimStart = undefined;
    this.lastPointerPower = power;
    this.aimPullOffset = { x: -direction.x * 92 * power, y: -direction.y * 92 * power };
    const result = this.runtime.setAim({ direction, power });
    if (result) this.drawPreview(result.trajectory);
    this.hintText.setText(`패드 조준 ${Math.round(power * 100)}% · A 발사 · B 취소`);
  }

  private resetAimPresentation(): void {
    this.releaseAimPointer();
    this.aimStart = undefined;
    this.aimPullOffset = { x: 0, y: 0 };
    this.gamepadAimActive = false;
    if (!this.pauseOpen && !this.pendingSkillPlacement) setUiFocusScope(this, "base", "battle-open-pause");
    this.aimElastic?.clear();
  }

  private drawPreview(trajectory: BattleTrajectory): void {
    this.preview.clear();
    if (!this.aimAssistEnabled) return;
    const snapshot = this.runtime.getSnapshot();
    const actor = snapshot.party[snapshot.activePartyIndex];
    const activeEffects = actor ? snapshot.effects.filter((effect) => effect.targetId === actor.id) : [];
    const visibleReflections = effectivePreviewReflections(this.previewReflections, activeEffects, 6);
    if (visibleReflections <= 0) return;
    const presentationSegments = trajectory.segments.map((segment) => ({
      from: segment.from,
      to: segment.to,
      bounceAfter: trajectory.contacts.some((contact) =>
        contact.response === "bounce"
        && Math.abs(contact.elapsedTime - segment.endTime) <= 0.0001),
    }));
    const guide = buildLimitedTrajectoryPreview(presentationSegments, {
      initialLength: visibleReflections > 0 ? 560 : 300,
      visibleReflections,
      reflectedLength: visibleReflections > this.previewReflections ? 260 : 150,
    });
    const settings = this.battleSettings;
    const palette = this.semanticPalette;
    for (const dot of guide.dots) {
      const radius = dot.reflected ? 3 : 4;
      if (settings.highContrast) {
        this.preview.fillStyle(0x000000, 0.9).fillCircle(dot.x, dot.y + ARENA_Y, radius + 3);
      }
      this.preview.fillStyle(palette.trajectory, dot.reflected ? 0.58 : 0.96)
        .fillCircle(dot.x, dot.y + ARENA_Y, radius);
    }
    if (guide.firstBounce) {
      if (settings.highContrast) this.preview.lineStyle(6, 0x000000, 0.9).strokeCircle(guide.firstBounce.x, guide.firstBounce.y + ARENA_Y, 11);
      this.preview.lineStyle(settings.highContrast ? 4 : 2, palette.objective, 0.94).strokeCircle(guide.firstBounce.x, guide.firstBounce.y + ARENA_Y, 9);
      this.preview.fillStyle(palette.objective, 1).fillCircle(guide.firstBounce.x, guide.firstBounce.y + ARENA_Y, 3);
    }
    this.drawScenePreviewAnnotations(snapshot, trajectory, visibleReflections);
  }

  private drawScenePreviewAnnotations(
    snapshot: BattleSnapshot,
    trajectory: BattleTrajectory,
    visibleReflections: number,
  ): void {
    const palette = this.semanticPalette;
    const tutorialMode = this.sceneModifierIdentifier(snapshot, "tutorialMode");
    if (tutorialMode === "direct-hit") {
      const directTarget = trajectory.contacts.find((contact) => contact.hitAccepted
        && contact.bounceIndex === 0
        && (contact.targetKind === "enemy" || contact.targetKind === "weakpoint"));
      if (directTarget) {
        const y = directTarget.position.y + ARENA_Y;
        this.preview.lineStyle(3, palette.objective, 0.96)
          .strokeCircle(directTarget.position.x, y, 15)
          .lineBetween(directTarget.position.x - 21, y, directTarget.position.x + 21, y)
          .lineBetween(directTarget.position.x, y - 21, directTarget.position.x, y + 21);
      }
    }

    for (const contact of trajectory.contacts) {
      if (!contact.hitAccepted || contact.targetKind !== "weakpoint" || contact.bounceIndex > visibleReflections) continue;
      const owner = snapshot.enemies.find((enemy) => enemy.weakpoints.some((weakpoint) => weakpoint.id === contact.targetId));
      const revealed = owner && snapshot.effects.some((effect) => effect.targetId === owner.id && effect.kind === "reveal-weakpoint");
      if (!revealed && tutorialMode !== "direct-hit") continue;
      const y = contact.position.y + ARENA_Y;
      this.preview.lineStyle(3, palette.objective, 0.92).strokeCircle(contact.position.x, y, 12);
      this.preview.fillStyle(palette.objective, 0.94).fillCircle(contact.position.x, y, 4);
      break;
    }

    const exitLimit = Math.max(0, Math.round(this.sceneModifierNumber(snapshot, "portalPreviewExitCount", 0)));
    if (exitLimit <= 0) return;
    const shownExits = new Set<string>();
    for (const contact of trajectory.contacts) {
      if (shownExits.size >= exitLimit || contact.targetKind !== "hazard") continue;
      const portal = snapshot.hazards.find((hazard) => hazard.id === contact.targetId && hazard.type === "portal");
      const pairId = portal ? String(portal.parameters.pairId ?? "") : "";
      const exit = snapshot.hazards.find((hazard) => hazard.id === pairId && hazard.type === "portal");
      if (!exit || shownExits.has(exit.id)) continue;
      shownExits.add(exit.id);
      const exitY = exit.position.y + ARENA_Y;
      const contactY = contact.position.y + ARENA_Y;
      this.preview.lineStyle(2, palette.trajectory, 0.7).lineBetween(contact.position.x, contactY, exit.position.x, exitY);
      this.preview.lineStyle(3, palette.objective, 0.96).strokeCircle(exit.position.x, exitY, exit.radius + 8);
      this.preview.lineStyle(2, palette.trajectory, 0.82).strokeCircle(exit.position.x, exitY, Math.max(8, exit.radius - 6));
      this.preview.fillStyle(palette.objective, 0.95).fillCircle(exit.position.x, exitY, 4);
    }
  }

  private activeSceneModifier(snapshot: BattleSnapshot, flag: string): BattleSnapshot["modifiers"][number] | undefined {
    return snapshot.modifiers.find((modifier) => modifier.active && modifier.flag === flag);
  }

  private hasSceneModifier(snapshot: BattleSnapshot, flag: string): boolean {
    return Boolean(this.activeSceneModifier(snapshot, flag));
  }

  private sceneModifierNumber(snapshot: BattleSnapshot, flag: string, fallback = 0): number {
    const value = this.activeSceneModifier(snapshot, flag)?.parameter?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  private sceneModifierIdentifier(snapshot: BattleSnapshot, flag: string): string | undefined {
    const value = this.activeSceneModifier(snapshot, flag)?.parameter?.value;
    return typeof value === "string" ? value : undefined;
  }

  private resolvePreviewReflections(snapshot: BattleSnapshot): number {
    if (!this.aimAssistEnabled) return 0;
    const authoredLimit = this.sceneModifierNumber(snapshot, "previewBounceLimit", 1);
    const relicBonus = Math.max(0, Math.round(this.runtime.getRelicEffectValue("preview-bounces")));
    return Phaser.Math.Clamp(Math.round(authoredLimit) + relicBonus, 0, 6);
  }

  private sceneRuleSummary(snapshot: BattleSnapshot): string {
    const labels: string[] = [...this.endgameRuleLabels.slice(0, 3)];
    const tutorialMode = this.sceneModifierIdentifier(snapshot, "tutorialMode");
    if (tutorialMode === "direct-hit") labels.push("직격 훈련 · 첫 적중 표식");
    if (this.hasSceneModifier(snapshot, "previewBounceLimit") && this.aimAssistEnabled) labels.push(`예상 반사 ${this.resolvePreviewReflections(snapshot)}회`);
    const portalExits = this.sceneModifierNumber(snapshot, "portalPreviewExitCount", 0);
    if (portalExits > 0) labels.push(`차원문 출구 ${Math.round(portalExits)}개 예고`);
    if (this.hasSceneModifier(snapshot, "excludeCattleFromAutoTarget")) labels.push("보호 대상 자동 조준 제외");
    if (this.hasSceneModifier(snapshot, "disableControlLock")) labels.push("자유 조준 · 조작 잠금 없음");
    if (this.hasSceneModifier(snapshot, "showOneWayWallArrows")) labels.push("일방벽 통과 방향 표시");
    if (this.hasSceneModifier(snapshot, "showSuctionVector")) labels.push("흡입 방향 표시");
    if (
      this.hasSceneModifier(snapshot, "showWindVector")
      || this.hasSceneModifier(snapshot, "showHazardVector")
      || this.runtime.getRelicEffectValue("hazard-vector-visible") > 0
    ) labels.push("환경 벡터 표시");
    if (this.hasSceneModifier(snapshot, "showSlowField")) labels.push("감속 범위 표시");
    if (snapshot.effects.some((effect) => effect.kind === "reveal-weakpoint")) labels.push("약점 궤적 표식 활성");
    return labels.join("  ·  ");
  }

  private idleAimHint(snapshot: BattleSnapshot): string {
    const availability = this.runtime.getActionAvailability();
    if (!availability.allowed && availability.reason === "stun") return "기절 상태 · 이번 차례를 넘깁니다";
    if (!this.aimAssistEnabled) return "조준 보조 꺼짐 · 캐릭터를 뒤로 당겨 발사하세요";
    if (this.sceneModifierIdentifier(snapshot, "tutorialMode") === "direct-hit") return "황금 직격 표식을 맞추도록 뒤로 당겨 보세요";
    if (this.sceneModifierNumber(snapshot, "portalPreviewExitCount", 0) > 0) return "청록색 차원문 출구 표식을 확인하고 발사하세요";
    if (this.hasSceneModifier(snapshot, "disableControlLock")) return "자유 조준 · 캐릭터를 뒤로 당겨 발사하세요";
    return "캐릭터를 뒤로 당겨 발사하세요";
  }

  private aimingHint(snapshot: BattleSnapshot, power: number): string {
    const prefix = this.sceneModifierIdentifier(snapshot, "tutorialMode") === "direct-hit"
      ? "직격 표식 확인"
      : this.sceneModifierNumber(snapshot, "portalPreviewExitCount", 0) > 0
        ? "출구 표식 확인"
        : "자유 조준";
    return `${prefix}  ·  발사 강도 ${Math.round(power * 100)}%  ·  놓아서 출격  ·  우클릭 취소`;
  }

  private syncViews(snapshot: BattleSnapshot): void {
    const semanticPalette = this.semanticPalette;
    const semanticSettings = this.battleSettings;
    const enemyIds = snapshot.enemies.filter((enemy) => enemy.alive).map((enemy) => enemy.id);
    const enemyPlan = reconcileViewIds(this.enemyViews.keys(), enemyIds);
    for (const enemyId of enemyPlan.create) {
      const enemy = snapshot.enemies.find((entry) => entry.id === enemyId);
      if (enemy) this.ensureEnemyView(enemy, snapshot);
    }
    for (const enemyId of enemyPlan.remove) this.retireEnemyView(enemyId);

    const active = snapshot.party[snapshot.activePartyIndex];
    this.activeMarker.clear();
    this.aimElastic.clear();
    this.redirectLinks.clear();
    for (const hero of snapshot.party) {
      const view = this.heroViews.get(hero.id);
      if (!view) continue;
      const presentationRadius = this.heroPresentationRadius(snapshot, hero);
      this.syncActorPresentationRadius(view.body, hero.radius, presentationRadius);
      const projectile = snapshot.projectile?.actorId === hero.id ? snapshot.projectile : undefined;
      const motionActive = this.heroMotionTweens.has(hero.id);
      if (projectile) this.displayedHeroPositions.set(hero.id, { ...projectile.position });
      else if (!this.enemyPresentationActive && !motionActive) this.displayedHeroPositions.set(hero.id, { ...hero.position });
      if (!this.enemyPresentationActive) {
        this.displayedHeroHp.set(hero.id, hero.hp);
        this.displayedHeroAlive.set(hero.id, hero.alive);
      }
      const displayedAlive = this.displayedHeroAlive.get(hero.id) ?? hero.alive;
      const motionPosition = this.displayedHeroPositions.get(hero.id) ?? hero.position;
      const isAiming = active?.id === hero.id
        && (this.aimDrag.active || this.gamepadAimActive)
        && !this.enemyPresentationActive
        && (snapshot.phase === "awaitingAim" || snapshot.phase === "aiming");
      const displayedPosition = projectile?.position ?? (isAiming
        ? { x: hero.position.x + this.aimPullOffset.x, y: hero.position.y + this.aimPullOffset.y }
        : motionPosition);
      const airborne = Boolean(projectile || motionActive);
      const baseScaleX = Number(view.body.getData("baseScaleX")) || view.body.scaleX;
      const baseScaleY = Number(view.body.getData("baseScaleY")) || view.body.scaleY;
      if (projectile) {
        const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
        const stretch = Phaser.Math.Clamp(speed / 7_000, 0.02, 0.15);
        view.body
          .setData("ricochetFlight", true)
          .setData("aimPull", false)
          .setAngle(Phaser.Math.RadToDeg(Math.atan2(projectile.velocity.y, projectile.velocity.x)) + 90)
          .setScale(baseScaleX * (1 - stretch * 0.35), baseScaleY * (1 + stretch));
      } else if (view.body.getData("ricochetFlight")) {
        view.body.setData("ricochetFlight", false).setAngle(0).setScale(baseScaleX, baseScaleY);
      }
      if (isAiming) {
        const compression = this.lastPointerPower * 0.045;
        view.body.setData("aimPull", true).setAngle(0).setScale(baseScaleX * (1 + compression), baseScaleY * (1 - compression));
        this.drawAimPullGuide(hero.position, displayedPosition, this.lastPointerPower);
      } else if (!projectile && view.body.getData("aimPull")) {
        view.body.setData("aimPull", false).setAngle(0).setScale(baseScaleX, baseScaleY);
      }
      view.body.setPosition(displayedPosition.x, displayedPosition.y + ARENA_Y).setAlpha(displayedAlive ? 1 : 0.28);
      const semanticPosition = isAiming ? hero.position : displayedPosition;
      this.drawSemanticActorRing(
        view.semantic,
        semanticPosition.x,
        semanticPosition.y + ARENA_Y,
        presentationRadius + 7,
        "ally",
        displayedAlive,
        active?.id === hero.id,
        semanticPalette.ally,
        semanticPalette.outline,
        semanticSettings.highContrast,
        semanticSettings.colorVision !== "off",
      );
      view.name.setPosition(semanticPosition.x, semanticPosition.y + ARENA_Y - presentationRadius - 35)
        .setAlpha(airborne ? 0 : displayedAlive ? 1 : 0.35)
        .setColor(active?.id === hero.id ? "#fff0a6" : "#d9f5ef");
      view.hp.clear();
      const hpWidth = Math.max(76, presentationRadius * 2.25);
      const hpY = semanticPosition.y + ARENA_Y - presentationRadius - 19;
      const displayedHp = Phaser.Math.Clamp(this.displayedHeroHp.get(hero.id) ?? hero.hp, 0, hero.maxHp);
      const hpRatio = hero.maxHp > 0 ? Phaser.Math.Clamp(displayedHp / hero.maxHp, 0, 1) : 0;
      const hpColor = hpRatio > 0.55 ? semanticPalette.ally : hpRatio > 0.25 ? semanticPalette.objective : semanticPalette.danger;
      if (!airborne) {
        view.hp.fillStyle(0x051014, 0.96).fillRoundedRect(semanticPosition.x - hpWidth / 2, hpY, hpWidth, 10, 4);
        view.hp.fillStyle(hpColor, displayedAlive ? 1 : 0.35).fillRoundedRect(semanticPosition.x - hpWidth / 2 + 2, hpY + 2, Math.max(0, (hpWidth - 4) * hpRatio), 6, 3);
      }
      const statusPresentation = selectBattleStatusEffects(
        snapshot.effects.filter((effect) => effect.targetId === hero.id),
        2,
      );
      const effects = statusPresentation.visible;
      const guard = effects.find((effect) => effect.kind === "projectile-guard");
      this.drawHeroGuard(view.guard, displayedPosition.x, displayedPosition.y + ARENA_Y, presentationRadius, guard?.remainingTurns);
      view.status.setPosition(semanticPosition.x, semanticPosition.y + ARENA_Y + presentationRadius + 7)
        .setText([
          ...effects.map((effect) => this.effectStatusLabel(effect)),
          statusPresentation.hiddenCount > 0 ? `+${statusPresentation.hiddenCount}` : "",
        ].filter(Boolean).join("  ·  "))
        .setAlpha(airborne ? 0 : displayedAlive ? 1 : 0.3);
      if (
        active?.id === hero.id
        && hero.alive
        && !this.enemyPresentationActive
        && (snapshot.phase === "awaitingAim" || snapshot.phase === "aiming")
      ) {
        this.drawActiveTurnMarker(hero.position.x, hero.position.y + ARENA_Y - presentationRadius - 51);
      }
    }
    this.drawDamageRedirectLinks(snapshot);
    for (const enemy of snapshot.enemies) {
      if (!enemy.alive) {
        this.retireEnemyView(enemy.id);
        continue;
      }
      const view = this.ensureEnemyView(enemy, snapshot);
      if (!view) continue;
      const presentationRadius = this.enemyPresentationRadius(snapshot, enemy);
      this.syncActorPresentationRadius(view.body, enemy.radius, presentationRadius);
      const displayedPosition = this.enemyPresentationActive
        ? this.displayedEnemyPositions.get(enemy.id) ?? enemy.position
        : enemy.position;
      if (!this.enemyPresentationActive) {
        this.displayedEnemyPositions.set(enemy.id, { ...enemy.position });
        this.displayedEnemyHp.set(enemy.id, enemy.hp);
      }
      view.body.setPosition(displayedPosition.x, displayedPosition.y + ARENA_Y).setAlpha(1);
      this.drawSemanticActorRing(
        view.semantic,
        displayedPosition.x,
        displayedPosition.y + ARENA_Y,
        presentationRadius + 7,
        "enemy",
        true,
        Boolean(enemy.elite),
        semanticPalette.enemy,
        semanticPalette.outline,
        semanticSettings.highContrast,
        semanticSettings.colorVision !== "off",
      );
      view.name.setPosition(displayedPosition.x, displayedPosition.y + ARENA_Y - presentationRadius - 34).setAlpha(1);
      view.hp.clear();
      const y = displayedPosition.y + ARENA_Y - presentationRadius - 18;
      const width = enemy.elite ? Math.max(122, presentationRadius * 2.4) : Math.max(86, presentationRadius * 2.25);
      const displayedHp = Phaser.Math.Clamp(this.displayedEnemyHp.get(enemy.id) ?? enemy.hp, 0, enemy.maxHp);
      view.hp.fillStyle(0x061015, 0.95).fillRoundedRect(displayedPosition.x - width / 2, y, width, 9, 4);
      view.hp.fillStyle(displayedHp / enemy.maxHp > 0.35 ? semanticPalette.enemy : semanticPalette.danger, 1).fillRoundedRect(displayedPosition.x - width / 2 + 2, y + 2, Math.max(0, (width - 4) * displayedHp / enemy.maxHp), 5, 3);
      this.drawEnemyFacing(view.facing, { ...enemy, position: displayedPosition, radius: presentationRadius }, snapshot);
      const displayDelta = {
        x: displayedPosition.x - enemy.position.x,
        y: displayedPosition.y - enemy.position.y,
      };
      for (const weakpoint of enemy.weakpoints) {
        const eye = this.weakpointViews.get(weakpoint.id);
        const partHp = this.weakpointHpViews.get(weakpoint.id);
        const objectiveTarget = snapshot.objective.targets.find(
          (target) => target.kind === "bossPart"
            && (target.id === weakpoint.id || target.sourceId === weakpoint.partId),
        );
        const revealed = snapshot.effects.some((effect) => effect.targetId === enemy.id && effect.kind === "reveal-weakpoint");
        const tutorialPreview = this.sceneModifierIdentifier(snapshot, "tutorialMode") === "direct-hit";
        const hiddenOrder = this.hideCrystalOrderAfterFirst
          && snapshot.objective.current > 0
          && Boolean(objectiveTarget);
        const visible = !weakpoint.broken && (objectiveTarget?.active ?? true) && !hiddenOrder;
        const weakpointX = weakpoint.position.x + displayDelta.x;
        const weakpointY = weakpoint.position.y + displayDelta.y + ARENA_Y;
        eye?.setPosition(weakpointX, weakpointY)
          .setVisible(visible)
          .setFillStyle(revealed ? 0xbaf06d : 0x8de057, revealed || tutorialPreview ? 0.86 : 0.55)
          .setStrokeStyle(revealed ? 5 : 3, revealed ? 0xffffff : 0xf2e279, revealed ? 1 : 0.9);
        partHp?.clear();
        if (partHp && visible && this.runtime.getRelicEffectValue("boss-part-hp-visible") > 0) {
          const width = Math.max(38, weakpoint.radius * 2.2);
          const ratio = weakpoint.maxHp > 0 ? Phaser.Math.Clamp(weakpoint.hp / weakpoint.maxHp, 0, 1) : 0;
          const barY = weakpointY + weakpoint.radius + 7;
          partHp.fillStyle(0x061015, 0.94).fillRoundedRect(weakpointX - width / 2, barY, width, 7, 3);
          partHp.fillStyle(ratio > 0.35 ? 0xbaf06d : 0xff9b6d, 1)
            .fillRoundedRect(weakpointX - width / 2 + 1, barY + 1, Math.max(0, (width - 2) * ratio), 5, 2);
        }
      }
    }
    this.syncEnemyTelegraphs(snapshot);
    this.syncStageObjects(snapshot);
    this.syncTurnBanner(snapshot);
    this.turnText.setText(battleTurnText(
      snapshot.turnNumber,
      this.stage.objective.turnLimit + Math.max(0, snapshot.rescueTurnLimitBonus),
      this.enemyPresentationActive ? this.enemyPresentationTurnNumber ?? Math.max(1, snapshot.turnNumber - 1) : undefined,
    ))
      .setFontSize(this.enemyPresentationActive ? this.enemyTurnFontSize : this.playerTurnFontSize);
    if (this.enemyPresentationActive) {
      const attacker = this.activeEnemyActorId ? this.enemyDisplayName(snapshot, this.activeEnemyActorId) : "적 선단";
      this.activeHeroText.setText([
        compactBattleHudLine(`${attacker} 공격 연출 중`, 21),
        "조준 잠김",
      ]).setColor("#ff9f8e");
    } else if (active) {
      const definition = HERO_BY_ID[active.definitionId];
      this.activeHeroText.setText([
        `HP ${Math.ceil(active.hp)} / ${active.maxHp}`,
        compactBattleHudLine(`접촉 · ${definition?.friendshipSkill.name ?? "우정 연계"}`, 21),
      ]).setColor("#8de1d8");
    }
    const progress = this.getObjectiveProgress(snapshot);
    this.objectiveText.setText(compactBattleHudLine(progress.label, 17));
    this.objectiveProgress.setText(objectiveProgressText(progress.current, progress.required));
    const ruleSummary = this.sceneRuleSummary(snapshot);
    this.sceneRuleText.setText(compactBattleHudLine(ruleSummary, 29)).setVisible(ruleSummary.length > 0);
    this.syncActiveSkillHud(snapshot);
    this.comboText.setText(snapshot.comboCount > 1
      ? `${snapshot.comboCount} 연타 · ${snapshot.ricochetCount} 반사`
      : snapshot.ricochetCount ? `${snapshot.ricochetCount} 반사` : "");
    if (!this.pendingSkillPlacement) {
      this.hintText.setText(this.enemyPresentationActive
        ? "적의 반격을 확인하세요"
        : snapshot.phase === "projectile"
        ? "항로 궤적 실행 중"
        : snapshot.phase === "awaitingAim" || snapshot.phase === "aiming"
          ? this.aimDrag.active ? this.aimingHint(snapshot, this.lastPointerPower) : this.idleAimHint(snapshot)
          : "적의 반격");
    }
  }

  private drawAimPullGuide(
    origin: { readonly x: number; readonly y: number },
    pulled: { readonly x: number; readonly y: number },
    power: number,
  ): void {
    const originY = origin.y + ARENA_Y;
    const pulledY = pulled.y + ARENA_Y;
    const dx = pulled.x - origin.x;
    const dy = pulledY - originY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const perpendicularX = -dy / length;
    const perpendicularY = dx / length;
    const spread = 8 + power * 6;
    this.aimElastic
      .lineStyle(7, 0x061014, 0.78)
      .lineBetween(origin.x + perpendicularX * spread, originY + perpendicularY * spread, pulled.x, pulledY)
      .lineBetween(origin.x - perpendicularX * spread, originY - perpendicularY * spread, pulled.x, pulledY)
      .lineStyle(3, 0xf1c967, 0.94)
      .lineBetween(origin.x + perpendicularX * spread, originY + perpendicularY * spread, pulled.x, pulledY)
      .lineBetween(origin.x - perpendicularX * spread, originY - perpendicularY * spread, pulled.x, pulledY)
      .fillStyle(0x8de1d8, 0.2)
      .fillCircle(origin.x, originY, 20 + power * 7)
      .lineStyle(2, 0x8de1d8, 0.78)
      .strokeCircle(origin.x, originY, 20 + power * 7);
  }

  private animateHeroPath(
    heroId: string,
    path: readonly { readonly x: number; readonly y: number }[],
    duration: number,
  ): void {
    if (path.length < 2) return;
    this.heroMotionTweens.get(heroId)?.stop();
    const view = this.heroViews.get(heroId);
    const lengths = path.slice(1).map((point, index) => Math.hypot(
      point.x - path[index]!.x,
      point.y - path[index]!.y,
    ));
    const totalLength = Math.max(0.001, lengths.reduce((sum, length) => sum + length, 0));
    const motion = { distance: 0 };
    this.displayedHeroPositions.set(heroId, { ...path[0]! });
    view?.body.setTint(0xf0d07a);
    const tween = this.tweens.add({
      targets: motion,
      distance: totalLength,
      duration: Math.max(1, duration),
      ease: "Cubic.Out",
      onUpdate: () => {
        let remaining = motion.distance;
        let segmentIndex = 0;
        while (segmentIndex < lengths.length - 1 && remaining > lengths[segmentIndex]!) {
          remaining -= lengths[segmentIndex]!;
          segmentIndex += 1;
        }
        const from = path[segmentIndex]!;
        const to = path[segmentIndex + 1] ?? from;
        const ratio = Phaser.Math.Clamp(remaining / Math.max(0.001, lengths[segmentIndex] ?? 1), 0, 1);
        this.displayedHeroPositions.set(heroId, {
          x: Phaser.Math.Linear(from.x, to.x, ratio),
          y: Phaser.Math.Linear(from.y, to.y, ratio),
        });
      },
      onComplete: () => {
        this.displayedHeroPositions.set(heroId, { ...path[path.length - 1]! });
        view?.body.clearTint();
        this.heroMotionTweens.delete(heroId);
      },
    });
    this.heroMotionTweens.set(heroId, tween);
  }

  private drawActiveTurnMarker(x: number, y: number): void {
    const palette = this.semanticPalette;
    const pulse = this.reducedMotion ? 0.94 : 0.76 + Math.sin(this.time.now / 145) * 0.18;
    this.activeMarker.fillStyle(0x071014, 0.86).fillTriangle(x - 18, y - 4, x + 18, y - 4, x, y + 17);
    this.activeMarker.fillStyle(palette.objective, pulse).fillTriangle(x - 13, y - 7, x + 13, y - 7, x, y + 11);
    this.activeMarker.lineStyle(3, palette.ally, 0.92)
      .lineBetween(x - 12, y - 15, x, y - 9)
      .lineBetween(x, y - 9, x + 12, y - 15);
  }

  private drawSemanticActorRing(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    kind: "ally" | "enemy",
    visible: boolean,
    emphasized: boolean,
    color: number,
    outline: number,
    highContrast: boolean,
    colorVisionActive: boolean,
  ): void {
    graphics.clear().setVisible(visible);
    if (!visible) return;
    const width = highContrast ? 5 : emphasized ? 4 : 3;
    if (highContrast) {
      graphics.lineStyle(width + 9, outline, 0.98);
      if (kind === "ally") graphics.strokeCircle(x, y, radius + 4);
      else this.drawDashedCircle(graphics, x, y, radius + 4, 12);
    }
    graphics.lineStyle(width + 4, 0x000000, highContrast ? 0.9 : 0.48);
    if (kind === "ally") graphics.strokeCircle(x, y, radius + 2);
    else this.drawDashedCircle(graphics, x, y, radius + 2, 12);
    graphics.lineStyle(width, color, !colorVisionActive && !highContrast ? 0.62 : 0.98);
    if (kind === "ally") {
      graphics.strokeCircle(x, y, radius);
      graphics.lineBetween(x - 7, y + radius + 7, x + 7, y + radius + 7)
        .lineBetween(x, y + radius, x, y + radius + 14);
    } else {
      this.drawDashedCircle(graphics, x, y, radius, 12);
      const markY = y - radius - 10;
      graphics.lineBetween(x - 6, markY - 6, x + 6, markY + 6)
        .lineBetween(x + 6, markY - 6, x - 6, markY + 6);
    }
  }

  private drawDashedCircle(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    segments: number,
  ): void {
    for (let index = 0; index < segments; index += 2) {
      const start = index * Math.PI * 2 / segments;
      const end = (index + 0.75) * Math.PI * 2 / segments;
      graphics.lineBetween(
        x + Math.cos(start) * radius,
        y + Math.sin(start) * radius,
        x + Math.cos(end) * radius,
        y + Math.sin(end) * radius,
      );
    }
  }

  private drawHeroGuard(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    heroRadius: number,
    remainingTurns: number | undefined,
  ): void {
    graphics.clear();
    if (remainingTurns === undefined || remainingTurns <= 0) return;
    const palette = this.semanticPalette;
    const radius = heroRadius + 15;
    const pulse = this.reducedMotion ? 0.8 : 0.68 + Math.sin(this.time.now / 190) * 0.12;
    graphics.fillStyle(palette.ally, 0.12).lineStyle(5, palette.ally, pulse);
    graphics.beginPath();
    for (let index = 0; index < 6; index += 1) {
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (index === 0) graphics.moveTo(px, py);
      else graphics.lineTo(px, py);
    }
    graphics.closePath().fillPath().strokePath();
    const badgeX = x + radius * 0.72;
    const badgeY = y - radius * 0.72;
    graphics.fillStyle(0x071014, 0.92).fillRoundedRect(badgeX - 13, badgeY - 11, 26, 22, 5);
    graphics.lineStyle(2, 0xb8f5ff, 0.95).strokeRoundedRect(badgeX - 13, badgeY - 11, 26, 22, 5);
    graphics.fillStyle(0xb8f5ff, 0.92).fillTriangle(badgeX, badgeY + 7, badgeX - 7, badgeY - 4, badgeX + 7, badgeY - 4);
  }

  private drawDamageRedirectLinks(snapshot: BattleSnapshot): void {
    for (const effect of snapshot.effects.filter((entry) => entry.kind === "damage-redirect" && entry.remainingTurns > 0)) {
      const protectedHero = snapshot.party.find((hero) => hero.id === effect.targetId && hero.alive);
      const redirectHero = snapshot.party
        .filter((hero) => hero.alive && hero.id !== effect.targetId)
        .sort((left, right) => right.hp - left.hp)[0];
      if (!protectedHero || !redirectHero) continue;
      const fromX = protectedHero.position.x;
      const fromY = protectedHero.position.y + ARENA_Y;
      const toX = redirectHero.position.x;
      const toY = redirectHero.position.y + ARENA_Y;
      this.redirectLinks.lineStyle(8, 0x24182f, 0.7).lineBetween(fromX, fromY, toX, toY);
      this.redirectLinks.lineStyle(3, 0xd7a5f2, 0.88).lineBetween(fromX, fromY, toX, toY);
      const middleX = (fromX + toX) / 2;
      const middleY = (fromY + toY) / 2;
      this.redirectLinks.fillStyle(0xd7a5f2, 0.95);
      this.redirectLinks.beginPath()
        .moveTo(middleX, middleY - 8)
        .lineTo(middleX + 8, middleY)
        .lineTo(middleX, middleY + 8)
        .lineTo(middleX - 8, middleY)
        .closePath()
        .fillPath();
    }
  }

  private drawEnemyFacing(
    graphics: Phaser.GameObjects.Graphics,
    enemy: BattleSnapshot["enemies"][number],
    snapshot: BattleSnapshot,
  ): void {
    graphics.clear();
    if (enemy.behaviorId !== "shield") return;
    const broken = snapshot.effects.some((effect) => effect.targetId === enemy.id && ["shield-break", "formation-broken"].includes(effect.kind));
    if (broken) return;
    const length = Math.hypot(enemy.facing.x, enemy.facing.y) || 1;
    const facingX = enemy.facing.x / length;
    const facingY = enemy.facing.y / length;
    const perpendicularX = -facingY;
    const perpendicularY = facingX;
    const centerX = enemy.position.x + facingX * (enemy.radius + 11);
    const centerY = enemy.position.y + ARENA_Y + facingY * (enemy.radius + 11);
    const half = Math.max(20, enemy.radius * 0.72);
    graphics.lineStyle(12, 0x211912, 0.9).lineBetween(
      centerX - perpendicularX * half,
      centerY - perpendicularY * half,
      centerX + perpendicularX * half,
      centerY + perpendicularY * half,
    );
    graphics.lineStyle(7, 0xd2a252, 0.95).lineBetween(
      centerX - perpendicularX * half,
      centerY - perpendicularY * half,
      centerX + perpendicularX * half,
      centerY + perpendicularY * half,
    );
  }

  private effectStatusLabel(effect: BattleSnapshot["effects"][number]): string {
    const label = effect.kind === "projectile-guard" ? "보호"
      : effect.kind === "regeneration" ? "재생"
        : this.effectLabel(effect.kind);
    const value = effect.kind === "projectile-guard"
      ? "피해 -35%"
      : effect.kind === "damage-redirect"
        ? `피해 ${Math.round(effect.value)}% 분담`
        : effect.kind === "regeneration"
          ? `+${Math.round(effect.value)}`
          : "";
    return `${label}${value ? ` ${value}` : ""} · ${effect.remainingTurns}턴`;
  }

  private syncTurnBanner(snapshot: BattleSnapshot): void {
    const active = snapshot.party[snapshot.activePartyIndex];
    const definition = active ? HERO_BY_ID[active.definitionId] : undefined;
    const isEnemyPhase = this.enemyPresentationActive || snapshot.phase === "retaliation";
    const isAction = !isEnemyPhase && snapshot.phase === "projectile";
    const accent = isEnemyPhase ? 0xe66d5d : isAction ? 0x72c6d5 : 0xf1c967;
    this.turnBanner.clear();
    this.turnBanner.fillStyle(0x041116, 0.98).fillRoundedRect(
      BATTLE_HUD_LAYOUT.turnRail.x,
      BATTLE_HUD_LAYOUT.turnRail.y,
      BATTLE_HUD_LAYOUT.turnRail.width,
      BATTLE_HUD_LAYOUT.turnRail.height,
      10,
    );
    this.turnBanner.lineStyle(2, accent, 0.82).strokeRoundedRect(
      BATTLE_HUD_LAYOUT.turnRail.x,
      BATTLE_HUD_LAYOUT.turnRail.y,
      BATTLE_HUD_LAYOUT.turnRail.width,
      BATTLE_HUD_LAYOUT.turnRail.height,
      10,
    );
    this.turnBanner.fillStyle(accent, 0.95).fillRoundedRect(
      BATTLE_HUD_LAYOUT.turnRail.x,
      BATTLE_HUD_LAYOUT.turnRail.y,
      6,
      BATTLE_HUD_LAYOUT.turnRail.height,
      3,
    );

    if (isEnemyPhase) {
      const enemyName = this.activeEnemyActorId
        ? this.enemyDisplayName(snapshot, this.activeEnemyActorId)
        : undefined;
      this.phaseBadgeText.setText("적 행동").setBackgroundColor("#d95d52").setColor("#fff7ef");
      this.currentTurnText.setText(compactBattleHudLine(enemyName ? `적의 행동 · ${enemyName}` : "적의 반격", 18)).setColor("#ffb5a7");
      this.nextTurnText.setText("붉은 조준선 · 공격 범위 확인").setColor("#d9a8a1");
      return;
    }

    const living = snapshot.party.filter((hero) => hero.alive);
    const activeLivingIndex = living.findIndex((hero) => hero.id === active?.id);
    const nextNames = living.length > 1
      ? Array.from({ length: living.length - 1 }, (_, offset) => living[(activeLivingIndex + offset + 1) % living.length])
        .filter((hero): hero is BattleSnapshot["party"][number] => Boolean(hero))
        .map((hero) => HERO_BY_ID[hero.definitionId]?.name ?? hero.definitionId)
      : [];
    this.phaseBadgeText
      .setText(isAction ? "발사 중" : "아군 차례")
      .setBackgroundColor(isAction ? "#4a9ead" : "#f1c967")
      .setColor("#071014");
    this.currentTurnText
      .setText(compactBattleHudLine(`${isAction ? "행동 중" : "현재 차례"} · ${definition?.name ?? active?.definitionId ?? "-"}`, 18))
      .setColor(isAction ? "#a9f3ff" : "#fff0b8");
    this.nextTurnText
      .setText(nextNames.length
        ? compactBattleHudLine(`다음 ${nextNames.slice(0, 2).join(" › ")}${nextNames.length > 2 ? " 외" : ""}`, 23)
        : "마지막 생존 캐릭터")
      .setColor("#9bb9b6");
  }

  private enemyDisplayName(snapshot: BattleSnapshot, enemyId: string): string {
    const enemy = snapshot.enemies.find((entry) => entry.id === enemyId);
    return enemy ? ENEMY_BY_ID[enemy.definitionId]?.name ?? enemy.definitionId : enemyId;
  }

  private showPlayerTurnBanner(snapshot: BattleSnapshot, delay = 0): void {
    if (this.enemyPresentationActive) {
      this.deferredPlayerTurnBanner = true;
      return;
    }
    const active = snapshot.party[snapshot.activePartyIndex];
    const name = active ? HERO_BY_ID[active.definitionId]?.name ?? active.definitionId : "";
    this.time.delayedCall(delay, () => {
      if (this.ended || this.enemyPresentationActive) return;
      this.showCombatPhaseBanner("아군 차례", `${name}의 차례`, 0xf1c967);
    });
  }

  private showCombatPhaseBanner(title: string, detail: string, accent: number): void {
    this.combatPhaseOverlay?.destroy(true);
    const overlay = BATTLE_HUD_LAYOUT.phaseOverlay;
    const backdrop = this.add.rectangle(0, 0, overlay.width, overlay.height, 0x041116, 0.98).setStrokeStyle(2, accent, 0.9);
    const titleText = this.add.text(-166, -13, title, {
      fontFamily: "Georgia, Malgun Gothic, serif", fontStyle: "bold", fontSize: `${uiTextSize(11)}px`, color: Phaser.Display.Color.IntegerToColor(accent).rgba,
    }).setOrigin(0, 0.5);
    const detailText = this.add.text(-166, 10, detail, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: "#fff7e8",
      wordWrap: { width: 330, useAdvancedWrap: true },
    }).setOrigin(0, 0.5);
    // Phase changes animate inside the dedicated footer rail instead of
    // obscuring actors, weak points, or enemy attack telegraphs.
    const container = this.add.container(
      overlay.x + overlay.width / 2,
      overlay.y + overlay.height / 2,
      [backdrop, titleText, detailText],
    ).setDepth(820).setAlpha(0).setScale(0.96);
    this.combatPhaseOverlay = container;
    if (this.reducedMotion) {
      container.setAlpha(1).setScale(1);
      this.time.delayedCall(420, () => {
        if (this.combatPhaseOverlay === container) this.combatPhaseOverlay = undefined;
        container.destroy(true);
      });
      return;
    }
    this.tweens.add({
      targets: container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 110,
      ease: "Back.Out",
      yoyo: true,
      hold: 360,
      onComplete: () => {
        if (this.combatPhaseOverlay === container) this.combatPhaseOverlay = undefined;
        container.destroy(true);
      },
    });
  }

  private syncActiveSkillHud(snapshot: BattleSnapshot): void {
    const active = snapshot.party[snapshot.activePartyIndex];
    if (!active) return;
    const definition = HERO_BY_ID[active.definitionId];
    if (!definition) return;
    const skillPreview = this.runtime.previewActiveSkill(active.id);
    if (!skillPreview) return;
    const skill = active.activeSkill;
    const canActivate = !this.enemyPresentationActive && skillPreview.ready && active.alive && (snapshot.phase === "awaitingAim" || snapshot.phase === "aiming");
    const signature = `${active.id}:${skillPreview.charge}:${skillPreview.requiredCharge}:${skillPreview.ready}:${skillPreview.blockedReason ?? ""}:${canActivate}:${skillPreview.skillName}`;
    if (signature !== this.activeSkillSignature) {
      this.activeSkillSignature = signature;
      this.activeSkillButton?.destroy(true);
      this.activeSkillButton = addButton(this, 548, 1242, skillPreview.ready ? `◆ ${skillPreview.skillName}` : skillPreview.skillName, {
        width: 318,
        height: 52,
        fontSize: 14,
        subtitle: skillPreview.blockedReason === "no_ally"
          ? "함께 발사할 동료 없음"
          : skillPreview.blockedReason === "no_fallen_ally"
            ? "구조할 전투불능 동료 없음"
            : skillPreview.ready ? "READY · 눌러서 발동" : `CHARGE ${skillPreview.charge} / ${skillPreview.requiredCharge}`,
        accent: skillPreview.ready ? 0x8de1d8 : 0x6c8c8b,
        enabled: canActivate,
        onClick: () => this.requestActiveSkill(active.id),
      }).setDepth(425);
    }
    const ratio = Phaser.Math.Clamp(skillPreview.charge / Math.max(1, skillPreview.requiredCharge), 0, 1);
    this.activeSkillGauge.clear();
    this.activeSkillGauge.fillStyle(0x071014, 0.96).fillRoundedRect(391, 1270, 314, 6, 3);
    this.activeSkillGauge.fillStyle(skillPreview.ready ? 0x9ff6e9 : 0x4f9d9b, 1).fillRoundedRect(393, 1272, Math.max(0, 310 * ratio), 2, 1);
  }

  private requestActiveSkill(actorId: string): void {
    const preview = this.runtime.previewActiveSkill(actorId);
    if (!preview?.ready) return;
    const placementKind = preview.effects.find(
      (effect) => effect.kind === "temporary-bumper" || effect.kind === "portal-pair",
    )?.kind;
    if (placementKind === "temporary-bumper" || placementKind === "portal-pair") {
      this.runtime.clearAim();
      this.preview.clear();
      this.resetAimPresentation();
      this.pendingSkillPlacement = { actorId, kind: placementKind };
      const actor = this.runtime.getSnapshot().party.find((entry) => entry.id === actorId);
      this.gamepadSkillCursor = {
        x: actor?.position.x ?? W / 2,
        y: Phaser.Math.Clamp((actor?.position.y ?? ARENA_H * 0.7) - 150, 52, ARENA_H - 52),
      };
      setUiFocusScope(this, "battle-placement");
      this.hintText.setText(
        placementKind === "portal-pair"
          ? "첫 번째 포털 위치를 선택하세요"
          : "임시 범퍼를 놓을 위치를 선택하세요",
      );
      return;
    }
    this.activateCurrentSkill({ actorId });
  }

  private handleSkillPlacement(pointer: Phaser.Input.Pointer): void {
    if (!isBattleArenaPointerY(pointer.y, 12)) return;
    const position = {
      x: Phaser.Math.Clamp(pointer.x, 20, W - 20),
      y: Phaser.Math.Clamp(pointer.y - ARENA_Y, 20, ARENA_H - 20),
    };
    this.handleSkillPlacementAt(position);
  }

  private handleSkillPlacementAt(position: { readonly x: number; readonly y: number }): void {
    const pending = this.pendingSkillPlacement;
    if (!pending) return;
    const placementRadius = pending.kind === "portal-pair" ? 34 : 42;
    if (!this.isSkillPlacementOpen(position, placementRadius, pending.firstPosition)) {
      playSfx(this, "sfx-ui-error", 0.42);
      this.hintText.setText("다른 캐릭터·적·기믹과 겹치지 않는 빈 공간을 선택하세요");
      return;
    }
    if (pending.kind === "portal-pair" && !pending.firstPosition) {
      pending.firstPosition = position;
      this.skillPlacementMarker?.destroy();
      this.skillPlacementMarker = this.add.circle(position.x, position.y + ARENA_Y, 28, 0x8de1d8, 0.16)
        .setStrokeStyle(4, 0xb8fff2, 0.9)
        .setDepth(230);
      this.hintText.setText("두 번째 포털 위치를 선택하세요");
      return;
    }
    this.activateCurrentSkill({
      actorId: pending.actorId,
      position: pending.firstPosition ?? position,
      ...(pending.kind === "portal-pair" ? { secondaryPosition: position } : {}),
    });
  }

  private cancelSkillPlacement(): void {
    this.pendingSkillPlacement = undefined;
    this.skillPlacementMarker?.destroy();
    this.skillPlacementMarker = undefined;
    this.gamepadPlacementCursor?.destroy();
    this.gamepadPlacementCursor = undefined;
    this.gamepadSkillCursor = undefined;
    if (!this.pauseOpen) setUiFocusScope(this, "base", "battle-open-pause");
    this.hintText.setText(this.idleAimHint(this.runtime.getSnapshot()));
  }

  private isSkillPlacementOpen(
    position: { x: number; y: number },
    radius: number,
    firstPortal?: { x: number; y: number },
  ): boolean {
    return this.runtime.isActiveSkillPlacementOpen(position, radius, firstPortal);
  }

  private activateCurrentSkill(command: {
    actorId: string;
    position?: { x: number; y: number };
    secondaryPosition?: { x: number; y: number };
  }): void {
    const preview = this.runtime.activateActiveSkill(command);
    if (!preview) {
      this.hintText.setText("아직 액티브 스킬을 사용할 수 없습니다");
      return;
    }
    this.pendingSkillPlacement = undefined;
    this.skillPlacementMarker?.destroy();
    this.skillPlacementMarker = undefined;
    this.gamepadPlacementCursor?.destroy();
    this.gamepadPlacementCursor = undefined;
    this.gamepadSkillCursor = undefined;
    setUiFocusScope(this, "base", "battle-open-pause");
    this.combatPhaseOverlay?.destroy(true);
    this.combatPhaseOverlay = undefined;
    const events = this.runtime.drainEvents();
    this.processEvents(events);
    const snapshot = this.runtime.getSnapshot();
    this.syncViews(snapshot);
    this.hintText.setText(`${preview.skillName} 발동!`);
    this.flashCamera(120, 120, 235, 220);
  }

  private showEnemyTelegraph(event: BattleEvent): void {
    if (!event.actorId) return;
    const snapshot = this.runtime.getSnapshot();
    const enemy = snapshot.enemies.find((entry) => entry.id === event.actorId && entry.alive);
    if (!enemy) return;
    const intent = snapshot.enemyIntents.find((entry) => entry.enemyId === enemy.id);
    if (intent) this.upsertEnemyTelegraph(snapshot, intent);
    this.syncEnemyTelegraphs(snapshot);
  }

  private upsertEnemyTelegraph(
    snapshot: BattleSnapshot,
    intent: BattleSnapshot["enemyIntents"][number],
  ): EnemyTelegraphView | undefined {
    const enemy = snapshot.enemies.find((entry) => entry.id === intent.enemyId && entry.alive);
    if (!enemy) return undefined;
    let view = this.enemyTelegraphs.get(enemy.id);
    if (!view) {
      view = {
        actorId: enemy.id,
        targetId: intent.primaryTargetId,
        targetIds: [...intent.targetIds],
        countdown: intent.countdown,
        behavior: intent.behaviorId,
        attackKind: intent.attackKind,
        intentKind: intent.intentKind,
        status: intent.status,
        targetPosition: intent.targetPosition ? { ...intent.targetPosition } : undefined,
        areaRadius: intent.areaRadius,
        beam: this.add.graphics().setDepth(205),
        reticle: this.add.graphics().setDepth(204),
        label: this.add.text(
          enemy.position.x,
          enemy.position.y + ARENA_Y - this.enemyPresentationRadius(snapshot, enemy) - 58,
          "",
          {
          fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(11)}px`, color: "#f4cf76", backgroundColor: "#332c1d", padding: { x: 6, y: 3 }, stroke: "#071014", strokeThickness: 3,
          },
        ).setOrigin(0.5).setDepth(206),
      };
      this.enemyTelegraphs.set(enemy.id, view);
    }
    view.targetId = intent.primaryTargetId;
    view.targetIds = [...intent.targetIds];
    view.countdown = intent.countdown;
    view.behavior = intent.behaviorId;
    view.attackKind = intent.attackKind;
    view.intentKind = intent.intentKind;
    view.status = intent.status;
    view.targetPosition = intent.targetPosition ? { ...intent.targetPosition } : undefined;
    view.areaRadius = intent.areaRadius;
    return view;
  }

  private syncEnemyTelegraphs(snapshot: BattleSnapshot): void {
    const livingIntentIds = new Set<string>();
    for (const intent of snapshot.enemyIntents) {
      const enemy = snapshot.enemies.find((entry) => entry.id === intent.enemyId && entry.alive);
      if (!enemy) continue;
      livingIntentIds.add(intent.enemyId);
      this.upsertEnemyTelegraph(snapshot, intent);
    }
    for (const enemyId of [...this.enemyTelegraphs.keys()]) {
      if (!livingIntentIds.has(enemyId)) this.clearEnemyTelegraph(enemyId);
    }

    let telegraphIndex = 0;
    const palette = this.semanticPalette;
    for (const [enemyId, view] of this.enemyTelegraphs) {
      const enemy = snapshot.enemies.find((entry) => entry.id === enemyId && entry.alive);
      if (!enemy) {
        this.clearEnemyTelegraph(enemyId);
        continue;
      }
      const targets = view.targetIds.map((targetId) =>
        snapshot.party.find((entry) => entry.id === targetId && entry.alive)
        ?? snapshot.enemies.find((entry) => entry.id === targetId && entry.alive)
        ?? snapshot.objective.targets.find((entry) => entry.id === targetId && entry.active),
      ).filter((target): target is BattleSnapshot["party"][number] | BattleSnapshot["enemies"][number] | BattleSnapshot["objective"]["targets"][number] => Boolean(target));
      const target = targets[0];
      const acting = this.enemyPresentationActive && this.activeEnemyActorId === enemyId;
      const danger = acting || view.status === "ready" || view.countdown <= 1;
      const helpful = view.intentKind === "heal";
      const blocked = view.status === "blocked";
      const intentColor = blocked ? 0x8f9b9d : helpful ? palette.ally : danger ? palette.danger : palette.objective;
      const showPersistentTarget = !this.enemyPresentationActive;
      const telegraphPosition = view.intentKind === "area" ? enemy.position : view.targetPosition;
      view.beam.clear();
      view.reticle.clear();
      if (showPersistentTarget && view.intentKind === "area" && telegraphPosition && !blocked) {
        const areaRadius = Math.max(32, view.areaRadius || 44);
        view.reticle.fillStyle(intentColor, danger ? 0.11 : 0.045)
          .fillCircle(telegraphPosition.x, telegraphPosition.y + ARENA_Y, areaRadius);
        view.reticle.lineStyle(danger ? 4 : 2, intentColor, danger ? 0.7 : 0.3)
          .strokeCircle(telegraphPosition.x, telegraphPosition.y + ARENA_Y, areaRadius);
      }
      if (showPersistentTarget && target) {
        if ((danger || this.runtime.getRelicEffectValue("enemy-action-preview") > 0) && !blocked) {
          this.drawEnemyAimLine(view.beam, enemy.position, target.position, intentColor);
        }
        for (const marked of targets) {
          this.drawTargetReticle(
            view.reticle,
            marked.position.x,
            marked.position.y + ARENA_Y,
            this.targetPresentationRadius(snapshot, marked) + 16,
            danger,
            intentColor,
          );
        }
      } else if (showPersistentTarget && telegraphPosition && (view.intentKind === "area" || view.intentKind === "charge")) {
        this.drawTargetReticle(
          view.reticle,
          telegraphPosition.x,
          telegraphPosition.y + ARENA_Y,
          Math.max(24, view.areaRadius || 36),
          danger,
          intentColor,
        );
      }
      const shortBehavior = this.enemyBehaviorShortLabel(view.behavior);
      const intentLabel = enemyIntentBadgeText({
        behavior: shortBehavior,
        countdown: view.countdown,
        blocked,
        acting,
        danger,
        helpful,
        summon: view.intentKind === "summon",
      });
      const labelOffset = telegraphIndex % 2 === 1 ? 23 : 0;
      telegraphIndex += 1;
      const displayedEnemy = this.enemyPresentationActive
        ? this.displayedEnemyPositions.get(enemy.id) ?? enemy.position
        : enemy.position;
      const semanticPrefix = blocked ? "◇ " : helpful ? "＋ " : danger ? "⚠ " : "△ ";
      view.label.setText(`${semanticPrefix}${intentLabel}`)
        .setBackgroundColor(blocked ? "#30393b" : helpful ? "#16442f" : danger ? "#8e302b" : "#332c1d")
        .setColor(blocked ? "#c9d1d0" : helpful ? "#b8ffd1" : danger ? "#fff1e9" : "#f4cf76");
      const badgePosition = placeEnemyIntentBadge({
        enemyX: displayedEnemy.x,
        enemyY: displayedEnemy.y + ARENA_Y,
        enemyRadius: this.enemyPresentationRadius(snapshot, enemy),
        badgeWidth: view.label.width * 1.08,
        badgeHeight: view.label.height * 1.08,
        stackOffset: labelOffset,
      });
      view.label.setPosition(badgePosition.x, badgePosition.y)
        .setScale(danger && !blocked ? 1 + Math.sin(this.time.now / 155) * 0.055 : 1);
    }
  }

  private drawEnemyAimLine(
    graphics: Phaser.GameObjects.Graphics,
    from: { readonly x: number; readonly y: number },
    to: { readonly x: number; readonly y: number },
    color: number,
  ): void {
    const fromY = from.y + ARENA_Y;
    const toY = to.y + ARENA_Y;
    const dx = to.x - from.x;
    const dy = toY - fromY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const unitX = dx / distance;
    const unitY = dy / distance;
    graphics.lineStyle(7, 0x210d0d, 0.62).lineBetween(from.x, fromY, to.x, toY);
    graphics.lineStyle(3, color, 0.88);
    for (let travelled = 8; travelled < distance - 12; travelled += 22) {
      const end = Math.min(distance - 12, travelled + 11);
      graphics.lineBetween(from.x + unitX * travelled, fromY + unitY * travelled, from.x + unitX * end, fromY + unitY * end);
    }
    const angle = Math.atan2(dy, dx);
    graphics.fillStyle(color, 0.95).fillTriangle(
      to.x,
      toY,
      to.x - Math.cos(angle - 0.55) * 18,
      toY - Math.sin(angle - 0.55) * 18,
      to.x - Math.cos(angle + 0.55) * 18,
      toY - Math.sin(angle + 0.55) * 18,
    );
  }

  private drawTargetReticle(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    danger: boolean,
    color = danger ? 0xff715d : 0xe3bb54,
  ): void {
    const length = Math.max(10, radius * 0.42);
    const inset = Math.max(5, radius * 0.2);
    graphics.lineStyle(danger ? 5 : 3, color, danger ? 0.94 : 0.62);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const cornerX = x + sx * radius;
      const cornerY = y + sy * radius;
      graphics.lineBetween(cornerX, cornerY, cornerX - sx * length, cornerY);
      graphics.lineBetween(cornerX, cornerY, cornerX, cornerY - sy * length);
    }
    graphics.lineStyle(2, color, 0.72)
      .lineBetween(x - inset, y, x + inset, y)
      .lineBetween(x, y - inset, x, y + inset);
  }

  private clearEnemyTelegraph(enemyId: string): void {
    const view = this.enemyTelegraphs.get(enemyId);
    if (!view) return;
    for (const target of [view.beam, view.reticle, view.label]) {
      this.tweens.killTweensOf(target);
      target.destroy();
    }
    this.enemyTelegraphs.delete(enemyId);
  }

  private enemyBehaviorLabel(behavior: string): string {
    return {
      charger: "돌진",
      shooter: "원거리 사격",
      shield: "방패 전진",
      heavy: "광역 충격",
      support: "회복·가속",
      splitter: "분열 폭발",
      summoner: "증원 소환",
      stunned: "기절",
      bound: "속박",
    }[behavior] ?? behavior.replaceAll("-", " ");
  }

  private enemyBehaviorShortLabel(behavior: string): string {
    return {
      charger: "돌진",
      shooter: "사격",
      shield: "방패",
      heavy: "광역",
      support: "지원",
      splitter: "분열",
      summoner: "소환",
      stunned: "기절",
      bound: "속박",
    }[behavior] ?? behavior.replaceAll("-", " ");
  }

  private modifierEventLabel(effectKind: string | undefined): string | undefined {
    if (!effectKind) return undefined;
    return {
      sealDirectionHitCount: "방향 봉인 각인",
      sealRequiredAngleCount: "새 각도 각인",
      sealColorCount: "속성 봉인 각인",
      crystalsRequireLitOrder: "수정 화음 적중",
      interruptSongInOrder: "노랫결 차단",
      exactHeadChainCount: "머리 연쇄",
      singleShotAllRings: "도끼 고리 연쇄",
      rearHitBreaksFormation: "후방 진형 붕괴",
      fatherSonLinkOpensCore: "부자 연계 · 핵 개방",
      forepawsOpenSafeLane: "안전 항로 개방",
      bronzeWallsGroundLightning: "낙뢰 접지",
    }[effectKind];
  }

  private syncStageObjects(snapshot: BattleSnapshot): void {
    const palette = this.semanticPalette;
    const accessibilitySettings = this.battleSettings;
    const propPlan = reconcileViewIds(this.propViews.keys(), snapshot.props.map((prop) => prop.id));
    for (const propId of propPlan.create) {
      const prop = snapshot.props.find((entry) => entry.id === propId);
      if (prop) this.ensurePropView(prop);
    }
    for (const propId of propPlan.remove) this.destroyPropView(propId);

    const hazardPlan = reconcileViewIds(this.hazardViews.keys(), snapshot.hazards.map((hazard) => hazard.id));
    for (const hazardId of hazardPlan.create) {
      const hazard = snapshot.hazards.find((entry) => entry.id === hazardId);
      if (hazard) this.ensureHazardView(hazard);
    }
    for (const hazardId of hazardPlan.remove) this.destroyHazardView(hazardId);

    const wallPlan = reconcileViewIds(this.wallViews.keys(), snapshot.walls.map((wall) => wall.id));
    for (const wallId of wallPlan.create) this.ensureWallView(wallId);
    for (const wallId of wallPlan.remove) {
      const view = this.wallViews.get(wallId);
      view?.art?.destroy();
      view?.debug.destroy();
      this.wallViews.delete(wallId);
      this.wallMotionTweens.get(wallId)?.stop();
      this.wallMotionTweens.delete(wallId);
      this.displayedWallStates.delete(wallId);
    }

    for (const prop of snapshot.props) {
      const view = this.ensurePropView(prop);
      if (!view) continue;
      if (!this.enemyPresentationActive) {
        this.displayedObjectiveHp.set(prop.id, prop.hp);
        this.displayedObjectiveState.set(prop.id, prop.state);
      }
      const displayedState = this.displayedObjectiveState.get(prop.id) ?? prop.state;
      const y = prop.position.y + ARENA_Y;
      this.syncPropArt(view, prop);
      const visiblyPresent = prop.interactionMode !== undefined || displayedState !== "broken";
      const persistentCompletion = ["stump", "lashed", "severed"].includes(prop.visualState);
      view.body.setPosition(prop.position.x, y).setVisible(visiblyPresent).setAlpha(
        displayedState === "failed" ? 0.3 : displayedState === "awakened" && !persistentCompletion ? 0.78 : 1,
      );
      view.halo.setPosition(prop.position.x, y).setVisible(visiblyPresent && (prop.active || displayedState === "awakened" || displayedState === "failed"))
        .setStrokeStyle(
          accessibilitySettings.highContrast ? 6 : 3,
          displayedState === "awakened" ? palette.ally : displayedState === "failed" || displayedState === "broken" ? palette.danger : palette.objective,
          accessibilitySettings.colorVision === "off" && !accessibilitySettings.highContrast ? 0.72 : 0.98,
        );
      const isObjective = this.stage.objective.targetIds.includes(prop.id);
      const hideOrderedGuide = this.hideCrystalOrderAfterFirst && snapshot.objective.current > 0 && isObjective;
      const excludedFromAutoTarget = isObjective && this.hasSceneModifier(snapshot, "excludeCattleFromAutoTarget");
      if (hideOrderedGuide) view.halo.setVisible(false);
      view.status.setPosition(prop.position.x, y + prop.radius * 1.22)
        .setText(hideOrderedGuide ? "" : excludedFromAutoTarget && displayedState === "idle" ? "⚠ 접촉 금지 · 수동 조준" : isObjective ? `◆ ${this.propStateLabel(displayedState, prop.visualState)}` : "")
        .setColor(excludedFromAutoTarget ? "#ffb19f" : "#f6da82")
        .setVisible(visiblyPresent);
      view.hp.clear();
      if ((prop.active || displayedState === "protected") && prop.requiredProgress > 1 && displayedState !== "awakened") {
        const width = Math.max(62, prop.radius * 1.7);
        const barY = y - prop.radius - 18;
        const displayedHp = this.displayedObjectiveHp.get(prop.id) ?? prop.hp;
        const ratio = prop.interactionMode === "assembly"
          ? Phaser.Math.Clamp(prop.progress / prop.requiredProgress, 0, 1)
          : Phaser.Math.Clamp(displayedHp / prop.maxHp, 0, 1);
        view.hp.fillStyle(0x061015, 0.92).fillRoundedRect(prop.position.x - width / 2, barY, width, 9, 4);
        const progressColor = prop.interactionMode === "assembly" ? palette.ally : ratio > 0.4 ? palette.objective : palette.danger;
        view.hp.fillStyle(progressColor, 1).fillRoundedRect(prop.position.x - width / 2 + 2, barY + 2, Math.max(0, (width - 4) * ratio), 5, 3);
      }
    }

    for (const hazard of snapshot.hazards) {
      const view = this.ensureHazardView(hazard);
      if (!view) continue;
      this.syncHazardView(view, hazard, snapshot);
    }

    for (const wall of snapshot.walls) {
      const view = this.wallViews.get(wall.id) ?? this.ensureWallView(wall.id);
      if (!view) continue;
      this.redrawWallView(view, wall);
    }

    for (const target of snapshot.objective.targets) {
      if (target.kind !== "exit") continue;
      let view = this.objectiveMarkerViews.get(target.id);
      if (!view) {
        const ring = this.add.circle(target.position.x, target.position.y + ARENA_Y, target.radius, palette.objective, 0.12)
          .setStrokeStyle(accessibilitySettings.highContrast ? 7 : 4, palette.objective, 0.96)
          .setDepth(54);
        const label = this.add.text(target.position.x, target.position.y + ARENA_Y, "◆ 탈출", {
          fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: "#dffff7", stroke: "#071014", strokeThickness: accessibilitySettings.highContrast ? 7 : 5,
        }).setOrigin(0.5).setDepth(56);
        view = { ring, label };
        this.objectiveMarkerViews.set(target.id, view);
        if (!this.reducedMotion) this.tweens.add({ targets: ring, alpha: 0.32, scale: 1.08, duration: 760, yoyo: true, repeat: -1 });
      }
      const x = target.position.x;
      const y = target.position.y + ARENA_Y;
      view.ring.setPosition(x, y).setVisible(target.active && !target.completed && !target.failed);
      view.label.setPosition(x, y).setVisible(target.active && !target.completed && !target.failed);
    }
  }

  private ensurePropView(prop: BattleSnapshot["props"][number]): StagePropView {
    const existing = this.propViews.get(prop.id);
    if (existing) return existing;
    const authored = this.stage.spawns.find((entry) => entry.kind === "prop" && entry.id === prop.id);
    const stateTexture = authored ? stagePropTextureKey(authored, prop.visualState) : undefined;
    const baseTexture = authored ? stagePropTextureKey(authored) : stagePropTextureKey(prop.id);
    const textureKey = stateTexture && this.textures.exists(stateTexture) ? stateTexture : baseTexture;
    const hasArt = Boolean(textureKey && this.textures.exists(textureKey));
    const body = this.add.image(prop.position.x, prop.position.y + ARENA_Y, hasArt ? textureKey! : "particle")
      .setDepth(58);
    if (!hasArt) body.setTint(0xe7bd65);
    const width = authored?.presentation?.width ?? prop.radius * (hasArt ? 2.45 : 1.7);
    const height = authored?.presentation?.height ?? prop.radius * (hasArt ? 2.45 : 1.7);
    body
      .setOrigin(authored?.presentation?.anchorX ?? 0.5, authored?.presentation?.anchorY ?? 0.5)
      .setDisplaySize(width, height);
    const halo = this.add.circle(prop.position.x, prop.position.y + ARENA_Y, prop.radius * 1.08, 0xf1c967, 0.08)
      .setStrokeStyle(2, 0xf1c967, 0.32)
      .setDepth(52);
    const status = this.add.text(prop.position.x, prop.position.y + ARENA_Y + prop.radius * 1.22, "", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(12)}px`, color: "#f6da82", stroke: "#071014", strokeThickness: 4,
    }).setOrigin(0.5).setDepth(62);
    const hp = this.add.graphics().setDepth(64);
    if (!this.reducedMotion) this.tweens.add({ targets: halo, scale: 1.12, alpha: 0.2, duration: 1050, yoyo: true, repeat: -1 });
    const view = { body, halo, status, hp };
    this.propViews.set(prop.id, view);
    return view;
  }

  private syncPropArt(view: StagePropView, prop: BattleSnapshot["props"][number]): void {
    const authored = this.stage.spawns.find((entry) => entry.kind === "prop" && entry.id === prop.id);
    if (!authored) return;
    const stateTexture = stagePropTextureKey(authored, prop.visualState);
    const baseTexture = stagePropTextureKey(authored);
    const textureKey = stateTexture && this.textures.exists(stateTexture)
      ? stateTexture
      : baseTexture && this.textures.exists(baseTexture)
        ? baseTexture
        : undefined;
    if (textureKey && view.body.texture.key !== textureKey) {
      view.body.setTexture(textureKey).clearTint();
    }
    const hasArt = Boolean(textureKey);
    const width = authored.presentation?.width ?? prop.radius * (hasArt ? 2.45 : 1.7);
    const height = authored.presentation?.height ?? prop.radius * (hasArt ? 2.45 : 1.7);
    view.body
      .setOrigin(authored.presentation?.anchorX ?? 0.5, authored.presentation?.anchorY ?? 0.5)
      .setDisplaySize(width, height);
  }

  private destroyPropView(propId: string): void {
    const view = this.propViews.get(propId);
    if (!view) return;
    for (const target of [view.body, view.halo, view.status, view.hp]) {
      this.tweens.killTweensOf(target);
      target.destroy();
    }
    this.propViews.delete(propId);
  }

  private ensureHazardView(hazard: BattleSnapshot["hazards"][number]): HazardView {
    const existing = this.hazardViews.get(hazard.id);
    if (existing) return existing;
    if (!this.displayedHazardPositions.has(hazard.id)) {
      this.displayedHazardPositions.set(hazard.id, { ...hazard.position });
    }
    const color = hazard.type.includes("wind") || hazard.type === "current" || hazard.type === "wave-front" ? 0x78d9d1 : hazard.type === "slow-field" ? 0xb177bb : hazard.spawnedBy ? 0x8de1d8 : 0xd6ad54;
    const x = hazard.position.x;
    const y = hazard.position.y + ARENA_Y;
    const aura = this.add.circle(x, y, hazard.radius, color, 0.11)
      .setStrokeStyle(hazard.type === "moving-bumper" ? 4 : 2, color, hazard.spawnedBy ? 0.9 : 0.45)
      .setDepth(16);
    const isSegmentWall = hazard.type === "moving-bumper" && hazard.parameters.shape === "segment";
    if (isSegmentWall) {
      const length = Math.max(hazard.radius * 2, Number(hazard.parameters.length ?? 220));
      aura.setScale(length / Math.max(1, hazard.radius * 2), 1)
        .setRotation(Number(hazard.parameters.angle ?? 0));
    }
    const textureKey = hazardTextureKey(hazard.type);
    let decal: Phaser.GameObjects.Image | undefined;
    if (this.textures.exists(textureKey)) {
      const width = isSegmentWall
        ? Math.max(hazard.radius * 2, Number(hazard.parameters.length ?? 220))
        : hazard.type === "wave-front"
        ? Number(hazard.parameters.length ?? this.stage.arena.width)
        : hazard.radius * 2.25;
      decal = this.add.image(x, y, textureKey)
        .setDisplaySize(width, isSegmentWall ? hazard.radius * 2 : hazard.type === "wave-front" ? hazard.radius * 2.4 : hazard.type === "one-way-wall" ? hazard.radius * 0.82 : width)
        .setAlpha(this.hazardDecalAlpha(hazard.type))
        .setDepth(this.hazardDecalDepth(hazard.type));
      if (hazard.type === "one-way-wall") decal.setAngle(Number(hazard.parameters.allowedAngle ?? 0));
      if (isSegmentWall) decal.setRotation(Number(hazard.parameters.angle ?? 0));
      if (hazard.type === "wave-front" && String(hazard.parameters.axis ?? "y") === "x") decal.setAngle(90);
      if (!this.reducedMotion && ["wind-vector", "current", "whirlpool", "portal"].includes(hazard.type)) {
        this.tweens.add({ targets: decal, angle: 360, duration: hazard.type === "whirlpool" ? 3600 : 6200, repeat: -1 });
      }
    }
    const pulse = this.add.circle(x, y, Math.max(12, hazard.radius * 0.12), color, 0.25).setDepth(17);
    if (this.reducedMotion) pulse.setAlpha(0.14);
    else if (!isSegmentWall) this.tweens.add({ targets: pulse, scale: Math.max(1.5, hazard.radius / 20), alpha: 0, duration: 1800, repeat: -1 });
    if (isSegmentWall) pulse.setVisible(false);
    const label = this.add.text(x, y + hazard.radius + 10, `${hazard.spawnedBy ? "액티브 · " : ""}${this.hazardLabel(hazard.type)}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(11)}px`, color: hazard.spawnedBy ? "#b8fff2" : "#d7e9df", stroke: "#061014", strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(28);
    const guide = hazard.type === "moving-bumper" && Number(hazard.parameters.distance ?? 0) > 0
      ? this.drawHazardMotionGuide({ x: hazard.origin.x, y: hazard.origin.y, radius: hazard.radius, parameters: hazard.parameters }, color)
      : undefined;
    const warning = this.add.graphics().setDepth(27);
    const view = { aura, decal, pulse, label, guide, warning };
    this.hazardViews.set(hazard.id, view);
    return view;
  }

  private destroyHazardView(hazardId: string): void {
    const view = this.hazardViews.get(hazardId);
    if (!view) return;
    for (const target of [view.aura, view.decal, view.pulse, view.label, view.guide, view.warning]) {
      if (!target) continue;
      this.tweens.killTweensOf(target);
      target.destroy();
    }
    this.hazardViews.delete(hazardId);
    this.hazardMotionTweens.get(hazardId)?.stop();
    this.hazardMotionTweens.delete(hazardId);
    this.displayedHazardPositions.delete(hazardId);
  }

  private animateHazardMovement(event: BattleEvent): void {
    if (!event.targetId || !event.position) return;
    const hazard = this.runtime.getSnapshot().hazards.find((entry) => entry.id === event.targetId);
    const current = this.displayedHazardPositions.get(event.targetId)
      ?? hazard?.origin
      ?? event.position;
    this.hazardMotionTweens.get(event.targetId)?.stop();
    this.displayedHazardPositions.set(event.targetId, { ...current });
    if (this.reducedMotion) {
      this.displayedHazardPositions.set(event.targetId, { ...event.position });
      return;
    }
    const pose = { ...current };
    const tween = this.tweens.add({
      targets: pose,
      x: event.position.x,
      y: event.position.y,
      duration: event.effectKind === "wave-front" ? 420 : 280,
      ease: event.effectKind === "wave-front" ? "Sine.InOut" : "Cubic.Out",
      onUpdate: () => this.displayedHazardPositions.set(event.targetId!, { x: pose.x, y: pose.y }),
      onComplete: () => {
        this.displayedHazardPositions.set(event.targetId!, { ...event.position! });
        this.hazardMotionTweens.delete(event.targetId!);
      },
    });
    this.hazardMotionTweens.set(event.targetId, tween);
  }

  private syncHazardView(
    view: HazardView,
    hazard: BattleSnapshot["hazards"][number],
    snapshot: BattleSnapshot,
  ): void {
    const displayedPosition = this.displayedHazardPositions.get(hazard.id) ?? hazard.position;
    const x = displayedPosition.x;
    const y = displayedPosition.y + ARENA_Y;
    const radius = this.hazardPresentationRadius(hazard);
    const visible = hazard.active && hazard.parameters.hiddenExit !== true;
    const hasPulseCycle = Number(hazard.parameters.pulseTurns ?? 0) > 0;
    const pulseActive = !hasPulseCycle || hazard.parameters.pulseActive !== false;
    const isSegmentWall = hazard.type === "moving-bumper" && hazard.parameters.shape === "segment";
    const accessibilitySettings = this.battleSettings;
    const palette = this.semanticPalette;
    const dangerHazard = ["slow-field", "forbidden-target", "lightning", "sound-wave", "wave-front", "whirlpool"].includes(hazard.type);
    const color = hazard.spawnedBy
      ? palette.ally
      : dangerHazard
        ? palette.danger
        : hazard.type.includes("wind") || hazard.type === "current" || hazard.type === "portal"
          ? palette.trajectory
          : palette.objective;

    view.aura.setPosition(x, y).setRadius(radius).setAlpha(pulseActive ? 1 : 0.28)
      .setVisible(visible && hazard.type !== "wave-front");
    if (isSegmentWall) {
      const length = Math.max(radius * 2, Number(hazard.parameters.length ?? 220));
      view.aura.setScale(length / Math.max(1, radius * 2), 1).setRotation(Number(hazard.parameters.angle ?? 0));
    } else view.aura.setScale(1).setRotation(0);
    if (view.decal) {
      const width = isSegmentWall
        ? Math.max(radius * 2, Number(hazard.parameters.length ?? 220))
        : hazard.type === "wave-front"
        ? Number(hazard.parameters.length ?? this.stage.arena.width)
        : radius * 2.25;
      const height = isSegmentWall ? radius * 2 : hazard.type === "wave-front" ? radius * 2.4 : hazard.type === "one-way-wall" ? radius * 0.82 : width;
      const lastRadius = Number(view.decal.getData("hazardRadius") ?? -1);
      if (Math.abs(lastRadius - radius) > 0.01) {
        view.decal.setDisplaySize(width, height).setData("hazardRadius", radius);
      }
      view.decal.setPosition(x, y)
        .setAlpha(this.hazardDecalAlpha(hazard.type) * (pulseActive ? 1 : 0.32))
        .setVisible(visible);
      if (hazard.type === "one-way-wall") view.decal.setAngle(this.hazardDirectionDegrees(hazard));
      if (isSegmentWall) view.decal.setRotation(Number(hazard.parameters.angle ?? 0));
      if (hazard.type === "wave-front") view.decal.setAngle(String(hazard.parameters.axis ?? "y") === "x" ? 90 : 0);
    }
    const lastPulseRadius = Number(view.pulse.getData("hazardRadius") ?? -1);
    if (Math.abs(lastPulseRadius - radius) > 0.01) {
      view.pulse.setRadius(Math.max(12, radius * 0.12)).setData("hazardRadius", radius);
    }
    view.pulse.setPosition(x, y).setVisible(visible && pulseActive && hazard.type !== "wave-front" && !isSegmentWall);
    view.label.setPosition(x, y + radius + 10)
      .setText(this.hazardStatusLabel(hazard, radius))
      .setVisible(visible);
    view.guide?.setVisible(visible);
    view.warning.clear().setVisible(visible);
    if (!visible) return;
    if (isSegmentWall) {
      const angle = Number(hazard.parameters.angle ?? 0);
      const half = Math.max(radius, Number(hazard.parameters.length ?? 220) / 2);
      view.warning.lineStyle(3, color, 0.78).lineBetween(
        x - Math.cos(angle) * half,
        y - Math.sin(angle) * half,
        x + Math.cos(angle) * half,
        y + Math.sin(angle) * half,
      );
    }

    const showVector = this.hasSceneModifier(snapshot, "showHazardVector")
      || this.runtime.getRelicEffectValue("hazard-vector-visible") > 0
      || (hazard.type === "wind-vector" && this.hasSceneModifier(snapshot, "showWindVector"));
    if (showVector && (hazard.type === "current" || hazard.type === "wind-vector" || hazard.type === "wave-front")) {
      const rotation = hazard.phase * Number(hazard.parameters.rotateEachTurn ?? 0) * Math.PI / 180;
      const forceX = Number(hazard.parameters.forceX ?? 0);
      const forceY = Number(hazard.parameters.forceY ?? 0);
      const rotatedX = forceX * Math.cos(rotation) - forceY * Math.sin(rotation);
      const rotatedY = forceX * Math.sin(rotation) + forceY * Math.cos(rotation);
      const magnitude = Math.hypot(rotatedX, rotatedY);
      if (magnitude > 0.001) {
        const unitX = rotatedX / magnitude;
        const unitY = rotatedY / magnitude;
        const length = Math.min(140, Math.max(62, radius * 0.58));
        this.drawGuideArrow(view.warning, x - unitX * length * 0.42, y - unitY * length * 0.42, x + unitX * length * 0.58, y + unitY * length * 0.58, color);
      }
    }

    if (hazard.type === "whirlpool" && pulseActive && (
      this.hasSceneModifier(snapshot, "showSuctionVector")
      || this.runtime.getRelicEffectValue("hazard-vector-visible") > 0
    )) {
      for (let index = 0; index < 4; index += 1) {
        const angle = index * Math.PI / 2 + Math.PI / 4;
        this.drawGuideArrow(
          view.warning,
          x + Math.cos(angle) * radius * 0.78,
          y + Math.sin(angle) * radius * 0.78,
          x + Math.cos(angle) * radius * 0.3,
          y + Math.sin(angle) * radius * 0.3,
          color,
        );
      }
    }

    if (hazard.type === "whirlpool" && hasPulseCycle) {
      const lethalRadius = Math.max(0, Number(hazard.parameters.lethalRadius ?? 0));
      if (lethalRadius > 0) {
        view.warning.fillStyle(pulseActive ? palette.danger : 0x718083, pulseActive ? 0.12 : 0.035)
          .fillCircle(x, y, lethalRadius);
        view.warning.lineStyle(pulseActive ? 5 : 2, pulseActive ? palette.danger : 0x718083, pulseActive ? 0.96 : 0.52)
          .strokeCircle(x, y, lethalRadius);
      }
    }

    if (hazard.type === "slow-field" && (
      this.hasSceneModifier(snapshot, "showSlowField")
      || Number(hazard.parameters.expandsPerTurn ?? 0) !== 0
    )) {
      view.warning.lineStyle(2, color, 0.64).strokeCircle(x, y, radius);
      for (let index = 0; index < 12; index += 1) {
        const angle = index * Math.PI / 6;
        view.warning.fillStyle(color, index % 2 === 0 ? 0.82 : 0.45).fillCircle(
          x + Math.cos(angle) * radius,
          y + Math.sin(angle) * radius,
          index % 2 === 0 ? 4 : 3,
        );
      }
    }

    if (hazard.type === "one-way-wall" && (
      this.hasSceneModifier(snapshot, "showOneWayWallArrows")
      || this.runtime.getRelicEffectValue("hazard-vector-visible") > 0
      || Number(hazard.parameters.rotateEachTurn ?? 0) !== 0
    )) {
      const angle = this.hazardDirectionDegrees(hazard) * Math.PI / 180;
      const unitX = Math.cos(angle);
      const unitY = Math.sin(angle);
      const length = Math.min(155, radius * 0.72);
      this.drawGuideArrow(view.warning, x - unitX * length, y - unitY * length, x + unitX * length, y + unitY * length, 0xf4cf76);
    }

    if (hazard.type === "sound-wave") this.drawSoundWaveFeedback(view.warning, hazard, x, y, radius);

    if (hazard.type === "wave-front") {
      const movementAxis = String(hazard.parameters.axis ?? "y");
      const length = Number(hazard.parameters.length ?? (movementAxis === "x" ? this.stage.arena.height : this.stage.arena.width));
      const half = length / 2;
      const armed = hazard.parameters.armed === true;
      view.warning.lineStyle(armed ? 5 : 3, armed ? 0xd9ffff : 0x78d9d1, armed ? 0.92 : 0.56);
      if (movementAxis === "x") view.warning.lineBetween(x, y - half, x, y + half);
      else view.warning.lineBetween(x - half, y, x + half, y);
    }

    if (hazard.type === "lightning") this.drawLightningFeedback(view.warning, hazard, x, y, radius);
    if (!hazard.spawnedBy && dangerHazard && pulseActive && (accessibilitySettings.highContrast || accessibilitySettings.colorVision !== "off")) {
      view.warning.lineStyle(accessibilitySettings.highContrast ? 5 : 3, palette.danger, 0.96);
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI / 4;
        const inner = radius + 5;
        const outer = radius + (index % 2 === 0 ? 17 : 12);
        view.warning.lineBetween(
          x + Math.cos(angle) * inner,
          y + Math.sin(angle) * inner,
          x + Math.cos(angle) * outer,
          y + Math.sin(angle) * outer,
        );
      }
    }
  }

  private hazardPresentationRadius(hazard: BattleSnapshot["hazards"][number]): number {
    // Dynamic hazard radii are authoritative runtime state. Recomputing authored
    // expansion here can show a safe edge where the actual collider no longer is.
    return Phaser.Math.Clamp(hazard.radius, 1, Math.max(W, ARENA_H) * 1.25);
  }

  private drawSoundWaveFeedback(
    graphics: Phaser.GameObjects.Graphics,
    hazard: BattleSnapshot["hazards"][number],
    x: number,
    y: number,
    radius: number,
  ): void {
    const pattern = soundWaveAngularPattern(hazard.parameters);
    graphics.lineStyle(4, 0xd7a0e4, 0.72).strokeCircle(x, y, radius);
    graphics.lineStyle(2, 0xf2d8f7, 0.38).strokeCircle(x, y, Math.max(8, radius * 0.72));

    for (const fan of pattern.damageFans) {
      this.drawHazardSector(
        graphics,
        x,
        y,
        radius,
        fan.centerDegrees,
        fan.widthDegrees,
        0xff6f8f,
        0.2,
      );
    }
    if (pattern.safeGap) {
      this.drawHazardSector(
        graphics,
        x,
        y,
        radius,
        pattern.safeGap.centerDegrees,
        pattern.safeGap.widthDegrees,
        0x75e6ad,
        0.16,
      );
    }
  }

  private drawHazardSector(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    centerDegrees: number,
    widthDegrees: number,
    color: number,
    alpha: number,
  ): void {
    const half = Phaser.Math.DegToRad(widthDegrees / 2);
    const center = Phaser.Math.DegToRad(centerDegrees);
    graphics
      .fillStyle(color, alpha)
      .lineStyle(3, color, Math.min(1, alpha + 0.58))
      .beginPath()
      .moveTo(x, y)
      .arc(x, y, radius, center - half, center + half, false)
      .closePath()
      .fillPath()
      .strokePath();
  }

  private hazardDirectionDegrees(hazard: BattleSnapshot["hazards"][number]): number {
    const authored = this.stage.hazards.find((entry) => entry.id === hazard.id);
    const current = Number(hazard.parameters.allowedAngle ?? 0);
    const authoredAngle = Number(authored?.parameters.allowedAngle ?? current);
    const runtimeChangedAngle = Math.abs(current - authoredAngle) > 0.01;
    const degrees = runtimeChangedAngle
      ? current
      : current + hazard.phase * Number(hazard.parameters.rotateEachTurn ?? 0);
    return ((degrees % 360) + 360) % 360;
  }

  private hazardStatusLabel(hazard: BattleSnapshot["hazards"][number], radius: number): string {
    const prefix = `${hazard.spawnedBy ? "액티브 · " : ""}${this.hazardLabel(hazard.type)}`;
    const turns = hazard.remainingTurns !== undefined ? ` · ${Math.max(0, hazard.remainingTurns)}턴` : "";
    const maxHp = Number(hazard.parameters.maxHp ?? 0);
    if (maxHp > 0) {
      const hp = Math.max(0, Math.round(Number(hazard.parameters.hp ?? maxHp)));
      return `${prefix} · HP ${hp}/${Math.round(maxHp)}${turns}`;
    }
    if (hazard.type === "lightning") {
      const warningTurns = Math.max(1, Math.round(Number(hazard.parameters.warningTurns ?? 1)));
      const cycle = hazard.phase % (warningTurns + 1);
      const striking = hazard.parameters.armed === true;
      const strikes = Math.max(1, Math.round(Number(hazard.parameters.strikes ?? 1)));
      const untilArmed = Math.max(1, warningTurns - cycle);
      return `${prefix} · ${striking ? `⚡ ${strikes}연타` : `⚠ 예고 ${untilArmed}턴`}${turns}`;
    }
    if (hazard.type === "sound-wave") {
      const warning = hazard.parameters.armed === false ? " · ⚠ 예고" : "";
      const pattern = soundWaveAngularPattern(hazard.parameters);
      const angular = pattern.damageFans.length > 0
        ? ` · 위험 부채 ${pattern.damageFans.length}×${Math.round(pattern.damageFans[0]!.widthDegrees)}°`
        : pattern.safeGap
          ? ` · 안전각 ${Math.round(pattern.safeGap.widthDegrees)}°`
          : "";
      const expanding = Number(hazard.parameters.expansion ?? 0) > 0 ? ` · 파동 ${Math.round(radius)}` : "";
      return `${prefix}${angular}${expanding}${warning}${turns}`;
    }
    if (hazard.type === "wave-front") {
      const warning = hazard.parameters.armed === true ? "파도 돌진" : "파도 예고";
      return `${prefix} · ${warning}${turns}`;
    }
    if (hazard.type === "whirlpool" && Number(hazard.parameters.pulseTurns ?? 0) > 0) {
      const active = hazard.parameters.pulseActive !== false;
      const lethalRadius = Math.max(0, Math.round(Number(hazard.parameters.lethalRadius ?? 0)));
      return `${prefix} · ${active ? `활성${lethalRadius > 0 ? ` · 중심 ${lethalRadius} 즉사권` : ""}` : "휴면 · 현재 안전"}${turns}`;
    }
    if (hazard.type === "slow-field") return `${prefix} · 속도 ${Math.round(Number(hazard.parameters.speedMultiplier ?? 0.75) * 100)}%${turns}`;
    if (hazard.type === "one-way-wall") return `${prefix} · ${Math.round(this.hazardDirectionDegrees(hazard))}°${turns}`;
    return `${prefix}${turns}`;
  }

  private drawLightningFeedback(
    graphics: Phaser.GameObjects.Graphics,
    hazard: BattleSnapshot["hazards"][number],
    x: number,
    y: number,
    radius: number,
  ): void {
    const warningTurns = Math.max(1, Math.round(Number(hazard.parameters.warningTurns ?? 1)));
    const cycle = hazard.phase % (warningTurns + 1);
    const striking = hazard.parameters.armed === true;
    const strikes = Math.max(1, Math.round(Number(hazard.parameters.strikes ?? 1)));
    if (!striking) {
      graphics.lineStyle(4, 0xffd96e, cycle === warningTurns ? 0.96 : 0.62).strokeCircle(x, y, radius);
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI / 4;
        graphics.fillStyle(0xffe797, 0.88).fillCircle(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 4);
      }
      return;
    }
    graphics.fillStyle(0xffefad, 0.22).fillCircle(x, y, radius);
    graphics.lineStyle(5, 0xffffff, 0.95).strokeCircle(x, y, radius);
    for (let index = 0; index < strikes; index += 1) {
      const angle = -Math.PI / 2 + (index - (strikes - 1) / 2) * 0.42;
      graphics.lineStyle(5, 0xdfffff, 0.92).lineBetween(
        x + Math.cos(angle) * radius * 1.35,
        y + Math.sin(angle) * radius * 1.35,
        x + Math.cos(angle + Math.PI) * radius * 0.35,
        y + Math.sin(angle + Math.PI) * radius * 0.35,
      );
    }
  }

  private ensureWallView(wallId: string): WallView | undefined {
    const existing = this.wallViews.get(wallId);
    if (existing) return existing;
    const wall = this.stage.walls.find((entry) => entry.id === wallId);
    if (!wall) return undefined;
    const textureKey = stageWallTextureKey(wall, "intact") ?? stageWallTextureKey(wall);
    const art = textureKey && this.textures.exists(textureKey)
      ? this.add.image(wall.x, wall.y + ARENA_Y, textureKey).setDepth(25)
      : undefined;
    const view: WallView = { art, debug: this.add.graphics().setDepth(25) };
    this.wallViews.set(wallId, view);
    return view;
  }

  private redrawWallView(
    view: WallView,
    state: BattleSnapshot["walls"][number],
  ): void {
    const wall = this.stage.walls.find((entry) => entry.id === state.id);
    if (!wall) {
      if (view.renderSignature === "missing") return;
      view.renderSignature = "missing";
      view.art?.setVisible(false);
      view.debug.setVisible(false);
      return;
    }
    let displayed = this.displayedWallStates.get(state.id);
    if (!displayed) {
      displayed = { offset: { ...state.offset }, rotation: state.rotation, active: state.active };
      this.displayedWallStates.set(state.id, displayed);
    }
    const renderSignature = [
      displayed.offset.x,
      displayed.offset.y,
      displayed.rotation,
      displayed.active ? 1 : 0,
      state.hp,
      state.maxHp,
      state.breakable ? 1 : 0,
      state.broken ? 1 : 0,
    ].join("|");
    if (view.renderSignature === renderSignature) return;
    view.renderSignature = renderSignature;
    const center = {
      x: (wall.x + (wall.x2 ?? wall.x)) / 2,
      y: (wall.y + (wall.y2 ?? wall.y)) / 2,
    };
    const cosine = Math.cos(displayed.rotation);
    const sine = Math.sin(displayed.rotation);
    const transform = (x: number, y: number): { x: number; y: number } => {
      const localX = x - center.x;
      const localY = y - center.y;
      return {
        x: center.x + localX * cosine - localY * sine + displayed.offset.x,
        y: center.y + localX * sine + localY * cosine + displayed.offset.y + ARENA_Y,
      };
    };

    const graphics = view.debug;
    graphics.clear();
    const color = { stone: 0x85684a, wood: 0x805132, coral: 0x9d665f, bronze: 0xb17b3e, spirit: 0x5da9a6 }[wall.material];
    const start = transform(wall.x, wall.y);
    const end = transform(wall.x2 ?? wall.x, wall.y2 ?? wall.y);
    if (wall.shape === "circle") {
      graphics.fillStyle(color, 0.9).lineStyle(3, 0xe4c57e, 0.65)
        .fillCircle(start.x, start.y, wall.radius ?? 18)
        .strokeCircle(start.x, start.y, wall.radius ?? 18);
      if (wall.id.includes("anchor") || wall.id.includes("mooring")) {
        const radius = wall.radius ?? 18;
        graphics.lineStyle(Math.max(4, radius * 0.2), 0x3d2517, 0.95)
          .strokeCircle(start.x, start.y - radius * 0.24, radius * 0.23)
          .lineBetween(start.x, start.y - radius * 0.02, start.x, start.y + radius * 0.48)
          .lineBetween(start.x - radius * 0.48, start.y + radius * 0.18, start.x, start.y + radius * 0.5)
          .lineBetween(start.x + radius * 0.48, start.y + radius * 0.18, start.x, start.y + radius * 0.5);
      }
    } else {
      const radius = wall.shape === "capsule" ? (wall.radius ?? 18) : 7;
      graphics.lineStyle(radius * 2 + 5, 0x2a1b17, 0.85).lineBetween(start.x, start.y, end.x, end.y);
      graphics.lineStyle(radius * 2, color, 0.95).lineBetween(start.x, start.y, end.x, end.y);
      graphics.fillStyle(color, 1).fillCircle(start.x, start.y, radius).fillCircle(end.x, end.y, radius);
    }
    const hpRatio = state.maxHp > 0 ? state.hp / state.maxHp : 1;
    const visualState = state.broken ? "broken" : state.breakable && hpRatio <= 0.5 ? "damaged" : "intact";
    const stateTexture = stageWallTextureKey(wall, visualState);
    const baseTexture = stageWallTextureKey(wall);
    const hasBrokenVisual = Boolean(wall.presentation?.stateVisualIds?.broken);
    const mayUseBase = !state.broken || hasBrokenVisual;
    const textureKey = stateTexture && this.textures.exists(stateTexture)
      ? stateTexture
      : mayUseBase && baseTexture && this.textures.exists(baseTexture)
        ? baseTexture
        : undefined;
    if (textureKey && !view.art) view.art = this.add.image(0, 0, textureKey).setDepth(25);
    if (textureKey && view.art?.texture.key !== textureKey) view.art?.setTexture(textureKey);
    const hasArt = Boolean(textureKey && view.art);
    if (view.art) {
      const radius = wall.shape === "capsule" ? (wall.radius ?? 18) : wall.shape === "circle" ? (wall.radius ?? 18) : 7;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const width = wall.presentation?.width ?? (wall.shape === "circle" ? radius * 2.5 : length + radius * 2);
      const height = wall.presentation?.height ?? (wall.shape === "circle" ? radius * 2.5 : Math.max(22, radius * 2.5));
      const angle = wall.shape === "circle" ? displayed.rotation * 180 / Math.PI : Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
      view.art
        .setOrigin(wall.presentation?.anchorX ?? 0.5, wall.presentation?.anchorY ?? 0.5)
        .setPosition((start.x + end.x) / 2, (start.y + end.y) / 2)
        .setDisplaySize(width, height)
        .setAngle(angle)
        .setVisible(shouldShowWallSprite({
          active: displayed.active,
          broken: state.broken,
          hasTexture: hasArt,
          hasBrokenVisual,
        }))
        .setAlpha(state.breakable ? Math.max(0.45, hpRatio) : 1);
    }
    // Collision art is fallback-only. Authored sprites carry the commercial
    // presentation while this geometry remains the authoritative simulation.
    graphics
      .setVisible(displayed.active && !state.broken && !hasArt)
      .setAlpha(state.breakable ? Math.max(0.25, hpRatio) : 1);
  }

  private animateWallMovement(event: BattleEvent): void {
    if (!event.targetId || !event.offset || event.rotation === undefined) return;
    const current = this.displayedWallStates.get(event.targetId) ?? {
      offset: { ...event.offset },
      rotation: event.rotation,
      active: event.active ?? true,
    };
    this.wallMotionTweens.get(event.targetId)?.stop();
    if (this.reducedMotion) {
      this.displayedWallStates.set(event.targetId, {
        offset: { ...event.offset },
        rotation: event.rotation,
        active: event.active ?? current.active,
      });
      return;
    }
    const pose = {
      offsetX: current.offset.x,
      offsetY: current.offset.y,
      rotation: current.rotation,
    };
    const tween = this.tweens.add({
      targets: pose,
      offsetX: event.offset.x,
      offsetY: event.offset.y,
      rotation: event.rotation,
      duration: 310,
      ease: "Cubic.InOut",
      onUpdate: () => this.displayedWallStates.set(event.targetId!, {
        offset: { x: pose.offsetX, y: pose.offsetY },
        rotation: pose.rotation,
        active: event.active ?? current.active,
      }),
      onComplete: () => {
        this.displayedWallStates.set(event.targetId!, {
          offset: { ...event.offset! },
          rotation: event.rotation!,
          active: event.active ?? current.active,
        });
        this.wallMotionTweens.delete(event.targetId!);
      },
    });
    this.wallMotionTweens.set(event.targetId, tween);
  }

  private propStateLabel(state: BattleSnapshot["props"][number]["state"], visualState?: string): string {
    const semantic = {
      intact: "벌목 대상",
      damaged: "껍질 파손",
      fallen: "쓰러짐 · 마무리",
      stump: "벌목 완료",
      unlashed: "뗏목 부품",
      positioned: "조립 위치 이동",
      lashed: "결속 완료",
      bonded: "섬의 결속",
      fraying: "결속 약화",
      severed: "결속 해방",
    }[visualState ?? ""];
    return semantic ?? { idle: "목표", awakened: "각성 완료", broken: "파괴됨", protected: "보호 중", failed: "실패" }[state];
  }

  private processEvents(events: readonly BattleEvent[]): void {
    for (const event of events) {
      if (event.type === "launched") {
        const actor = this.runtime.getSnapshot().party.find((entry) => entry.id === event.actorId);
        const definition = actor ? HERO_BY_ID[actor.definitionId] : undefined;
        const heavy = definition?.ricochetClass === "heavy";
        playSfx(this, heavy ? "sfx-launch-heavy" : "sfx-launch-light", heavy ? 0.48 : 0.4, heavy ? 0.9 : 1.04);
      }
      if (event.type === "turnEnded" && event.actorId) {
        const actor = this.runtime.getSnapshot().party.find((entry) => entry.id === event.actorId);
        if (actor) this.displayedHeroPositions.set(actor.id, { ...actor.position });
      }
      if (event.type === "heroActionBlocked" && event.position) {
        const label = event.effectKind === "stun" ? "기절 · 행동 불가" : "행동 불가";
        this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y, label, 0xffb171);
        addToast(this, `${label} · 턴을 넘깁니다`, COLORS.gold);
        playSfx(this, "sfx-ui-error", 0.42, 0.9);
      }
      if (event.type === "enemyPhaseStarted") this.beginEnemyPresentation(event);
      if (event.type === "enemyActionStarted") this.queueEnemyActionStart(event);
      if (event.type === "enemyActionResolved") this.queueEnemyActionResolution(event);
      if (event.type === "enemyPhaseEnded") this.endEnemyPresentation();
      if (event.type === "ricochet") {
        this.requestTutorialCoachmark("first-ricochet");
        if (event.position) {
          this.spawnImpact(event.position.x, event.position.y + ARENA_Y, 0xf0c55e);
          playSfx(this, this.ricochetSfx(event.targetId), 0.24, 0.92 + Math.min(0.3, (event.ricochets ?? 0) * 0.035));
        }
      }
      if (event.type === "allyContact") {
        this.requestTutorialCoachmark("first-ally-contact");
        if (event.position) this.spawnAllyLink(event.actorId, event.targetId, event.position.x, event.position.y + ARENA_Y);
      }
      if ((event.type as string) === "allySkillTriggered") {
        const skillEvent = event as BattleEvent & { readonly skillName?: string; readonly effectKind?: string };
        const party = this.runtime.getSnapshot().party;
        const actor = skillEvent.actorId ? party.find((hero) => hero.id === skillEvent.actorId) : undefined;
        const target = skillEvent.targetId ? party.find((hero) => hero.id === skillEvent.targetId) : undefined;
        const definition = actor ? HERO_BY_ID[actor.definitionId] : undefined;
        const fxX = actor && target ? (actor.position.x + target.position.x) / 2 : target?.position.x ?? actor?.position.x ?? W / 2;
        const fxY = actor && target ? (actor.position.y + target.position.y) / 2 : target?.position.y ?? actor?.position.y ?? 420;
        this.playAuthoredFx("fx-friendship-link", "fx-friendship-link-sheet", fxX, fxY + ARENA_Y, 1.18);
        this.playSkillFamilyFx({ ...skillEvent, position: { x: fxX, y: fxY } });
        this.showSkillBanner(skillEvent.skillName ?? definition?.friendshipSkill.name ?? "우정 스킬", skillEvent.effectKind);
        playSfx(this, "sfx-friendship-link", 0.52, 1.03);
      }
      if (event.type === "activeSkillReady" && event.actorId) {
        const hero = this.runtime.getSnapshot().party.find((entry) => entry.id === event.actorId);
        if (hero) {
          this.spawnStatePopup(hero.position.x, hero.position.y + ARENA_Y, "액티브 READY!", 0x9ff6e9);
          playSfx(this, "sfx-active-ready", 0.42, 1.05);
        }
      }
      if (event.type === "activeSkillActivated") {
        this.showSkillBanner(event.skillName ?? "액티브 스킬", undefined, "액티브 스킬");
        playSfx(this, "sfx-active-cast", 0.58, 1);
      }
      if (event.type === "activeSkillEffect" && event.position) {
        const profile = skillEffectProfile(event.effectKind);
        this.playSkillFamilyFx(event);
        if (event.effectKind) this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y, this.effectLabel(event.effectKind), profile.color);
      }
      if (event.type === "allyLaunched" && event.targetId && event.path && event.path.length > 1) {
        this.animateHeroPath(
          event.targetId,
          event.path,
          this.reducedMotion ? 120 : Math.max(220, Math.round((event.duration ?? 0.8) * 520)),
        );
        this.showSkillBanner(event.skillName ?? "ALLY LAUNCH", event.effectKind);
      }
      if (event.type === "enemyTelegraph") {
        this.showEnemyTelegraph(event);
        playSfx(this, "sfx-enemy-telegraph", 0.3, event.intentKind === "area" ? 0.86 : 1);
      }
      if (event.type === "enemyMoved" && event.position) {
        if (event.actionId) this.enemyActionsWithMovement.add(event.actionId);
        this.scheduleEnemyVisual(event, 150, () => this.playEnemyMove(event));
      }
      if (event.type === "enemySpawned" && event.targetId) {
        this.scheduleEnemyVisual(event, 250, () => {
          const enemy = this.runtime.getSnapshot().enemies.find((entry) => entry.id === event.targetId);
          if (enemy) this.ensureEnemyView(enemy);
          if (event.position) {
            this.spawnImpact(event.position.x, event.position.y + ARENA_Y, 0xc58bea);
            this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y, "증원 출현!", 0xe6a8ff);
            playSfx(this, "sfx-enemy-spawn", 0.46, 0.92);
          }
        });
      }
      if (event.type === "enemyHealed" && event.position) {
        if (event.targetId && event.hpBefore !== undefined && !this.displayedEnemyHp.has(event.targetId)) {
          this.displayedEnemyHp.set(event.targetId, event.hpBefore);
        }
        this.scheduleEnemyVisual(event, 255, () => this.playEnemyHeal(event));
      }
      if (event.type === "enemyProjectileBlocked" && event.position) {
        this.scheduleEnemyVisual(event, this.enemyActionsWithMovement.has(event.actionId ?? "") ? 430 : 180, () => this.playEnemyProjectileBlocked(event));
      }
      if (event.type === "enemyBehavior" && event.position) {
        if (event.effectKind === "stunned" || event.effectKind === "bound") {
          this.scheduleEnemyVisual(event, 35, () => {
            this.spawnStatePopup(event.position!.x, event.position!.y + ARENA_Y, this.enemyBehaviorLabel(event.effectKind ?? "행동"), 0xaab7b8);
          });
        }
      }
      if (event.type === "sequenceReset") {
        const position = event.position ?? { x: W / 2, y: ARENA_H * 0.45 };
        this.spawnStatePopup(position.x, position.y + ARENA_Y, "연계 순서 초기화", 0xff9a83);
      }
      if (event.type === "stagePhaseChanged") {
        this.showSkillBanner(`PHASE ${event.current ?? ""}`, event.effectKind, "전장 변화");
        this.flashCamera(160, 110, 155, 210);
        playSfx(this, "sfx-boss-phase", 0.62, 0.92);
      }
      if (event.type === "formationChanged") {
        const position = event.position ?? { x: W / 2, y: ARENA_H * 0.45 };
        this.spawnStatePopup(position.x, position.y + ARENA_Y, "진형 변화!", 0xf4cf76);
      }
      if (event.type === "modifierTriggered" && event.position) {
        const label = this.modifierEventLabel(event.effectKind);
        if (label) this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y, label, 0xb8fff2);
      }
      if ((event.type as string) === "objectiveProgressed" && event.position) {
        const objectiveEvent = event as BattleEvent & { readonly current?: number; readonly required?: number };
        this.spawnObjectiveProgress(event.position.x, event.position.y + ARENA_Y, objectiveEvent.current, objectiveEvent.required);
      }
      if (event.type === "objectiveTargetHit" && event.position) {
        this.spawnImpact(event.position.x, event.position.y + ARENA_Y, 0xffe47d);
      }
      if (event.type === "propStateChanged" && event.position) {
        const showPropState = () => {
          const prop = this.runtime.getSnapshot().props.find((entry) => entry.id === event.targetId);
          if (prop) this.spawnStatePopup(
            event.position!.x,
            event.position!.y + ARENA_Y,
            this.propStateLabel(prop.state, prop.visualState),
            prop.state === "failed" ? 0xff8c78 : 0xb8fff2,
          );
        };
        if (this.enemyPresentationActive) {
          this.scheduleEnemyVisual(event, this.enemyActionImpactOffsets.get(event.actionId ?? "") ?? 270, showPropState);
        } else showPropState();
      }
      if (event.type === "hazardTriggered" && event.position) {
        this.spawnImpact(event.position.x, event.position.y + ARENA_Y, 0xc58bea);
        if (this.screenShakeEnabled) this.cameras.main.shake(85, 0.0035);
        playSfx(this, "sfx-ricochet-magic", 0.34, 0.9);
      }
      if (event.type === "hazardMoved") this.animateHazardMovement(event);
      if (event.type === "hazardWarning" && event.position) {
        this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y, "위험 예고", 0xffb171);
        playSfx(this, "sfx-hazard-warning", 0.34, 1);
      }
      if (event.type === "wallDamaged" && event.position) {
        this.popupDamage(event.position.x, event.position.y + ARENA_Y - 18, event.amount ?? 0, false, false);
        if (event.impactGrade === "crushing") this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y + 20, "강타", 0xffc15f);
      }
      if (event.type === "wallMoved") this.animateWallMovement(event);
      if (event.type === "wallBroken" && event.position) {
        this.spawnImpact(event.position.x, event.position.y + ARENA_Y, 0xf0bd76);
        this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y, "장애물 파괴!", 0xffdf8f);
        playSfx(this, "sfx-weakpoint-break", 0.46, 0.9);
      }
      if (event.type === "statusEffectApplied" && event.targetId) {
        const target = this.runtime.getSnapshot().party.find((hero) => hero.id === event.targetId);
        if (target) this.spawnStatePopup(target.position.x, target.position.y + ARENA_Y, this.effectLabel(event.effectKind ?? "effect"), 0x9ff6e9);
        if (target && event.effectKind === "charger-knockback" && event.position) {
          const from = this.displayedHeroPositions.get(target.id) ?? target.position;
          this.animateHeroPath(target.id, [from, event.position], enemyPresentationDelay(220, this.enemyActionTempo));
        }
        if (event.effectKind === "shield-break") {
          const enemy = this.runtime.getSnapshot().enemies.find((entry) => entry.id === event.targetId);
          if (enemy) this.playAuthoredFx("fx-shield-break", "fx-shield-break-sheet", enemy.position.x, enemy.position.y + ARENA_Y, 1.15);
          playSfx(this, "sfx-shield-break", 0.55, 0.94);
        }
      }
      if ((event.type === "enemyHit" || event.type === "weakpointHit") && event.position) {
        this.totalDamage += event.amount ?? 0;
        this.bestCombo = Math.max(this.bestCombo, event.combo ?? 0);
        const impactColor = event.impactGrade === "crushing" ? 0xffc15f
          : event.impactGrade === "glancing" ? 0x92a7ad
            : event.type === "weakpointHit" ? 0xbaf06d : 0x8de1d8;
        this.spawnImpact(event.position.x, event.position.y + ARENA_Y, impactColor);
        this.playAuthoredFx("fx-ricochet-impact", "fx-ricochet-impact-sheet", event.position.x, event.position.y + ARENA_Y, event.type === "weakpointHit" ? 1.15 : 0.92);
        this.popupDamage(event.position.x, event.position.y + ARENA_Y - 24, event.amount ?? 0, Boolean(event.critical), event.type === "weakpointHit");
        playSfx(this, event.critical ? "sfx-hit-critical" : "sfx-hit-light", event.critical ? 0.55 : 0.32, event.type === "weakpointHit" ? 1.12 : 1);
        if (event.impactGrade === "crushing" || event.critical) this.applyHitstop(event.critical ? 52 : 38);
        if (event.impactGrade === "glancing") {
          this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y + 27, "스침", 0xb6c2c5);
        } else if (event.impactGrade === "crushing") {
          this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y + 27, "강타", 0xffcf76);
        }
        if (event.damageCapped) this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y + 49, "피해 상한", 0xf3aa78);
        if (event.effectKind === "relic-chain-lightning") {
          this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y + 28, "유물 연쇄 번개", 0x9ff6e9);
          playSfx(this, "sfx-ricochet-magic", 0.42, 1.08);
        }
        const enemyId = event.type === "weakpointHit" ? this.findWeakpointEnemy(event.targetId) : event.targetId;
        const body = enemyId ? this.enemyViews.get(enemyId)?.body : undefined;
        if (body) {
          if (this.reducedMotion) {
            body.setTint(0xffffff);
            this.time.delayedCall(90, () => body.clearTint());
          } else {
            this.tweens.add({
              targets: body,
              tint: 0xffffff,
              scaleX: body.getData("baseScaleX") * 1.08,
              scaleY: body.getData("baseScaleY") * 1.08,
              duration: 70,
              yoyo: true,
              onComplete: () => body
                .clearTint()
                .setScale(body.getData("baseScaleX"), body.getData("baseScaleY")),
            });
          }
        }
      }
      if (event.type === "weakpointBroken" && event.position) {
        this.flashCamera(130, 180, 255, 140);
        const breakText = this.add.text(event.position.x, event.position.y + ARENA_Y - 46, "BREAK!", { fontFamily: "Georgia, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(30)}px`, color: "#efff94", stroke: "#17240b", strokeThickness: 6 }).setOrigin(0.5).setDepth(600);
        if (this.reducedMotion) this.time.delayedCall(420, () => breakText.destroy());
        else this.tweens.add({ targets: breakText, y: breakText.y - 34, alpha: 0, duration: 720, ease: "Cubic.Out", onComplete: () => breakText.destroy() });
        playSfx(this, "sfx-weakpoint-break", 0.58, 1.04);
      }
      if (event.type === "heroDamaged" && event.position) {
        this.scheduleEnemyVisual(event, this.enemyActionImpactOffsets.get(event.actionId ?? "") ?? 270, () => this.playHeroDamaged(event));
      }
      if (event.type === "heroDefeated" && event.position) {
        this.scheduleEnemyVisual(event, (this.enemyActionImpactOffsets.get(event.actionId ?? "") ?? 270) + 100, () => this.playHeroDefeated(event));
      }
      if (event.type === "objectiveTargetDamaged" && event.position) {
        if (event.sourceKind !== "enemyAttack" && event.sourceKind !== "hazard") {
          this.totalDamage += event.amount ?? 0;
          this.spawnImpact(event.position.x, event.position.y + ARENA_Y, event.impactGrade === "crushing" ? 0xffc15f : 0xffe47d);
          this.popupDamage(event.position.x, event.position.y + ARENA_Y - 18, event.amount ?? 0, Boolean(event.critical), false);
          continue;
        }
        if (event.targetId && event.hpBefore !== undefined && !this.displayedObjectiveHp.has(event.targetId)) {
          this.displayedObjectiveHp.set(event.targetId, event.hpBefore);
          this.displayedObjectiveState.set(event.targetId, "protected");
        }
        this.scheduleEnemyVisual(event, this.enemyActionImpactOffsets.get(event.actionId ?? "") ?? 270, () => this.playObjectiveDamaged(event));
      }
      if (event.type === "enemyDefeated" && event.targetId) this.retireEnemyView(event.targetId);
      if (event.type === "objectiveCompleted") playSfx(this, "sfx-objective-success", 0.58, 1.05);
      if (event.type === "objectiveFailed") playSfx(this, "sfx-objective-fail", 0.52, 0.9);
      if (event.type === "enemyAttack") {
        const moved = this.enemyActionsWithMovement.has(event.actionId ?? "");
        const attackOffset = moved ? 430 : 145;
        const impactOffset = attackOffset + (event.intentKind === "ranged" ? 230 : 75);
        if (event.actionId) this.enemyActionImpactOffsets.set(event.actionId, impactOffset);
        this.scheduleEnemyVisual(event, attackOffset, () => this.playEnemyAttack(event));
      }
      if (event.type === "turnStarted") {
        if (this.enemyPresentationActive) this.deferredPlayerTurnBanner = true;
        else {
          this.flashCamera(80, 60, 120, 125);
          this.showPlayerTurnBanner(this.runtime.getSnapshot(), 40);
          playSfx(this, "sfx-turn-player", 0.3, 1.04);
        }
      }
    }
  }

  private beginEnemyPresentation(event: BattleEvent): void {
    this.enemyPresentationActive = true;
    this.enemyPresentationTurnNumber = event.turnNumber;
    this.enemyActionVisualIndex = 0;
    this.enemyActionVisualDelays.clear();
    this.enemyActionImpactOffsets.clear();
    this.enemyActionsWithMovement.clear();
    this.playedEnemyAttackActions.clear();
    this.activeEnemyActorId = undefined;
    this.deferredPlayerTurnBanner = false;
    this.aimDrag.reset();
    this.resetAimPresentation();
    this.preview.clear();
    this.showCombatPhaseBanner("적 행동", "적의 반격", 0xe66d5d);
    playSfx(this, "sfx-turn-enemy", 0.34, 0.92);
  }

  private queueEnemyActionStart(event: BattleEvent): void {
    if (!event.actionId) return;
    if (event.actorId && event.position) {
      this.displayedEnemyPositions.set(event.actorId, { ...event.position });
    }
    const delay = enemyPresentationDelay(260 + this.enemyActionVisualIndex * 610, this.enemyActionTempo);
    this.enemyActionVisualIndex += 1;
    this.enemyActionVisualDelays.set(event.actionId, delay);
    this.time.delayedCall(delay, () => {
      if (this.ended) return;
      this.activeEnemyActorId = event.actorId;
      const snapshot = this.runtime.getSnapshot();
      const enemy = event.actorId ? snapshot.enemies.find((entry) => entry.id === event.actorId) : undefined;
      const view = event.actorId ? this.enemyViews.get(event.actorId) : undefined;
      if (view) {
        this.tweens.add({
          targets: view.body,
          scaleX: view.body.getData("baseScaleX") * 1.12,
          scaleY: view.body.getData("baseScaleY") * 1.12,
          tint: 0xffb0a0,
          duration: 120,
          yoyo: true,
          onComplete: () => view.body
            .clearTint()
            .setScale(view.body.getData("baseScaleX"), view.body.getData("baseScaleY")),
        });
      }
      const targetIds = event.targetIds ?? (event.targetId ? [event.targetId] : []);
      const targetEntities = targetIds.map((targetId) =>
        snapshot.party.find((entry) => entry.id === targetId)
        ?? snapshot.enemies.find((entry) => entry.id === targetId)
        ?? snapshot.objective.targets.find((entry) => entry.id === targetId),
      ).filter((target): target is BattleSnapshot["party"][number] | BattleSnapshot["enemies"][number] | BattleSnapshot["objective"]["targets"][number] => Boolean(target));
      const displayOrigin = event.actorId ? this.displayedEnemyPositions.get(event.actorId) : undefined;
      if (enemy && targetEntities.length > 0 && event.intentKind !== "disabled") {
        const attackGuide = this.add.graphics().setDepth(575);
        for (const target of targetEntities) {
          if (event.intentKind !== "heal") this.drawEnemyAimLine(attackGuide, displayOrigin ?? enemy.position, target.position, 0xff715d);
          this.drawTargetReticle(
            attackGuide,
            target.position.x,
            target.position.y + ARENA_Y,
            this.targetPresentationRadius(snapshot, target) + 18,
            true,
            event.intentKind === "heal" ? 0x77dfa1 : 0xff715d,
          );
        }
        this.tweens.add({ targets: attackGuide, alpha: 0, delay: 170, duration: 230, onComplete: () => attackGuide.destroy() });
      }
      if (event.targetPosition && (event.intentKind === "area" || (event.areaRadius ?? 0) > 0)) {
        const zone = this.add.circle(
          event.targetPosition.x,
          event.targetPosition.y + ARENA_Y,
          Math.max(32, event.areaRadius ?? 42),
          0xe44f43,
          0.13,
        ).setStrokeStyle(5, 0xff806f, 0.82).setDepth(202).setScale(0.65);
        this.tweens.add({ targets: zone, scale: 1, alpha: 0.34, duration: 170, yoyo: true, hold: 110, onComplete: () => zone.destroy() });
      }
      this.syncTurnBanner(snapshot);
    });
  }

  private queueEnemyActionResolution(event: BattleEvent): void {
    const label = {
      moved: "위치 이동",
      blocked: "행동 불가",
      noTarget: "사거리 밖",
      summoned: "증원 소환",
      healed: "지원 완료",
      hit: "공격 완료",
    }[event.outcomeKind ?? "hit"];
    if (!label || event.outcomeKind === "hit") return;
    this.scheduleEnemyVisual(event, 400, () => {
      const position = event.position ?? event.targetPosition;
      if (position) this.spawnStatePopup(position.x, position.y + ARENA_Y, label, event.outcomeKind === "blocked" ? 0xaab7b8 : 0xf4cf76);
    });
  }

  private endEnemyPresentation(): void {
    const delay = enemyPresentationDelay(this.enemyActionVisualIndex > 0
      ? 260 + (this.enemyActionVisualIndex - 1) * 610 + 700
      : 520, this.enemyActionTempo);
    this.time.delayedCall(delay, () => {
      this.enemyPresentationActive = false;
      this.activeEnemyActorId = undefined;
      this.enemyPresentationTurnNumber = undefined;
      const snapshot = this.runtime.getSnapshot();
      for (const hero of snapshot.party) {
        this.displayedHeroHp.set(hero.id, hero.hp);
        this.displayedHeroAlive.set(hero.id, hero.alive);
      }
      for (const enemy of snapshot.enemies) {
        this.displayedEnemyHp.set(enemy.id, enemy.hp);
        this.displayedEnemyPositions.set(enemy.id, { ...enemy.position });
      }
      for (const target of snapshot.objective.targets) this.displayedObjectiveHp.set(target.id, target.hp);
      for (const prop of snapshot.props) this.displayedObjectiveState.set(prop.id, prop.state);
      this.syncViews(snapshot);
      if (snapshot.phase === "victory" || snapshot.phase === "defeat" || this.ended) return;
      this.flashCamera(90, 70, 135, 150);
      this.showPlayerTurnBanner(snapshot, 70);
      this.deferredPlayerTurnBanner = false;
    });
  }

  private scheduleEnemyVisual(event: BattleEvent, offset: number, callback: () => void): void {
    const base = event.actionId ? this.enemyActionVisualDelays.get(event.actionId) ?? 0 : 0;
    const delay = this.enemyPresentationActive ? base + enemyPresentationDelay(offset, this.enemyActionTempo) : 0;
    if (delay <= 0) callback();
    else this.time.delayedCall(delay, () => { if (!this.ended) callback(); });
  }

  private playEnemyMove(event: BattleEvent): void {
    if (!event.actorId || !event.position) return;
    const snapshot = this.runtime.getSnapshot();
    const enemy = snapshot.enemies.find((entry) => entry.id === event.actorId);
    const view = this.enemyViews.get(event.actorId);
    if (!enemy || !view) return;
    const start = this.displayedEnemyPositions.get(event.actorId) ?? {
      x: event.position.x - enemy.facing.x * Math.max(20, event.amount ?? 32),
      y: event.position.y - enemy.facing.y * Math.max(20, event.amount ?? 32),
    };
    const path = event.path && event.path.length > 1
      ? [{ ...start }, ...event.path.slice(1).map((point) => ({ ...point }))]
      : [{ ...start }, { ...event.position }];
    const lengths = path.slice(1).map((point, index) => Math.hypot(
      point.x - path[index]!.x,
      point.y - path[index]!.y,
    ));
    const totalLength = Math.max(0.001, lengths.reduce((sum, length) => sum + length, 0));
    const motion = { distance: 0 };
    view.body.setTint(0xf0bd76);
    this.tweens.add({
      targets: motion,
      distance: totalLength,
      duration: enemyPresentationDelay(260, this.enemyActionTempo),
      ease: "Cubic.In",
      onUpdate: () => {
        let remaining = motion.distance;
        let segmentIndex = 0;
        while (segmentIndex < lengths.length - 1 && remaining > lengths[segmentIndex]!) {
          remaining -= lengths[segmentIndex]!;
          segmentIndex += 1;
        }
        const from = path[segmentIndex]!;
        const to = path[segmentIndex + 1] ?? from;
        const ratio = Phaser.Math.Clamp(remaining / Math.max(0.001, lengths[segmentIndex] ?? 1), 0, 1);
        this.displayedEnemyPositions.set(event.actorId!, {
          x: Phaser.Math.Linear(from.x, to.x, ratio),
          y: Phaser.Math.Linear(from.y, to.y, ratio),
        });
      },
      onComplete: () => {
        this.displayedEnemyPositions.set(event.actorId!, { ...event.position! });
        view.body.clearTint();
      },
    });
  }

  private playEnemyHeal(event: BattleEvent): void {
    if (!event.position) return;
    if (event.targetId && event.hpAfter !== undefined) this.displayedEnemyHp.set(event.targetId, event.hpAfter);
    const snapshot = this.runtime.getSnapshot();
    const actor = event.actorId ? snapshot.enemies.find((entry) => entry.id === event.actorId) : undefined;
    const beam = this.add.graphics().setDepth(560);
    if (actor) {
      beam.lineStyle(10, 0x143c29, 0.7).lineBetween(actor.position.x, actor.position.y + ARENA_Y, event.position.x, event.position.y + ARENA_Y);
      beam.lineStyle(4, 0x82e0a6, 0.95).lineBetween(actor.position.x, actor.position.y + ARENA_Y, event.position.x, event.position.y + ARENA_Y);
    }
    this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y, `+${event.amount ?? 0} HP`, 0x82e0a6);
    this.tweens.add({ targets: beam, alpha: 0, duration: 360, onComplete: () => beam.destroy() });
    playSfx(this, "sfx-enemy-heal", 0.38, 1.04);
  }

  private playEnemyProjectileBlocked(event: BattleEvent): void {
    if (!event.position) return;
    const snapshot = this.runtime.getSnapshot();
    const actor = event.actorId ? snapshot.enemies.find((entry) => entry.id === event.actorId) : undefined;
    const origin = actor ? this.displayedEnemyPositions.get(actor.id) ?? actor.position : event.position;
    if (event.intentKind === "ranged") {
      const projectile = this.add.image(origin.x, origin.y + ARENA_Y, "particle")
        .setTint(0xff806f).setScale(1.35).setDepth(590);
      this.tweens.add({
        targets: projectile,
        x: event.position.x,
        y: event.position.y + ARENA_Y,
        duration: enemyPresentationDelay(210, this.enemyActionTempo),
        ease: "Quad.In",
        onComplete: () => {
          this.spawnImpact(event.position!.x, event.position!.y + ARENA_Y, 0x9ed6e3);
          this.spawnStatePopup(event.position!.x, event.position!.y + ARENA_Y - 24, "엄폐!", 0xb8f5ff);
          playSfx(this, "sfx-shield-block", 0.5, 1.08);
          projectile.destroy();
        },
      });
    } else {
      this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y - 24, "경로 차단", 0xb8f5ff);
      playSfx(this, "sfx-shield-block", 0.46, 0.96);
    }
  }

  private playObjectiveDamaged(event: BattleEvent): void {
    if (!event.targetId || !event.position) return;
    if (event.hpAfter !== undefined) this.displayedObjectiveHp.set(event.targetId, event.hpAfter);
    this.displayedObjectiveState.set(event.targetId, (event.hpAfter ?? 1) <= 0 ? "failed" : "protected");
    this.spawnImpact(event.position.x, event.position.y + ARENA_Y, 0xff806f);
    this.popupDamage(event.position.x, event.position.y + ARENA_Y - 18, event.amount ?? 0, false, false, true);
    this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y + 26, "보호 대상 피격", 0xffb09d);
    playSfx(this, "sfx-hero-damage", 0.38, 0.88);
    const body = this.propViews.get(event.targetId)?.body;
    if (body) {
      this.tweens.add({
        targets: body,
        tint: 0xff6f61,
        x: body.x + 7,
        duration: 55,
        yoyo: true,
        repeat: 1,
        onComplete: () => body.clearTint(),
      });
    }
  }

  private playEnemyAttack(event: BattleEvent): void {
    if (!event.actorId || !event.targetId) return;
    const firstActionVisual = !event.actionId || !this.playedEnemyAttackActions.has(event.actionId);
    if (event.actionId) this.playedEnemyAttackActions.add(event.actionId);
    const snapshot = this.runtime.getSnapshot();
    const actor = snapshot.enemies.find((entry) => entry.id === event.actorId);
    const target = snapshot.party.find((entry) => entry.id === event.targetId)
      ?? snapshot.objective.targets.find((entry) => entry.id === event.targetId);
    if (!actor || !target) return;
    const displayedActor = this.displayedEnemyPositions.get(actor.id) ?? actor.position;
    const fromX = displayedActor.x;
    const fromY = displayedActor.y + ARENA_Y;
    const toX = target.position.x;
    const toY = target.position.y + ARENA_Y;
    const behavior = actor.behaviorId;

    if (event.intentKind === "ranged" || behavior === "shooter" || behavior === "summoner") {
      const projectile = this.add.image(fromX, fromY, "particle").setTint(0xff806f).setScale(1.45).setDepth(590);
      const trail = this.add.graphics().setDepth(585);
      trail.lineStyle(7, 0x3d1514, 0.75).lineBetween(fromX, fromY, toX, toY);
      trail.lineStyle(3, 0xff9b74, 0.92).lineBetween(fromX, fromY, toX, toY);
      this.tweens.add({
        targets: projectile,
        x: toX,
        y: toY,
        duration: enemyPresentationDelay(Math.max(150, Math.round((event.duration ?? 0.44) * 520)), this.enemyActionTempo),
        ease: "Quad.In",
        onComplete: () => {
          this.spawnImpact(toX, toY, 0xff806f);
          projectile.destroy();
        },
      });
      this.tweens.add({ targets: trail, alpha: 0, delay: 120, duration: 260, onComplete: () => trail.destroy() });
    } else if (event.intentKind === "area" || behavior === "heavy" || behavior === "splitter") {
      if (firstActionVisual) {
        const radius = Math.max(42, event.areaRadius ?? actor.radius * 1.8);
        const shockwave = this.add.circle(fromX, fromY, 18, 0xe44f43, 0.18).setStrokeStyle(7, 0xff8b75, 0.9).setDepth(570);
        this.tweens.add({ targets: shockwave, scale: radius / 18, alpha: 0, duration: enemyPresentationDelay(330, this.enemyActionTempo), ease: "Cubic.Out", onComplete: () => shockwave.destroy() });
      }
    } else {
      const slash = this.add.graphics().setDepth(590);
      const dx = toX - fromX;
      const dy = toY - fromY;
      const length = Math.hypot(dx, dy) || 1;
      const perpendicularX = -dy / length;
      const perpendicularY = dx / length;
      slash.lineStyle(12, 0x3c1514, 0.72).lineBetween(toX - perpendicularX * 34, toY - perpendicularY * 34, toX + perpendicularX * 34, toY + perpendicularY * 34);
      slash.lineStyle(5, 0xffb16f, 0.96).lineBetween(toX - perpendicularX * 34, toY - perpendicularY * 34, toX + perpendicularX * 34, toY + perpendicularY * 34);
      this.tweens.add({ targets: slash, alpha: 0, scaleX: 1.35, scaleY: 1.35, duration: 280, onComplete: () => slash.destroy() });
    }
    if (firstActionVisual) {
      if (this.screenShakeEnabled) this.cameras.main.shake(120, behavior === "heavy" ? 0.008 : 0.005);
      const projectileAttack = event.intentKind === "ranged" || behavior === "shooter" || behavior === "summoner";
      playSfx(this, projectileAttack ? "sfx-enemy-projectile" : "sfx-enemy-heavy", projectileAttack ? 0.36 : 0.46, behavior === "heavy" ? 0.84 : 1);
    }
  }

  private playHeroDamaged(event: BattleEvent): void {
    if (!event.position || !event.targetId) return;
    const hpAfter = event.hpAfter ?? Math.max(0, (this.displayedHeroHp.get(event.targetId) ?? 0) - (event.amount ?? 0));
    this.displayedHeroHp.set(event.targetId, hpAfter);
    this.popupDamage(event.position.x, event.position.y + ARENA_Y, event.amount ?? 0, false, false, true);
    const snapshot = this.runtime.getSnapshot();
    const sourceName = event.actorId ? this.enemyDisplayName(snapshot, event.actorId) : "적";
    if ((event.mitigatedAmount ?? 0) > 0) {
      this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y + 24, `보호막이 피해 ${event.mitigatedAmount} 방어`, 0x8eeaff);
      playSfx(this, "sfx-shield-block", 0.4, 1.06);
    } else {
      this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y + 24, `${sourceName}의 공격`, 0xffa08e);
      playSfx(this, "sfx-hero-damage", 0.42, 0.94);
    }
    const body = this.heroViews.get(event.targetId)?.body;
    if (body) this.tweens.add({ targets: body, tint: 0xff6f61, x: body.x + 8, duration: 55, yoyo: true, repeat: 1, onComplete: () => body.clearTint() });
  }

  private playHeroDefeated(event: BattleEvent): void {
    if (!event.targetId || !event.position) return;
    this.displayedHeroAlive.set(event.targetId, false);
    const view = this.heroViews.get(event.targetId);
    this.spawnStatePopup(event.position.x, event.position.y + ARENA_Y, "전투 불능", 0xff8c78);
    playSfx(this, "sfx-hero-defeated", 0.56, 0.9);
    if (view) {
      this.tweens.add({
        targets: view.body,
        angle: 12,
        scaleX: view.body.getData("baseScaleX") * 0.78,
        scaleY: view.body.getData("baseScaleY") * 0.78,
        alpha: 0.28,
        duration: 260,
        ease: "Cubic.In",
      });
    }
  }

  private spawnAllyLink(actorId: string | undefined, targetId: string | undefined, x: number, y: number): void {
    const snapshot = this.runtime.getSnapshot();
    const actor = snapshot.party.find((hero) => hero.id === actorId);
    const target = snapshot.party.find((hero) => hero.id === targetId);
    if (actor && target) {
      const beam = this.add.graphics().setDepth(560);
      beam.lineStyle(10, 0x16393d, 0.75).lineBetween(actor.position.x, actor.position.y + ARENA_Y, target.position.x, target.position.y + ARENA_Y);
      beam.lineStyle(3, 0x9ff6e9, 0.95).lineBetween(actor.position.x, actor.position.y + ARENA_Y, target.position.x, target.position.y + ARENA_Y);
      this.tweens.add({ targets: beam, alpha: 0, duration: 320, onComplete: () => beam.destroy() });
      for (const hero of [actor, target]) {
        const body = this.heroViews.get(hero.id)?.body;
        if (body) this.tweens.add({
          targets: body,
          scaleX: body.getData("baseScaleX") * 1.12,
          scaleY: body.getData("baseScaleY") * 1.12,
          duration: 90,
          yoyo: true,
          onComplete: () => body.setScale(body.getData("baseScaleX"), body.getData("baseScaleY")),
        });
      }
    }
    this.spawnImpact(x, y, 0x8de1d8);
    const link = this.add.text(x, y - 38, "LINK!", {
      fontFamily: "Georgia, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(21)}px`, color: "#b8fff2", stroke: "#08262c", strokeThickness: 6,
    }).setOrigin(0.5).setDepth(640);
    this.tweens.add({ targets: link, y: y - 78, alpha: 0, duration: 650, ease: "Cubic.Out", onComplete: () => link.destroy() });
    playSfx(this, "sfx-friendship-link", 0.42, 1.08);
  }

  private showSkillBanner(skillName: string, effectKind?: string, category = "우정 스킬"): void {
    const overlay = BATTLE_HUD_LAYOUT.skillOverlay;
    const centerX = overlay.x + overlay.width / 2;
    const centerY = overlay.y + overlay.height / 2;
    const backdrop = this.add.rectangle(centerX, centerY, overlay.width, overlay.height, 0x07191f, 0.98)
      .setStrokeStyle(2, 0x8de1d8, 0.8)
      .setDepth(700);
    const label = this.add.text(centerX, centerY - 10, `${category}  ·  ${skillName}`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(13)}px`, color: "#dffff7", stroke: "#071014", strokeThickness: 3,
      wordWrap: { width: 286, useAdvancedWrap: true }, align: "center",
    }).setOrigin(0.5).setDepth(701);
    const detail = effectKind ? this.add.text(centerX, centerY + 12, this.effectLabel(effectKind), {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(10)}px`, color: "#8de1d8",
    }).setOrigin(0.5).setDepth(701) : undefined;
    const fadingTargets: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text> = [backdrop, label];
    if (detail) fadingTargets.push(detail);
    if (this.reducedMotion) {
      this.time.delayedCall(520, () => fadingTargets.forEach((target) => target.destroy()));
      return;
    }
    for (const target of fadingTargets) {
      this.tweens.add({ targets: target, y: "+=8", alpha: 0, delay: 620, duration: 260, onComplete: () => target.destroy() });
    }
  }

  private spawnObjectiveProgress(x: number, y: number, current?: number, required?: number): void {
    const text = this.add.text(x, y - 48, current !== undefined && required !== undefined ? `목표 ${objectiveProgressText(current, required)}` : "목표 진행!", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(19)}px`, color: "#ffe987", stroke: "#251c06", strokeThickness: 6,
    }).setOrigin(0.5).setDepth(650);
    if (this.reducedMotion) this.time.delayedCall(520, () => text.destroy());
    else this.tweens.add({ targets: text, y: y - 92, alpha: 0, duration: 850, ease: "Cubic.Out", onComplete: () => text.destroy() });
  }

  private spawnStatePopup(x: number, y: number, message: string, color: number): void {
    const text = this.add.text(x, y - 42, message, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(16)}px`, color: Phaser.Display.Color.IntegerToColor(color).rgba, stroke: "#071014", strokeThickness: 5,
    }).setOrigin(0.5).setDepth(648);
    if (this.reducedMotion) this.time.delayedCall(460, () => text.destroy());
    else this.tweens.add({ targets: text, y: y - 76, alpha: 0, duration: 720, ease: "Cubic.Out", onComplete: () => text.destroy() });
  }

  private effectLabel(effectKind: string): string {
    return battleEffectLabel(effectKind);
  }

  private ricochetSfx(targetId?: string):
    | "sfx-ricochet-stone"
    | "sfx-ricochet-wood"
    | "sfx-ricochet-magic" {
    const wall = targetId ? this.stage.walls.find((entry) => entry.id === targetId) : undefined;
    if (wall?.material === "wood") return "sfx-ricochet-wood";
    if (wall?.material === "spirit") return "sfx-ricochet-magic";
    if (wall) return "sfx-ricochet-stone";

    const hazard = targetId
      ? this.runtime.getSnapshot().hazards.find((entry) => entry.id === targetId)
      : undefined;
    if (!hazard) return "sfx-ricochet-stone";
    if (/table|banquet|raft|shelf|wood/i.test(hazard.id)) return "sfx-ricochet-wood";
    if (hazard.type === "moving-bumper" && !hazard.spawnedBy) return "sfx-ricochet-stone";
    return "sfx-ricochet-magic";
  }

  private applyHitstop(milliseconds: number): void {
    if (this.reducedMotion || milliseconds <= 0) return;
    this.hitstopUntil = Math.max(this.hitstopUntil, this.game.loop.time + milliseconds);
  }

  private flashCamera(duration: number, red: number, green: number, blue: number): void {
    if (this.reducedMotion || duration <= 0) return;
    this.cameras.main.flash(duration, red, green, blue);
  }

  private playSkillFamilyFx(event: BattleEvent): void {
    if (!event.position) return;
    const profile = skillEffectProfile(event.effectKind);
    const y = event.position.y + ARENA_Y;
    this.spawnImpact(event.position.x, y, profile.color);
    const ring = this.add.circle(event.position.x, y, 16, profile.color, 0.08)
      .setStrokeStyle(profile.family === "damage" ? 7 : 4, profile.color, 0.92)
      .setDepth(610);
    if (this.reducedMotion) this.time.delayedCall(150, () => ring.destroy());
    else this.tweens.add({
      targets: ring,
      scale: profile.family === "terrain" ? 7 : 4.5,
      alpha: 0,
      duration: profile.family === "control" ? 420 : 280,
      ease: "Cubic.Out",
      onComplete: () => ring.destroy(),
    });
    const [red, green, blue] = profile.flash;
    this.flashCamera(65, red, green, blue);
    if (this.screenShakeEnabled && profile.shake > 0) this.cameras.main.shake(75, profile.shake);
    this.applyHitstop(profile.hitstopMs);
  }

  private spawnHighSpeedTrail(snapshot: BattleSnapshot, now: number): void {
    if (this.reducedMotion) return;
    const projectile = snapshot.projectile;
    if (!projectile || now - this.lastProjectileTrailAt < 34) return;
    const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
    if (speed < 680) return;
    this.lastProjectileTrailAt = now;
    const member = snapshot.party.find((entry) => entry.id === projectile.actorId);
    const definition = member ? HERO_BY_ID[member.definitionId] : undefined;
    const color = definition?.ricochetClass === "heavy" ? 0xf0bd76
      : definition?.ricochetClass === "burst" ? 0xff8f68
        : definition?.ricochetClass === "pierce" ? 0xb6a7ff
          : 0x8de1d8;
    const trail = this.add.image(projectile.position.x, projectile.position.y + ARENA_Y, "particle")
      .setTint(color)
      .setAlpha(Math.min(0.72, 0.28 + speed / 2400))
      .setScale(Math.min(1.25, 0.32 + speed / 1250))
      .setDepth(112);
    this.tweens.add({
      targets: trail,
      alpha: 0,
      scale: 0.08,
      duration: 190,
      onComplete: () => trail.destroy(),
    });
  }

  private spawnImpact(x: number, y: number, color: number): void {
    const particleCount = this.reducedMotion ? 3 : 8;
    for (let i = 0; i < particleCount; i += 1) {
      const particle = this.add.image(x, y, "particle").setTint(color).setDepth(550).setScale(Phaser.Math.FloatBetween(0.25, 0.75));
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      if (this.reducedMotion) {
        particle.setPosition(x + Math.cos(angle) * 8, y + Math.sin(angle) * 8);
        this.time.delayedCall(120, () => particle.destroy());
      } else {
        const distance = Phaser.Math.Between(20, 55);
        this.tweens.add({ targets: particle, x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance, alpha: 0, scale: 0, duration: 260, onComplete: () => particle.destroy() });
      }
    }
  }

  private playAuthoredFx(
    animationKey: string,
    textureKey: string,
    x: number,
    y: number,
    scale = 1,
  ): void {
    if (!this.anims.exists(animationKey) || !this.textures.exists(textureKey)) return;
    const sprite = this.add.sprite(x, y, textureKey).setDepth(620).setScale(scale);
    sprite.play(animationKey);
    if (this.reducedMotion) sprite.anims.timeScale = 2.2;
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
  }

  private popupDamage(x: number, y: number, amount: number, critical: boolean, weakpoint: boolean, incoming = false): void {
    const text = this.add.text(x, y, `${incoming ? "-" : ""}${amount}${critical ? "!" : ""}`, {
      fontFamily: "Georgia, Malgun Gothic, serif", fontStyle: "bold", fontSize: `${uiTextSize(critical ? 30 : 23)}px`, color: incoming ? "#f18b79" : weakpoint ? "#dfff83" : "#ffffff", stroke: "#071014", strokeThickness: 6,
    }).setOrigin(0.5).setDepth(650);
    if (this.reducedMotion) this.time.delayedCall(420, () => text.destroy());
    else this.tweens.add({
      targets: text,
      y: y - 62,
      alpha: 0,
      scale: critical ? 1.25 : 1,
      duration: 700,
      ease: "Cubic.Out",
      onComplete: () => text.destroy(),
    });
  }

  private finishBattle(victory: boolean, snapshot: BattleSnapshot): void {
    if (this.ended) return;
    if (this.pauseOpen) this.resumeBattle();
    this.ended = true;
    if (!victory || this.endgameMode) this.discardCampaignCheckpoint();
    this.input.removeAllListeners();
    this.activeSkillButton?.disableInteractive();
    this.pendingSkillPlacement = undefined;
    this.skillPlacementMarker?.destroy();
    this.skillPlacementMarker = undefined;
    for (const enemyId of [...this.enemyTelegraphs.keys()]) this.clearEnemyTelegraph(enemyId);
    if (victory) {
      playSfx(this, "sfx-victory", 0.66, 1);
      this.flashCamera(250, 232, 197, 100);
      this.showVictoryFooterBanner();
      if (this.endgameMode) {
        void this.persistEndgameVictoryAndOpenRewards(snapshot);
      } else {
        void this.persistCampaignVictoryAndOpenRewards(snapshot);
      }
    } else {
      playSfx(this, "sfx-defeat", 0.58, 0.9);
      void getServices().save.update((draft) => { draft.records.losses += 1; });
      this.time.delayedCall(350, () => this.showDefeat(snapshot.outcome?.reason));
    }
  }

  private showVictoryFooterBanner(): void {
    this.combatPhaseOverlay?.destroy(true);
    const width = W - 24;
    const height = 124;
    const backdrop = this.add.rectangle(0, 0, width, height, 0x071a1c, 0.99)
      .setStrokeStyle(3, COLORS.gold, 0.96);
    const title = this.add.text(0, -22, "항해 성공", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(28)}px`, color: "#ffe59a",
      stroke: "#251b06", strokeThickness: 5,
    }).setOrigin(0.5);
    const detail = this.add.text(0, 24, `${this.stage.name} · 전리품 정산 중`, {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(14)}px`, color: "#b8e4dc",
    }).setOrigin(0.5);
    const container = this.add.container(W / 2, BATTLE_HUD_LAYOUT.footerTop + height / 2, [backdrop, title, detail])
      .setDepth(900);
    this.combatPhaseOverlay = container;
    if (this.reducedMotion) return;
    container.setAlpha(0).setScale(0.98);
    this.tweens.add({ targets: container, alpha: 1, scale: 1, duration: 180, ease: "Cubic.Out" });
  }

  private async persistEndgameVictoryAndOpenRewards(snapshot: BattleSnapshot): Promise<void> {
    if (!this.endgameMode) return;
    const services = getServices();
    const bestCombo = Math.max(this.bestCombo, snapshot.bestCombo);
    const hpRatio = this.partyHpRatio(snapshot);
    const partyHeroIds = snapshot.party.map((hero) => hero.definitionId);
    const fallenHeroIds = snapshot.party.filter((hero) => !hero.alive).map((hero) => hero.definitionId);
    const stars = calculateStageStars(this.stage, {
      turns: snapshot.completedTurns,
      hpRatio,
      bestCombo,
      fallenHeroCount: fallenHeroIds.length,
    });
    const prepared = prepareEndgameVictorySettlement(services.save.getSnapshot(), {
      mode: this.endgameMode,
      stageId: this.stage.id,
      stars,
      turns: snapshot.completedTurns,
      bestCombo,
      totalDamage: this.totalDamage,
      hpRatio,
      partyHeroIds,
      fallenHeroIds,
      weeklyScoreEnabled: this.weeklyScoreEnabled,
    });
    if (!prepared.ok) {
      this.showVictorySaveError(prepared.message, undefined, snapshot);
      return;
    }
    try {
      await services.save.replace(prepared.save);
      this.queueRewardNavigation(prepared.settlement);
    } catch (error) {
      // replace() keeps the exact frozen settlement in memory; retry only the
      // host write and never recompute the raid phase or reward identity.
      this.showVictorySaveError(
        error instanceof Error ? error.message : "엔드게임 승리 정산표를 저장하지 못했습니다.",
        prepared.settlement,
      );
    }
  }

  private async persistCampaignVictoryAndOpenRewards(snapshot: BattleSnapshot): Promise<void> {
    const services = getServices();
    const bestCombo = Math.max(this.bestCombo, snapshot.bestCombo);
    const hpRatio = this.partyHpRatio(snapshot);
    const partyHeroIds = snapshot.party.map((hero) => hero.definitionId);
    const fallenHeroIds = snapshot.party.filter((hero) => !hero.alive).map((hero) => hero.definitionId);
    const stars = calculateStageStars(this.stage, {
      turns: snapshot.completedTurns,
      hpRatio,
      bestCombo,
      fallenHeroCount: fallenHeroIds.length,
    });
    const prepared = prepareCampaignVictorySettlement(services.save.getSnapshot(), {
      stageId: this.stage.id,
      stars,
      turns: snapshot.completedTurns,
      bestCombo,
      totalDamage: this.totalDamage,
      hpRatio,
      partyHeroIds,
      fallenHeroIds,
    });
    if (!prepared.ok) {
      this.showVictorySaveError(prepared.message, undefined, snapshot);
      return;
    }
    try {
      // Do not navigate or clear the last quiet checkpoint until this durable
      // victory hand-off has reached the host save.
      await services.save.replace(prepared.save);
      this.queueRewardNavigation(prepared.settlement);
    } catch (error) {
      // replace() already installed the settlement in memory. Keep the battle
      // and checkpoint recoverable, and let the player retry that exact save.
      this.showVictorySaveError(
        error instanceof Error ? error.message : "승리 정산표를 저장하지 못했습니다.",
        prepared.settlement,
      );
    }
  }

  private showVictorySaveError(
    reason: string,
    settlement?: {
      stageId: string;
      turns: number;
      bestCombo: number;
      totalDamage: number;
      hpRatio: number;
      partyHeroIds: string[];
      fallenHeroIds: string[];
      weeklyScoreEnabled?: boolean;
      mode?: BattleSceneData["endgameMode"];
      endgameMode?: BattleSceneData["endgameMode"];
    },
    retrySnapshot?: BattleSnapshot,
  ): void {
    for (const object of this.victorySaveErrorObjects) object.destroy();
    setUiFocusScope(this, "battle-victory-save-error", "battle-victory-save-retry");
    const shade = this.add.rectangle(W / 2, H / 2, W, H, 0x020507, 0.84).setDepth(5000).setInteractive();
    const panel = addPanel(this, 72, 360, 576, 520, COLORS.red, 0.99).setDepth(5001);
    const title = this.add.text(W / 2, 462, "승리 기록을 안전하게 저장하는 중입니다", {
      fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(25)}px`,
      color: "#ffd0c3", align: "center", wordWrap: { width: 500 },
    }).setOrigin(0.5).setDepth(5002);
    const body = this.add.text(W / 2, 565, "보상은 아직 지급되지 않았고 전투 정산표는 남아 있습니다.\n정산 준비 또는 저장에 성공한 뒤 보상 화면으로 이동합니다.", {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, lineSpacing: 8,
      color: "#d8e3dd", align: "center", wordWrap: { width: 490 },
    }).setOrigin(0.5).setDepth(5002);
    const detail = this.add.text(W / 2, 646, reason, {
      fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(11)}px`, color: "#b9a29c",
      align: "center", wordWrap: { width: 470 },
    }).setOrigin(0.5).setDepth(5002);
    const retry = addButton(this, W / 2, 720, settlement ? "저장 다시 시도" : "정산 다시 준비", {
      width: 360,
      height: 70,
      accent: COLORS.gold,
      enabled: Boolean(settlement || retrySnapshot),
      focusKey: "battle-victory-save-retry",
      onClick: () => {
        if (this.victorySaveRetrying) return;
        this.victorySaveRetrying = true;
        if (!settlement && retrySnapshot) {
          for (const object of this.victorySaveErrorObjects) object.destroy();
          this.victorySaveErrorObjects = [];
          const retryPrepare = this.endgameMode
            ? this.persistEndgameVictoryAndOpenRewards(retrySnapshot)
            : this.persistCampaignVictoryAndOpenRewards(retrySnapshot);
          void retryPrepare.finally(() => { this.victorySaveRetrying = false; });
          return;
        }
        if (!settlement) {
          this.victorySaveRetrying = false;
          return;
        }
        void getServices().save.saveNow().then(() => {
          for (const object of this.victorySaveErrorObjects) object.destroy();
          this.victorySaveErrorObjects = [];
          this.queueRewardNavigation(settlement);
        }).catch((error: unknown) => {
          this.showVictorySaveError(
            error instanceof Error ? error.message : "승리 정산표를 저장하지 못했습니다.",
            settlement,
          );
        }).finally(() => {
          this.victorySaveRetrying = false;
        });
      },
    }).setDepth(5003);
    const harbor = addButton(this, W / 2, 812, "항구에서 복구", {
      width: 320,
      height: 58,
      focusKey: "battle-victory-save-harbor",
      onClick: () => fadeTo(this, "Harbor"),
    }).setDepth(5003);
    this.victorySaveErrorObjects = [shade, panel, title, body, detail, retry, harbor];
  }

  private queueRewardNavigation(data: {
    stageId: string;
    turns: number;
    bestCombo: number;
    totalDamage: number;
    hpRatio: number;
    partyHeroIds: readonly string[];
    fallenHeroIds: readonly string[];
    weeklyScoreEnabled?: boolean;
    mode?: BattleSceneData["endgameMode"];
    endgameMode?: BattleSceneData["endgameMode"];
  }): void {
    this.time.delayedCall(this.reducedMotion ? 650 : 950, () => fadeTo(this, "Reward", {
      stageId: data.stageId,
      turns: data.turns,
      bestCombo: data.bestCombo,
      totalDamage: data.totalDamage,
      hpRatio: data.hpRatio,
      partyHeroIds: [...data.partyHeroIds],
      fallenHeroIds: [...data.fallenHeroIds],
      weeklyScoreEnabled: data.weeklyScoreEnabled ?? false,
      endgameMode: data.endgameMode ?? data.mode,
    }));
  }

  private showDefeat(reason?: NonNullable<BattleSnapshot["outcome"]>["reason"]): void {
    const reasonCopy = reason === "turnLimit"
      ? { title: "제한 턴 초과", detail: "목표를 끝내기 전에 시간이 다했습니다.", rescue: "다이아 60 · 전원 체력 50% · 추가 3턴" }
      : reason === "objectiveFailed"
        ? { title: "보호 목표 실패", detail: "파괴되거나 금지된 목표를 복구해야 합니다.", rescue: "다이아 60 · 목표 복구 · 전원 체력 50%" }
        : { title: "선원 전투 불능", detail: "모든 선원이 쓰러졌습니다. 진형과 충돌각을 바꿔 보세요.", rescue: "다이아 60 · 현재 전투 유지 · 전원 체력 50%" };
    setUiFocusScope(this, "battle-defeat", "battle-defeat-rescue");
    const shade = this.add.rectangle(W / 2, H / 2, W, H, 0x020507, 0.78).setDepth(1000).setInteractive();
    addPanel(this, 70, 344, 580, 530, COLORS.red, 0.98).setDepth(1010);
    this.add.text(W / 2, 420, "항해 실패", { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(42)}px`, color: "#f2c0aa", stroke: "#34130f", strokeThickness: 7 }).setOrigin(0.5).setDepth(1020);
    this.add.text(W / 2, 480, reasonCopy.title, { fontFamily: "Malgun Gothic, sans-serif", fontStyle: "bold", fontSize: `${uiTextSize(20)}px`, color: "#ffd5c5", align: "center" }).setOrigin(0.5).setDepth(1020);
    this.add.text(W / 2, 522, reasonCopy.detail, { fontFamily: "Malgun Gothic, sans-serif", fontSize: `${uiTextSize(15)}px`, lineSpacing: 7, color: "#b9cbc6", align: "center", wordWrap: { width: 500 } }).setOrigin(0.5).setDepth(1020);
    addButton(this, W / 2, 620, "고양이 여신의 구조", { width: 410, height: 82, icon: "◆", subtitle: reasonCopy.rescue, accent: 0x79ced8, primary: true, focusKey: "battle-defeat-rescue", onClick: () => void this.buyRescue() }).setDepth(1030);
    addButton(this, W / 2, 710, "그대로 재도전", { width: 410, height: 72, icon: "↻", focusKey: "battle-defeat-retry", onClick: () => fadeTo(this, "Battle", { stageId: this.stage.id, endgameMode: this.endgameMode }) }).setDepth(1030);
    addButton(this, W / 2, 804, "항구로 귀환", { width: 410, height: 66, focusKey: "battle-defeat-harbor", onClick: () => fadeTo(this, "Harbor") }).setDepth(1030);
    shade.once("pointerup", () => undefined);
  }

  private async buyRescue(): Promise<void> {
    if (this.rescuePurchasePending) return;
    this.rescuePurchasePending = true;
    const services = getServices();
    try {
      if (services.save.getSnapshot().recovery.pendingBattleRescue) {
        addToast(this, "사용하지 않은 구조 전투를 먼저 이어가세요", COLORS.gold);
        return;
      }
      const battleSnapshot = this.runtime.serialize();
      const result = await services.purchases.purchase({
        actionId: "battle-rescue",
        reward: createBattleRescueReward(
          this.stage.id,
          battleRescueMode(this.endgameMode),
          battleSnapshot,
          this.battlePartyDefinitions,
        ),
      });
      if (!result.ok) {
        addToast(this, result.message, COLORS.red);
        return;
      }
      reconcileWalletAfterPurchase(services, result);
      // Keep the committed rescue pending until the next Battle scene has
      // actually started. A close/crash between purchase and transition can
      // then recover the paid rescue instead of losing it.
      fadeTo(this, "Battle", {
        stageId: this.stage.id,
        endgameMode: this.endgameMode,
        resumeRescue: true,
      });
    } catch (error) {
      addToast(this, error instanceof Error ? error.message : "구조 결제를 완료하지 못했습니다.", COLORS.red);
    } finally {
      this.rescuePurchasePending = false;
    }
  }

  private async confirmRetreat(): Promise<void> {
    const approved = await getServices().host.ui.confirm({
      title: translateText("항구로 귀환"),
      message: translateText("현재 전투 진행은 사라집니다. 귀환할까요?"),
    });
    if (approved) {
      this.discardCampaignCheckpoint();
      fadeTo(this, "Harbor");
    }
  }

  private findWeakpointEnemy(weakpointId: string | undefined): string | undefined {
    if (!weakpointId) return undefined;
    return this.runtime.getSnapshot().enemies.find((enemy) => enemy.weakpoints.some((weakpoint) => weakpoint.id === weakpointId))?.id;
  }

  private objectiveLabel(): string {
    const type = this.stage.objective.type;
    if (type === "break-parts") return "목표  ·  지정 부위 파괴";
    if (type === "assemble") return "목표  ·  뗏목 부품 운반 및 결속";
    if (type === "survive") return `목표  ·  ${this.stage.objective.turnLimit}턴 생존`;
    if (type === "protect" && this.stage.modifiers.includes("ally-contact-cleanses-sleep")) return "목표  ·  잠든 선원 깨우기";
    if (type === "protect" && this.stage.modifiers.includes("forbidden-target-contact-fails-stage")) return "목표  ·  보호 대상에 닿지 않고 버티기";
    if (type === "protect" && this.stage.modifiers.includes("protected-memory-loses-hp-on-enemy-action")) return "목표  ·  기억의 불꽃 지키기";
    if (type === "protect") return "목표  ·  보호 대상 지키기";
    if (type === "seal") return "목표  ·  봉인 목표 활성화";
    if (type === "escape") return "목표  ·  출구 도달";
    return "목표  ·  모든 적 격파";
  }

  private getObjectiveProgress(snapshot: BattleSnapshot): { label: string; current: number; required: number } {
    if (this.stage.objective.type === "defeat-all") {
      const remaining = snapshot.enemies.filter((enemy) => enemy.alive).length;
      return {
        label: remaining > 0 ? `${this.objectiveLabel()} · 잔여 ${remaining}` : `${this.objectiveLabel()}  ✓`,
        current: snapshot.enemies.length - remaining,
        required: Math.max(1, snapshot.enemies.length),
      };
    }
    const extended = snapshot as BattleSnapshot & {
      objective?: { readonly current: number; readonly required: number; readonly completed: boolean };
    };
    if (extended.objective) {
      return {
        label: extended.objective.completed ? `${this.objectiveLabel()}  ✓` : this.objectiveLabel(),
        current: extended.objective.current,
        required: extended.objective.required,
      };
    }

    const type = this.stage.objective.type;
    if (type === "assemble") {
      const assembled = snapshot.props.filter((prop) => prop.visualState === "lashed").length;
      return { label: this.objectiveLabel(), current: assembled, required: Math.max(1, this.stage.objective.requiredCount ?? this.stage.objective.targetIds.length) };
    }
    if (type === "break-parts") {
      const broken = snapshot.enemies.flatMap((enemy) => enemy.weakpoints).filter((weakpoint) => weakpoint.broken).length;
      return { label: this.objectiveLabel(), current: broken, required: Math.max(1, this.stage.objective.requiredCount ?? this.stage.objective.targetIds.length) };
    }
    if (type === "survive" || type === "protect") {
      return { label: this.objectiveLabel(), current: snapshot.completedTurns, required: this.stage.objective.turnLimit };
    }
    return { label: this.objectiveLabel(), current: 0, required: Math.max(1, this.stage.objective.requiredCount ?? this.stage.objective.targetIds.length) };
  }

  private hazardLabel(type: StageDefinition["hazards"][number]["type"]): string {
    return {
      "slow-field": "감속 지대",
      "wind-vector": "바람",
      current: "해류",
      whirlpool: "소용돌이",
      "sound-wave": "음파",
      portal: "차원문",
      lightning: "낙뢰",
      "forbidden-target": "접촉 금지",
      "moving-bumper": "이동 장애물",
      "one-way-wall": "일방 반사벽",
      "wave-front": "쇄도 파도",
    }[type];
  }

  private partyHpRatio(snapshot: BattleSnapshot): number {
    const hp = snapshot.party.reduce((sum, hero) => sum + hero.hp, 0);
    const max = snapshot.party.reduce((sum, hero) => sum + hero.maxHp, 0);
    return max > 0 ? hp / max : 0;
  }

  private themeTint(): number {
    const route = Number(this.stage.routeId.match(/route-(\d+)/)?.[1] ?? 1);
    return [0x5d9b98, 0x9f719e, 0x9c714f, 0x80a8bd, 0x8d6b94, 0x5b6588, 0x4e849a, 0x536779, 0xc39858, 0x6c9877][route - 1] ?? 0x6d9690;
  }

  private heroTint(hero: HeroDefinition): number {
    return { sea: 0x78dce2, sun: 0xf0b453, moon: 0xb89be1, storm: 0x86baf0, earth: 0xbf865b, spirit: 0x82d0ae }[hero.element];
  }

  private enemyTint(element: keyof typeof this.elementTint): number { return this.elementTint[element]; }
  private readonly elementTint = { sea: 0x508f9c, sun: 0xc58b43, moon: 0x816aa5, storm: 0x6287ad, earth: 0x8f6146, spirit: 0x609477 };
}
