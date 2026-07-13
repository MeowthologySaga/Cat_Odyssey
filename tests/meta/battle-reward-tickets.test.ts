import { describe, expect, it } from "vitest";

import {
  abandonPendingBattleRun,
  beginBattleRewardTicket,
  commitBattleRewardTicket,
  readPendingBattleRewardTicket,
  readPendingBattleRewardTickets,
  wasBattleRewardCommitted,
} from "../../src/core/meta";
import { createDefaultSave, normalizeSave } from "../../src/state";

describe("battle reward settlement tickets", () => {
  it("commits one battle exactly once and survives a save round trip", () => {
    const begun = beginBattleRewardTicket(createDefaultSave(), "r01-s01", "campaign");
    expect(begun.ok).toBe(true);
    if (!begun.ok) throw new Error(begun.message);

    const roundTrip = normalizeSave(JSON.parse(JSON.stringify(begun.save)) as unknown);
    const pending = readPendingBattleRewardTicket(roundTrip, "r01-s01", "campaign");
    expect(pending).toEqual(begun.ticket);

    const committed = commitBattleRewardTicket(roundTrip, begun.ticket);
    expect(committed.ok).toBe(true);
    if (!committed.ok) throw new Error(committed.message);
    expect(readPendingBattleRewardTicket(committed.save, "r01-s01", "campaign")).toBeUndefined();
    expect(wasBattleRewardCommitted(committed.save, "r01-s01", "campaign")).toBe(true);
    expect(commitBattleRewardTicket(committed.save, begun.ticket)).toMatchObject({
      ok: false,
      code: "ticket_missing",
    });
  });

  it("preserves a different pending run until explicit abandonment", () => {
    const first = beginBattleRewardTicket(createDefaultSave(), "r01-s01", "campaign");
    if (!first.ok) throw new Error(first.message);
    const blocked = beginBattleRewardTicket(first.save, "r01-s02", "campaign");
    expect(blocked).toMatchObject({ ok: false, code: "battle_run_conflict" });
    expect(readPendingBattleRewardTicket(blocked.save, "r01-s01", "campaign")).toEqual(first.ticket);
    expect(readPendingBattleRewardTicket(blocked.save, "r01-s02", "campaign")).toBeUndefined();

    const abandoned = abandonPendingBattleRun(blocked.save);
    expect(readPendingBattleRewardTickets(abandoned)).toEqual([]);
    const second = beginBattleRewardTicket(abandoned, "r01-s02", "campaign");
    if (!second.ok) throw new Error(second.message);
    expect(readPendingBattleRewardTicket(second.save, "r01-s01", "campaign")).toBeUndefined();
    expect(readPendingBattleRewardTicket(second.save, "r01-s02", "campaign")).toEqual(second.ticket);
    expect(second.ticket.token).toBeGreaterThan(first.ticket.token);
  });

  it("reuses the exact same pending ticket without creating a new token", () => {
    const first = beginBattleRewardTicket(createDefaultSave(), "r01-s01", "campaign");
    if (!first.ok) throw new Error(first.message);
    const repeated = beginBattleRewardTicket(first.save, "r01-s01", "campaign");
    expect(repeated).toMatchObject({ ok: true, ticket: first.ticket });
    if (!repeated.ok) throw new Error(repeated.message);
    expect(readPendingBattleRewardTickets(repeated.save)).toEqual([first.ticket]);
  });
});
