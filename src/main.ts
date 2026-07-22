import Phaser from "phaser";
import "./styles.css";
import { initializeServices } from "./core/services";
import { BootScene } from "./scenes/BootScene";
import { TitleScene } from "./scenes/TitleScene";
import { HarborScene } from "./scenes/HarborScene";
import { RouteScene } from "./scenes/RouteScene";
import { PartyScene } from "./scenes/PartyScene";
import { BattleScene } from "./scenes/BattleScene";
import { RewardScene } from "./scenes/RewardScene";
import { SummonScene } from "./scenes/SummonScene";
import { EndgameScene } from "./scenes/EndgameScene";
import { TutorialScene } from "./scenes/TutorialScene";
import { StoryScene } from "./scenes/StoryScene";
import { SettingsScene } from "./scenes/SettingsScene";
import { CutsceneScene } from "./scenes/CutsceneScene";
import { CollectionScene } from "./scenes/CollectionScene";
import { GAME_INPUT_CONFIG } from "./input/gameInput";
import { configureDebugBridge } from "./core/debugBridge";
import { isDebugModeRequested } from "./core/debugMode";
import { DebugScene } from "./scenes/DebugScene";
import { installPhaserTextLocalization, translateText } from "./localization";

async function start(): Promise<void> {
  const debugMode = isDebugModeRequested(window.location.search);
  const services = await initializeServices({ debugMode });
  installPhaserTextLocalization(Phaser);
  const directFilePreview = window.location.protocol === "file:";
  const game = new Phaser.Game({
    type: directFilePreview ? Phaser.CANVAS : Phaser.AUTO,
    parent: "game-root",
    width: 720,
    height: 1280,
    backgroundColor: "#06141c",
    disableContextMenu: true,
    transparent: false,
    antialias: true,
    pixelArt: false,
    roundPixels: true,
    render: { powerPreference: "high-performance", antialias: true },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 720,
      height: 1280,
    },
    input: GAME_INPUT_CONFIG,
    ...(directFilePreview ? {
      loader: { imageLoadType: "HTMLImageElement" as const },
      audio: { disableWebAudio: true },
    } : {}),
    scene: [BootScene, TitleScene, TutorialScene, CutsceneScene, StoryScene, SettingsScene, HarborScene, CollectionScene, RouteScene, PartyScene, BattleScene, RewardScene, SummonScene, EndgameScene, DebugScene],
  });

  configureDebugBridge(window, debugMode, () => ({
    game,
    services,
    version: "0.2.3",
    content: "10 routes / 43 stages",
  }));
}

start().catch((error: unknown) => {
  const root = document.querySelector<HTMLElement>("#game-root");
  if (root) root.textContent = translateText(`항해 준비에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
  throw error;
});
