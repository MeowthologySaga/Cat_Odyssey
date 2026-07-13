// @ts-nocheck -- This source-integrity test uses Node filesystem APIs outside the browser bundle.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const partySource = readFileSync(new URL("../../src/scenes/PartyScene.ts", import.meta.url), "utf8");
const summonSource = readFileSync(new URL("../../src/scenes/SummonScene.ts", import.meta.url), "utf8");
const harborSource = readFileSync(new URL("../../src/scenes/HarborScene.ts", import.meta.url), "utf8");
const endgameSource = readFileSync(new URL("../../src/scenes/EndgameScene.ts", import.meta.url), "utf8");

describe("modal focus integration", () => {
  it("isolates nested party modals and restores their opening controls", () => {
    expect(partySource).toContain('setUiFocusScope(this, "party-growth")');
    expect(partySource).toContain('setUiFocusScope(this, "party-materials")');
    expect(partySource).toContain('setUiEscapeHandler(this, () => this.closeGrowthModal(heroId))');
    expect(partySource).toContain('setUiEscapeHandler(this, () => this.closeMaterialManager(heroId))');
    expect(partySource).toContain('ensureUiFocus(this, [`party-growth-hero-${heroId}`])');
    expect(partySource).toContain('ensureUiFocus(this, ["party-growth-material-manager"])');
  });

  it("isolates every summon overlay with a focused close action and Escape/B handler", () => {
    for (const scope of ["summon-result", "summon-disclosure", "summon-history"]) {
      expect(summonSource).toContain(`setUiFocusScope(this, "${scope}")`);
    }
    for (const focusKey of ["summon-result-close", "summon-disclosure-close", "summon-history-close"]) {
      expect(summonSource).toContain(`ensureUiFocus(this, ["${focusKey}"])`);
    }
    expect(summonSource).toContain("setUiEscapeHandler(this, closeModal)");
    expect(summonSource).toContain("this.restoreFocusKey = restoreFocusKey");
  });

  it("isolates harbor memories, vault warnings, and endgame decisions from background navigation", () => {
    expect(harborSource).toContain('setUiFocusScope(this, "harbor-memories", "harbor-memory-close")');
    expect(harborSource).toContain("setUiEscapeHandler(this, closeModal)");
    expect(partySource).toContain('setUiFocusScope(this, "party-vault-warning", "party-vault-confirm")');
    expect(partySource).toContain("setUiEscapeHandler(this, closeWarning)");
    expect(endgameSource).toContain('setUiFocusScope(this, "endgame-preview", "endgame-preview-party")');
    expect(endgameSource).toContain('setUiFocusScope(this, "endgame-storm-choice", "endgame-storm-option-0")');
    expect(endgameSource.match(/setUiEscapeHandler\(this, \(\) => this\.scene\.restart\(\)\)/g)).toHaveLength(2);
  });
});
