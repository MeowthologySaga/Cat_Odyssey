import { describe, expect, it } from "vitest";

import { validateStageContract } from "../../scripts/stage-contract-validator.mjs";

function validStage() {
  return {
    id: "ugc-raft-01",
    arena: {
      width: 720,
      height: 1040,
      backgroundAssetUrl: "assets/art/maps/stages/ugc-raft-01.webp",
    },
    walls: [{
      id: "rail",
      shape: "capsule",
      x: 120,
      y: 500,
      x2: 420,
      y2: 500,
      radius: 28,
      presentation: {
        visualId: "wall-raft-rail",
        width: 300,
        height: 64,
      },
    }],
    spawns: [
      { id: "party", kind: "party", x: 360, y: 920, radius: 42 },
      {
        id: "log-a",
        kind: "prop",
        x: 180,
        y: 700,
        radius: 32,
        presentation: {
          visualId: "prop-log-idle",
          width: 140,
          height: 70,
          stateVisualIds: { positioned: "prop-log-positioned", lashed: "prop-log-lashed" },
        },
        interaction: { mode: "assembly", hitsRequired: 2, destination: { x: 300, y: 520 } },
      },
    ],
    enemies: [],
    hazards: [{
      id: "wave-a",
      type: "wave-front",
      x: 360,
      y: 900,
      radius: 72,
      parameters: {
        axis: "y",
        direction: -1,
        distance: 500,
        warningTurns: 1,
        activeTurns: 4,
        length: 720,
        forceX: 0,
        forceY: -100,
        damage: 40,
      },
    }],
    objective: { type: "assemble", turnLimit: 8, targetIds: ["log-a"], requiredCount: 1 },
    modifiers: [],
    boss: null,
  };
}

const validAssets = new Set([
  "assets/art/maps/stages/ugc-raft-01.webp",
  "assets/art/walls/wall-raft-rail.webp",
  "assets/art/props/prop-log-idle.webp",
  "assets/art/props/prop-log-positioned.webp",
  "assets/art/props/prop-log-lashed.webp",
]);
const assetExists = (assetUrl) => validAssets.has(assetUrl);

describe("generic stage contract validator", () => {
  it("accepts a complete assemble stage with authored art and wave geometry", () => {
    expect(validateStageContract(validStage(), { assetExists })).toEqual([]);
  });

  it("rejects an angular sound-wave whose fan has no count", () => {
    const stage = validStage();
    stage.hazards = [{
      id: "bite-preview",
      type: "sound-wave",
      x: 360,
      y: 240,
      radius: 160,
      parameters: { fanDegrees: 70, damage: 105 },
    }];
    expect(validateStageContract(stage).join("\n")).toMatch(/fanDegrees requires a positive integer fanCount/);
  });

  it("rejects a solid circular wall that seals a boss objective away from the party", () => {
    const stage = validStage();
    stage.walls = [{
      id: "sealed-ring",
      shape: "circle",
      x: 360,
      y: 330,
      radius: 225,
      material: "coral",
      restitution: 1,
    }];
    stage.spawns.push({ id: "boss", kind: "boss", x: 360, y: 280, radius: 74 });
    stage.enemies = [{ enemyId: "sealed-boss", spawnId: "boss", level: 1, elite: true }];
    stage.objective = { type: "break-parts", turnLimit: 10, targetIds: ["boss-core"], requiredCount: 1 };
    stage.boss = {
      bossId: "sealed-boss",
      supportBossIds: [],
      phaseIds: ["sealed"],
      anatomy: {},
      parts: [{ id: "boss-core", kind: "core", count: 1, collider: "circle", weakpoint: true, breakable: true }],
    };
    expect(validateStageContract(stage).join("\n")).toMatch(/solid circle wall sealed-ring seals the objective boss/);
  });

  it("rejects unresolved targets and malformed assembly interactions", () => {
    const stage = validStage();
    stage.objective.targetIds = ["missing-log", "log-a"];
    stage.objective.requiredCount = 2;
    stage.spawns[1].interaction = {
      mode: "assembly",
      hitsRequired: 0,
      maxHp: 2,
      destination: { x: 10, y: 520 },
    };
    const errors = validateStageContract(stage, { assetExists });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("missing-log"),
      expect.stringContaining("hitsRequired"),
      expect.stringContaining("must not mix"),
      expect.stringContaining("destination must stay inside"),
    ]));
  });

  it("rejects missing background and presentation state assets", () => {
    const errors = validateStageContract(validStage(), { assetExists: () => false });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("background asset is missing"),
      expect.stringContaining("prop-log-lashed.webp"),
      expect.stringContaining("wall-raft-rail.webp"),
    ]));
  });

  it("rejects visible wall art on a zero-thickness collider in commercial mode", () => {
    const stage = validStage();
    stage.walls[0].shape = "segment";
    delete stage.walls[0].radius;
    const errors = validateStageContract(stage, {
      assetExists,
      commercialStrict: true,
      isModifierSupported: () => true,
      playerVisibleObjectiveTypes: new Set(["assemble"]),
      partySizes: [1, 2, 3],
    });
    expect(errors.join("\n")).toMatch(/zero-thickness segment collider/);
  });

  it("rejects unsafe background paths and incomplete wave-front parameters", () => {
    const stage = validStage();
    stage.arena.backgroundAssetUrl = "../private/map.webp";
    stage.hazards[0].parameters = {
      axis: "diagonal",
      direction: 0,
      distance: -1,
      warningTurns: -1,
      activeTurns: 0,
      length: 0,
      forceX: 0,
      forceY: 0,
      damage: -2,
    };
    const errors = validateStageContract(stage, { assetExists });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("safe public WebP"),
      expect.stringContaining("axis must"),
      expect.stringContaining("direction must"),
      expect.stringContaining("activeTurns"),
      expect.stringContaining("non-zero force"),
    ]));
  });

  it("enforces commercial art coverage and accepts only structured transition waivers", () => {
    const stage = validStage();
    delete stage.arena.backgroundAssetUrl;
    delete stage.walls[0].presentation;
    delete stage.spawns[1].presentation;
    const strictOptions = {
      assetExists,
      commercialStrict: true,
      isModifierSupported: () => true,
      playerVisibleObjectiveTypes: new Set(["assemble"]),
      partySizes: [1, 2, 3],
    };
    expect(validateStageContract(stage, strictOptions)).toEqual(expect.arrayContaining([
      expect.stringContaining("backgroundAssetUrl"),
      expect.stringContaining("wall rail requires presentation"),
      expect.stringContaining("prop log-a requires presentation"),
    ]));

    expect(validateStageContract(stage, {
      ...strictOptions,
      commercialWaivers: [{
        id: "ugc-art-transition",
        gates: ["backgroundAssetUrl", "wall-presentation", "prop-presentation"],
        reason: "The final layered art is in an active production pass.",
        sunset: "remove-before-release",
      }],
    })).toEqual([]);
  });

  it("rejects unsupported player-visible effects and copy/runtime drift in strict mode", () => {
    const stage = validStage();
    stage.modifiers = ["unwired-magic-description"];
    const errors = validateStageContract(stage, {
      assetExists,
      commercialStrict: true,
      isModifierSupported: () => false,
      playerVisibleObjectiveTypes: new Set(["defeat-all"]),
      partySizes: [1, 2, 3],
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("unsupported player-visible effect"),
      expect.stringContaining("no player-facing description"),
    ]));
  });

  it("blocks party-size contracts that require three elements from a solo or duo", () => {
    const stage = validStage();
    stage.modifiers = ["three-color-seal"];
    const errors = validateStageContract(stage, {
      assetExists,
      commercialStrict: true,
      isModifierSupported: () => true,
      playerVisibleObjectiveTypes: new Set(["assemble"]),
      partySizes: [1, 2, 3],
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("1-hero party"),
      expect.stringContaining("2-hero party"),
    ]));
  });
});
