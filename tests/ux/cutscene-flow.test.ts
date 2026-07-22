import { describe, expect, it } from "vitest";

import { CUTSCENE_MANIFEST, STORY_INTERLUDE_MANIFEST } from "../../src/data/cutscenes";
import { INTEGRATED_CUTSCENE_EPISODES } from "../../src/data/generatedCutsceneMedia";
import { ROUTES } from "../../src/data";
import {
  cutsceneSeenMarker,
  hasSeenCutscene,
  latestSeenCutscene,
  markCutsceneSeen,
  markCutscenesSeen,
  probeCutsceneAsset,
  resolveCutsceneNext,
  resolveTriggeredCutscene,
} from "../../src/core/cutsceneFlow";
import { createDefaultSave, normalizeSave } from "../../src/state";

describe("full-episode cutscene manifest", () => {
  it("preserves EP1–11 and exposes production-gated canonical slots through EP20", () => {
    expect(CUTSCENE_MANIFEST).toHaveLength(20);
    expect(new Set(CUTSCENE_MANIFEST.map((cutscene) => cutscene.id)).size).toBe(20);
    for (const cutscene of CUTSCENE_MANIFEST) {
      expect(cutscene).toHaveProperty("durationSeconds");
      expect(cutscene.nextScene.length).toBeGreaterThan(0);
    }
    expect(CUTSCENE_MANIFEST.slice(0, 11).map((cutscene) => [cutscene.enabled, cutscene.status, cutscene.source])).toEqual(
      Array.from({ length: 11 }, (_, index) => [
        true,
        "ready",
        `assets/video/cutscenes/ep${index + 1}.mp4`,
      ]),
    );
    for (const cutscene of CUTSCENE_MANIFEST.slice(11)) {
      const integrated = INTEGRATED_CUTSCENE_EPISODES.includes(cutscene.episode);
      expect([cutscene.enabled, cutscene.status, cutscene.source], cutscene.id).toEqual(integrated
        ? [true, "ready", `assets/video/cutscenes/ep${cutscene.episode}.mp4`]
        : [false, "missing", null]);
    }
    expect(CUTSCENE_MANIFEST.slice(0, 11).map((cutscene) => cutscene.trigger)).toEqual([
      { kind: "stage", stageId: "r01-s01", timing: "before" },
      { kind: "stage", stageId: "r01-s04", timing: "before" },
      { kind: "route", routeId: "route-01-ogygia", timing: "postlude" },
      { kind: "stage", stageId: "r02-s04", timing: "after" },
      { kind: "stage", stageId: "r03-s01", timing: "before" },
      { kind: "stage", stageId: "r03-s05", timing: "after" },
      { kind: "route", routeId: "route-03-cyclops", timing: "postlude" },
      { kind: "stage", stageId: "r04-s04", timing: "after" },
      { kind: "stage", stageId: "r05-s04", timing: "after" },
      { kind: "route", routeId: "route-05-circe", timing: "postlude" },
      { kind: "stage", stageId: "r06-s04", timing: "after" },
    ]);
    expect(CUTSCENE_MANIFEST.slice(11).map((cutscene) => cutscene.trigger)).toEqual([
      { kind: "stage", stageId: "r07-s04", timing: "after" },
      { kind: "stage", stageId: "r08-s05", timing: "after" },
      { kind: "stage", stageId: "r09-s04", timing: "after" },
      { kind: "stage", stageId: "r10-s01", timing: "before" },
      { kind: "stage", stageId: "r10-s01", timing: "after" },
      { kind: "stage", stageId: "r10-s02", timing: "before" },
      { kind: "stage", stageId: "r10-s02", timing: "after" },
      { kind: "stage", stageId: "r10-s03", timing: "after" },
      { kind: "stage", stageId: "r10-s05", timing: "after" },
    ]);
  });

  it("uses only canonical route ids for episode ownership and authored destinations", () => {
    const routeIds = new Set(ROUTES.map((route) => route.id));
    for (const cutscene of CUTSCENE_MANIFEST) {
      expect(routeIds.has(cutscene.routeId), cutscene.id).toBe(true);
      const nextRouteId = cutscene.nextData?.routeId;
      if (typeof nextRouteId === "string") expect(routeIds.has(nextRouteId), cutscene.id).toBe(true);
    }
  });

  it("keeps post-EP11 canon bridges separate from required video playback", () => {
    expect(STORY_INTERLUDE_MANIFEST).toHaveLength(7);
    const routeIds = new Set(ROUTES.map((route) => route.id));
    for (const interlude of STORY_INTERLUDE_MANIFEST) {
      expect(routeIds.has(interlude.routeId), interlude.id).toBe(true);
      expect(interlude.body.length, interlude.id).toBeGreaterThanOrEqual(2);
      expect(interlude).not.toHaveProperty("source");
      expect(interlude).not.toHaveProperty("enabled");
    }
  });

  it("does not claim an unavailable browser video asset in the node runtime", async () => {
    await expect(probeCutsceneAsset(CUTSCENE_MANIFEST[0]!)).resolves.toBe(false);
  });
});

describe("cutscene trigger and seen flow", () => {
  it("plays the pre-r01-s01 episode once, persists its marker, and still permits replay", () => {
    const save = createDefaultSave();
    const trigger = { kind: "stage" as const, stageId: "r01-s01", timing: "before" as const };
    const first = resolveTriggeredCutscene(save, trigger);
    expect(first?.id).toBe("cat-odyssey-ep01");

    markCutsceneSeen(save, first!.id);
    const restored = normalizeSave(JSON.parse(JSON.stringify(save)));
    expect(restored.inventory.skinIds).toContain(cutsceneSeenMarker(first!.id));
    expect(hasSeenCutscene(restored, first!.id)).toBe(true);
    expect(resolveTriggeredCutscene(restored, trigger)).toBeUndefined();
    expect(resolveTriggeredCutscene(restored, trigger, { replay: true })?.id).toBe(first!.id);
    expect(latestSeenCutscene(restored)?.id).toBe(first!.id);
  });

  it("records unavailable optional episodes once while retaining explicit replay access", () => {
    const save = createDefaultSave();
    const ids = CUTSCENE_MANIFEST.slice(0, 2).map((cutscene) => cutscene.id);
    markCutscenesSeen(save, [...ids, ids[0]!]);
    expect(ids.every((id) => hasSeenCutscene(save, id))).toBe(true);
    expect(save.inventory.skinIds.filter((id) => id === cutsceneSeenMarker(ids[0]!))).toHaveLength(1);
    expect(resolveTriggeredCutscene(
      save,
      { kind: "stage", stageId: "r01-s01", timing: "before" },
      { replay: true },
    )?.id).toBe(ids[0]);
  });

  it("requires exact timing and resolves the newly supplied later episodes", () => {
    const save = createDefaultSave();
    expect(resolveTriggeredCutscene(save, { kind: "stage", stageId: "r01-s04", timing: "before" })?.id)
      .toBe("cat-odyssey-ep02");
    expect(resolveTriggeredCutscene(save, { kind: "stage", stageId: "r01-s04", timing: "after" })).toBeUndefined();
    expect(resolveTriggeredCutscene(save, { kind: "stage", stageId: "r06-s04", timing: "before" })).toBeUndefined();
    expect(resolveTriggeredCutscene(save, { kind: "stage", stageId: "r06-s04", timing: "after" })?.id)
      .toBe("cat-odyssey-ep11");
  });

  it("uses authored next data unless the calling story flow supplies an override", () => {
    const episode = CUTSCENE_MANIFEST[0]!;
    expect(resolveCutsceneNext(episode)).toEqual({
      sceneKey: "Party",
      data: { stageId: "r01-s01", cutsceneChecked: true },
    });
    expect(resolveCutsceneNext(episode, {
      nextScene: "Harbor",
      nextData: { replayClosed: true },
    })).toEqual({ sceneKey: "Harbor", data: { replayClosed: true } });
  });

  it("returns from the raft-launch episode to the Poseidon stage instead of skipping the battle", () => {
    const raftLaunch = CUTSCENE_MANIFEST.find((cutscene) => cutscene.episode === 2)!;
    expect(resolveCutsceneNext(raftLaunch)).toEqual({
      sceneKey: "Party",
      data: { stageId: "r01-s04", cutsceneChecked: true },
    });
  });
});
