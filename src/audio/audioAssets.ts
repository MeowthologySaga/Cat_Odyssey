import type { BgmKey } from "./musicRoles";

/** Stable runtime URLs. BGM is streamed on first use; short SFX is boot-loaded. */
export const BGM_ASSETS = {
  "bgm-harbor-homeward": "assets/audio/bgm/harbor-homeward.mp3",
  "bgm-voyage-ricochet": "assets/audio/bgm/voyage-ricochet.mp3",
  "bgm-voyage-open-sea": "assets/audio/bgm/voyage-open-sea.mp3",
  "bgm-voyage-enchanted": "assets/audio/bgm/voyage-enchanted.mp3",
  "bgm-voyage-cyclops-cave": "assets/audio/bgm/voyage-cyclops-cave.mp3",
  "bgm-boss-cyclops": "assets/audio/bgm/boss-cyclops.mp3",
  "bgm-voyage-winds": "assets/audio/bgm/voyage-winds.mp3",
  "bgm-voyage-circe-palace": "assets/audio/bgm/voyage-circe-palace.mp3",
  "bgm-voyage-underworld": "assets/audio/bgm/voyage-underworld.mp3",
  "bgm-voyage-black-strait": "assets/audio/bgm/voyage-black-strait.mp3",
  "bgm-voyage-thrinacia-sun": "assets/audio/bgm/voyage-thrinacia-sun.mp3",
  "bgm-voyage-sirens": "assets/audio/bgm/voyage-sirens.mp3",
  "bgm-voyage-homecoming": "assets/audio/bgm/voyage-homecoming.mp3",
  "bgm-boss-homecoming-duel": "assets/audio/bgm/boss-homecoming-duel.mp3",
  "bgm-endgame-oracle": "assets/audio/bgm/endgame-oracle.mp3",
  "bgm-oracle-summon": "assets/audio/bgm/oracle-summon.mp3",
} as const satisfies Record<BgmKey, string>;

export const BOOT_BGM_KEYS = ["bgm-harbor-homeward"] as const satisfies readonly BgmKey[];

export const SFX_ASSETS = {
  // Compatibility keys retained while authored battle events migrate.
  "sfx-ricochet-hit": "assets/audio/sfx/ricochet-hit.mp3",
  "sfx-summon-reveal": "assets/audio/sfx/summon-reveal.mp3",

  "sfx-ui-confirm": "assets/audio/sfx/ui-confirm.mp3",
  "sfx-ui-cancel": "assets/audio/sfx/ui-cancel.mp3",
  "sfx-ui-error": "assets/audio/sfx/ui-error.mp3",
  "sfx-launch-light": "assets/audio/sfx/launch-light.mp3",
  "sfx-launch-heavy": "assets/audio/sfx/launch-heavy.mp3",
  "sfx-ricochet-stone": "assets/audio/sfx/ricochet-stone.mp3",
  "sfx-ricochet-wood": "assets/audio/sfx/ricochet-wood.mp3",
  "sfx-ricochet-magic": "assets/audio/sfx/ricochet-magic.mp3",
  "sfx-hit-light": "assets/audio/sfx/hit-light.mp3",
  "sfx-hit-critical": "assets/audio/sfx/hit-critical.mp3",
  "sfx-weakpoint-break": "assets/audio/sfx/weakpoint-break.mp3",
  "sfx-shield-block": "assets/audio/sfx/shield-block.mp3",
  "sfx-shield-break": "assets/audio/sfx/shield-break.mp3",
  "sfx-friendship-link": "assets/audio/sfx/friendship-link.mp3",
  "sfx-active-ready": "assets/audio/sfx/active-ready.mp3",
  "sfx-active-cast": "assets/audio/sfx/active-cast.mp3",
  "sfx-turn-player": "assets/audio/sfx/turn-player.mp3",
  "sfx-turn-enemy": "assets/audio/sfx/turn-enemy.mp3",
  "sfx-enemy-telegraph": "assets/audio/sfx/enemy-telegraph.mp3",
  "sfx-enemy-heavy": "assets/audio/sfx/enemy-heavy.mp3",
  "sfx-enemy-projectile": "assets/audio/sfx/enemy-projectile.mp3",
  "sfx-enemy-heal": "assets/audio/sfx/enemy-heal.mp3",
  "sfx-enemy-spawn": "assets/audio/sfx/enemy-spawn.mp3",
  "sfx-hero-damage": "assets/audio/sfx/hero-damage.mp3",
  "sfx-hero-defeated": "assets/audio/sfx/hero-defeated.mp3",
  "sfx-hazard-warning": "assets/audio/sfx/hazard-warning.mp3",
  "sfx-boss-phase": "assets/audio/sfx/boss-phase.mp3",
  "sfx-victory": "assets/audio/sfx/victory.mp3",
  "sfx-defeat": "assets/audio/sfx/defeat.mp3",
  "sfx-objective-success": "assets/audio/sfx/objective-success.mp3",
  "sfx-objective-fail": "assets/audio/sfx/objective-fail.mp3",
  "sfx-reward-chest": "assets/audio/sfx/reward-chest.mp3",
  "sfx-summon-rare": "assets/audio/sfx/summon-rare.mp3",
} as const;

export type SfxKey = keyof typeof SFX_ASSETS;
