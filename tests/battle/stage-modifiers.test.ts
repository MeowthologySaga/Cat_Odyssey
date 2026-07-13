import { describe, expect, it } from "vitest";

import { STAGES } from "../../src/data";
import {
  EXACT_STAGE_MODIFIER_REGISTRY,
  STAGE_MODIFIER_CATEGORIES,
  assertStageModifiersRecognized,
  compileStageDefinitionModifiers,
  compileStageModifier,
  compileStageModifiers,
  findStageModifierEffect,
} from "../../src/core/battle/stageModifiers";

const authoredModifiers = [...new Set(STAGES.flatMap((stage) => stage.modifiers))].sort();

describe("stage modifier content coverage", () => {
  it("recognizes all 61 unique authored modifiers with concrete gameplay effects", () => {
    expect(authoredModifiers).toHaveLength(61);

    const compiled = authoredModifiers.map(compileStageModifier);
    expect(compiled.filter((modifier) => !modifier.recognized)).toEqual([]);
    for (const modifier of compiled) {
      expect(modifier.recognized, modifier.source).toBe(true);
      expect(modifier.effects.length, modifier.source).toBeGreaterThan(0);
      for (const effect of modifier.effects) {
        expect(STAGE_MODIFIER_CATEGORIES).toContain(effect.category);
        expect(effect.flag.length).toBeGreaterThan(0);
      }
    }
  });

  it("compiles every stage as a closed, supported modifier set", () => {
    for (const stage of STAGES) {
      const compilation = compileStageDefinitionModifiers(stage);
      expect(compilation.stageId).toBe(stage.id);
      expect(compilation.recognized, stage.id).toBe(true);
      expect(compilation.unsupported, stage.id).toEqual([]);
      expect(compilation.effects.length, stage.id).toBe(stage.modifiers.length);
      expect(() => assertStageModifiersRecognized(stage.modifiers, stage.id)).not.toThrow();
    }
  });

  it("covers every gameplay category instead of returning an untyped name list", () => {
    const compilation = compileStageModifiers(authoredModifiers);
    expect(compilation.recognized).toBe(true);
    for (const category of STAGE_MODIFIER_CATEGORIES) {
      expect(compilation.byCategory[category].length, category).toBeGreaterThan(0);
      expect(compilation.byCategory[category].every((effect) => effect.category === category)).toBe(true);
    }
  });

  it("keeps every authored non-parameterized modifier in the supported exact registry", () => {
    const authoredExact = authoredModifiers.filter((source) => {
      const modifier = compileStageModifier(source);
      return modifier.recognized && !modifier.parameterized;
    });
    expect(Object.keys(EXACT_STAGE_MODIFIER_REGISTRY).sort()).toEqual(expect.arrayContaining(authoredExact.sort()));
  });
});

describe("stage modifier typed parameters", () => {
  it("parses preview bounce counts", () => {
    const compilation = compileStageModifiers(["preview-bounces:2"]);
    expect(findStageModifierEffect(compilation, "trajectory", "previewBounceLimit")).toMatchObject({
      parameter: { kind: "count", value: 2 },
    });
  });

  it("parses boss phase percentages independently", () => {
    const compilation = compileStageModifiers(["boss-phase-at:65", "boss-phase-at:30"]);
    expect(compilation.byCategory.boss).toEqual([
      expect.objectContaining({
        flag: "phaseHpThresholdPercent",
        parameter: { kind: "percent", value: 65 },
      }),
      expect.objectContaining({
        flag: "phaseHpThresholdPercent",
        parameter: { kind: "percent", value: 30 },
      }),
    ]);
  });

  it("parses shield damage reduction and fixed numeric mechanics", () => {
    const compilation = compileStageModifiers([
      "shield-front-reduction:80",
      "reinforcement-at-turn-six",
      "boss-hp-stops-at-one",
      "spirit-walls-phase-every-other-turn",
    ]);
    expect(findStageModifierEffect(
      compilation,
      "formation",
      "shieldFrontDamageReductionPercent",
    )).toMatchObject({ parameter: { kind: "percent", value: 80 } });
    expect(findStageModifierEffect(compilation, "enemy", "reinforcementTurn")).toMatchObject({
      parameter: { kind: "turn", value: 6 },
    });
    expect(findStageModifierEffect(compilation, "boss", "minimumHp")).toMatchObject({
      parameter: { kind: "hitPoints", value: 1 },
    });
    expect(findStageModifierEffect(compilation, "wall", "spiritWallsPhaseCadence")).toMatchObject({
      parameter: { kind: "cadenceTurns", value: 2 },
    });
  });

  it("parses per-extra-hero protect guard HP", () => {
    const compilation = compileStageModifiers(["protect-target-hp-per-extra-hero:200"]);
    expect(findStageModifierEffect(
      compilation,
      "objective",
      "protectedTargetHpPerExtraHero",
    )).toMatchObject({ parameter: { kind: "hitPoints", value: 200 } });
  });

  it("compiles tutorial identifiers into presentation behavior", () => {
    const compilation = compileStageModifiers(["tutorial:direct-hit"]);
    expect(findStageModifierEffect(compilation, "presentation", "tutorialMode")).toMatchObject({
      parameter: { kind: "identifier", value: "direct-hit" },
    });
  });
});

describe("unsupported stage modifier rejection", () => {
  it.each([
    "totally-unknown-rule",
    "preview-bounces:many",
    "preview-bounces:9",
    "boss-phase-at:0",
    "boss-phase-at:100",
    "shield-front-reduction:101",
    "tutorial:unknown",
    " wind-vector-visible",
    "",
  ])("rejects %s", (source) => {
    expect(compileStageModifier(source)).toMatchObject({ recognized: false, source });
    expect(() => assertStageModifiersRecognized([source], "test-stage")).toThrow(
      /test-stage contains unsupported modifiers/,
    );
  });
});
