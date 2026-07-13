import { describe, expect, it } from "vitest";
import { createBattleRuntime, type BattleEvent } from "../../src/core/battle";
import { createBattlePartyDefinitions, initializeStarterRoster, writeHeroLevel } from "../../src/core/meta";
import { ENEMY_BEHAVIOR_BY_ID, ENEMY_BY_ID, STAGE_BY_ID } from "../../src/data";
import { vec2 } from "../../src/simulation";
import { createDefaultSave } from "../../src/state";
import { MANUAL_CLEAR_AUDIT_CANDIDATES } from "./manual-clear-audit-candidates";

describe("mechanic-aware full-clear audit backlog", () => {
  it("keeps every heuristic candidate unique, authored, and accurately labelled", () => {
    const keys = MANUAL_CLEAR_AUDIT_CANDIDATES.map((entry) => `${entry.stageId}:${entry.partySize}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(9);
    for (const entry of MANUAL_CLEAR_AUDIT_CANDIDATES) {
      const stage = STAGE_BY_ID[entry.stageId];
      expect(stage, entry.stageId).toBeDefined();
      expect(stage?.objective.type, entry.stageId).toBe(entry.objectiveType);
      expect(entry.requiredScriptFocus.length, entry.stageId).toBeGreaterThan(0);
    }
  });

  for (const entry of MANUAL_CLEAR_AUDIT_CANDIDATES) {
    const label = `[full clear] ${entry.stageId} with ${entry.partySize} hero(es): ${entry.requiredScriptFocus.join(" -> ")}`;
    const proof = entry.proof;
    if (!proof) {
      it.todo(label);
      continue;
    }

    it(label, () => {
      const save = initializeStarterRoster(createDefaultSave());
      for (const heroId of proof.heroIds) {
        if (!save.roster.ownedHeroIds.includes(heroId)) save.roster.ownedHeroIds.push(heroId);
        save.roster.heroAwakening[heroId] = 5;
        writeHeroLevel(save, heroId, 60);
      }
      const runtime = createBattleRuntime({
        stage: STAGE_BY_ID[entry.stageId]!,
        party: createBattlePartyDefinitions(save, proof.heroIds),
        enemyCatalog: ENEMY_BY_ID,
        enemyBehaviorCatalog: ENEMY_BEHAVIOR_BY_ID,
        seed: `full-clear:${entry.stageId}:${entry.partySize}`,
      });
      const battleEvents: BattleEvent[] = [];

      for (const [index, angle] of proof.aimAnglesRadians.entries()) {
        if (!runtime.getActionAvailability().allowed) runtime.skipBlockedTurn();
        else {
          expect(runtime.launch({
            direction: vec2(Math.cos(angle), Math.sin(angle)),
            power: proof.aimPowers?.[index] ?? 1,
          })).not.toBeNull();
          runtime.advance(10);
        }
        battleEvents.push(...runtime.drainEvents());
        if (runtime.getSnapshot().outcome) break;
      }

      const snapshot = runtime.getSnapshot();
      expect(snapshot.outcome).toMatchObject({ victory: true, reason: proof.expectedReason });
      expect(snapshot.party).toHaveLength(entry.partySize);
      if (entry.stageId === "r03-s03") {
        expect(snapshot.modifiers.find((modifier) => modifier.flag === "exitUnlocksAfterBruteStaggers")?.value).toBeGreaterThanOrEqual(1);
        expect(snapshot.walls.find((wall) => wall.id === "break-a")?.broken).toBe(true);
      }
      if (entry.stageId === "r08-s04") {
        expect(Number(snapshot.hazards.find((hazard) => hazard.id === "maelstrom")?.parameters.anchorHits ?? 0)).toBeGreaterThanOrEqual(1);
      }
      if (entry.stageId === "r07-s04") {
        const siren = snapshot.enemies.find((enemy) => enemy.definitionId === "siren-triad")!;
        expect(siren.weakpoints.map((weakpoint) => weakpoint.maxHp)).toEqual([4825, 4825, 4825]);
        expect(siren.weakpoints.map((weakpoint) => weakpoint.partId)).toEqual([
          "siren-white", "siren-gray", "siren-blue",
        ]);
        expect(siren.weakpoints.map((weakpoint) => weakpoint.position.x)).toEqual([
          expect.any(Number), expect.any(Number), expect.any(Number),
        ]);
        expect(siren.weakpoints[0]!.position.x).toBeLessThan(siren.weakpoints[1]!.position.x);
        expect(siren.weakpoints[1]!.position.x).toBeLessThan(siren.weakpoints[2]!.position.x);
        expect(battleEvents.filter((event) => event.type === "weakpointBroken").map((event) => event.targetId)).toEqual([
          "boss:siren-white:1", "boss:siren-gray:1", "boss:siren-blue:1",
        ]);
        expect(snapshot.modifiers.find((modifier) => modifier.flag === "interruptSongInOrder")?.value).toBe(3);
      }
      if (entry.stageId === "r09-s03") {
        const expectedMaxHp = 100 + Math.max(0, entry.partySize - 1) * 200;
        expect(snapshot.objective.targets[0]).toMatchObject({ failed: false, maxHp: expectedMaxHp });
        expect(snapshot.objective.targets[0]!.hp).toBeGreaterThan(0);
        expect(snapshot.modifiers.find((modifier) => modifier.flag === "protectedTargetsMoveAfterShot")?.triggerCount).toBe(10);
      }
      if (entry.stageId === "r09-s04") {
        expect(snapshot.completedTurns).toBe(11);
        expect(snapshot.hazards.find((hazard) => hazard.id === "judgment-grid")?.parameters.strikeIndex).toBeDefined();
        expect(snapshot.party[0]?.hp).toBeGreaterThan(0);
      }
    });
  }
});
