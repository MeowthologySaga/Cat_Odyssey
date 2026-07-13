export type BgmKey =
  | "bgm-harbor-homeward"
  | "bgm-voyage-ricochet"
  | "bgm-voyage-open-sea"
  | "bgm-voyage-enchanted"
  | "bgm-voyage-cyclops-cave"
  | "bgm-boss-cyclops"
  | "bgm-voyage-winds"
  | "bgm-voyage-circe-palace"
  | "bgm-voyage-underworld"
  | "bgm-voyage-black-strait"
  | "bgm-voyage-thrinacia-sun"
  | "bgm-voyage-sirens"
  | "bgm-voyage-homecoming"
  | "bgm-boss-homecoming-duel"
  | "bgm-endgame-oracle"
  | "bgm-oracle-summon";

/** Resolve authored stage music roles to the currently installed stable tracks. */
export function stageBgmKey(musicKey: string, boss: boolean): BgmKey {
  const role = musicKey.toLowerCase();

  if (role.includes("oracle") || role.includes("endgame")) return "bgm-endgame-oracle";
  if (role.includes("summon")) return "bgm-oracle-summon";
  if (role.includes("zeus")) return "bgm-voyage-thrinacia-sun";

  // Named regions win over the generic boss flag so each boss keeps its
  // narrative area's musical identity instead of sharing one universal cue.
  if (role.includes("final")) return "bgm-boss-homecoming-duel";
  if (role.includes("ithaca") || role.includes("homecoming")) return "bgm-voyage-homecoming";
  if (role.includes("siren")) return "bgm-voyage-sirens";
  if (role.includes("underworld") || role.includes("hades") || role.includes("memory")) {
    return "bgm-voyage-underworld";
  }
  if (role.includes("boss-poly")) return "bgm-boss-cyclops";
  if (role.includes("cyclops") || role.includes("poly")) {
    return "bgm-voyage-cyclops-cave";
  }
  if (role.includes("circe")) {
    return "bgm-voyage-circe-palace";
  }
  if (role.includes("lotus") || role.includes("enchanted")) {
    return "bgm-voyage-enchanted";
  }
  if (role.includes("thrinacia")) {
    return "bgm-voyage-thrinacia-sun";
  }
  if (
    role.includes("strait") ||
    role.includes("scylla") ||
    role.includes("charybdis")
  ) {
    return "bgm-voyage-black-strait";
  }
  if (
    role.includes("aeolus") ||
    role.includes("wind") ||
    role.includes("giant-harbor")
  ) {
    return "bgm-voyage-winds";
  }
  if (
    role.includes("ogygia")
    || role.includes("voyage-calm")
    || role.includes("voyage-rising")
    || role.includes("open-sea")
    || role.includes("storm")
  ) return "bgm-voyage-open-sea";
  if (boss || role.includes("boss")) return "bgm-voyage-thrinacia-sun";
  if (role.includes("calm") || role.includes("harbor")) return "bgm-harbor-homeward";
  return "bgm-voyage-ricochet";
}
