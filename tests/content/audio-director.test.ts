import { describe, expect, it } from "vitest";
import { stageBgmKey } from "../../src/audio/musicRoles";

describe("authored stage music roles", () => {
  it("keeps bosses and stages inside their narrative region's score", () => {
    expect(stageBgmKey("bgm-boss-poly", true)).toBe("bgm-boss-cyclops");
    expect(stageBgmKey("bgm-cyclops-deep", false)).toBe("bgm-voyage-cyclops-cave");
    expect(stageBgmKey("bgm-underworld-memory", false)).toBe("bgm-voyage-underworld");
    expect(stageBgmKey("bgm-strait-deep", false)).toBe("bgm-voyage-black-strait");
    expect(stageBgmKey("bgm-boss-scylla", true)).toBe("bgm-voyage-black-strait");
    expect(stageBgmKey("bgm-boss-siren", true)).toBe("bgm-voyage-sirens");
    expect(stageBgmKey("bgm-boss-circe", true)).toBe("bgm-voyage-circe-palace");
    expect(stageBgmKey("bgm-boss-lotus", true)).toBe("bgm-voyage-enchanted");
    expect(stageBgmKey("bgm-boss-final", true)).toBe("bgm-boss-homecoming-duel");
    expect(stageBgmKey("bgm-voyage-rising", false)).toBe("bgm-voyage-open-sea");
    expect(stageBgmKey("bgm-aeolus", false)).toBe("bgm-voyage-winds");
    expect(stageBgmKey("bgm-giant-harbor", false)).toBe("bgm-voyage-winds");
    expect(stageBgmKey("bgm-thrinacia-night", false)).toBe("bgm-voyage-thrinacia-sun");
    expect(stageBgmKey("bgm-boss-zeus", true)).toBe("bgm-voyage-thrinacia-sun");
    expect(stageBgmKey("bgm-boss-storm", true)).toBe("bgm-voyage-open-sea");
    expect(stageBgmKey("bgm-boss-wind", true)).toBe("bgm-voyage-winds");
    expect(stageBgmKey("bgm-oracle", false)).toBe("bgm-endgame-oracle");
  });

  it("gives unknown future authored roles a stable playable fallback", () => {
    expect(stageBgmKey("bgm-future-uncharted-island", false)).toBe("bgm-voyage-ricochet");
    expect(stageBgmKey("", false)).toBe("bgm-voyage-ricochet");
    expect(stageBgmKey("bgm-future-boss", true)).toBe("bgm-voyage-thrinacia-sun");
  });
});
