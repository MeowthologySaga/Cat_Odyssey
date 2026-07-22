import manifest from "../../cartridge/manifest.json";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectPreferredLanguage,
  getLanguage,
  setLanguage,
} from "../../src/localization";
import {
  DIAMOND_ACTIONS,
  createMockGameHost,
  createSpendInput,
} from "../../src/platform";
import { GameSaveStore } from "../../src/state";

function stubBrowser(
  search: string,
  languages: readonly string[],
  language = languages[0] ?? "",
): void {
  vi.stubGlobal("window", { location: { search } });
  vi.stubGlobal("navigator", { languages, language });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setLanguage("ko");
});

describe("locale resolution", () => {
  it("prefers an optional PlayZone locale hint over URL and OS hints", async () => {
    stubBrowser("?lang=ko", ["ko-KR"]);
    const host = createMockGameHost();
    host.locale = "en-US";

    await expect(detectPreferredLanguage(host)).resolves.toBe("en");
  });

  it("uses a supported URL hint, then the first supported OS language", async () => {
    stubBrowser("?locale=en_GB", ["ko-KR"]);
    await expect(detectPreferredLanguage()).resolves.toBe("en");

    stubBrowser("?lang=fr", ["fr-FR", "en-US", "ko-KR"]);
    await expect(detectPreferredLanguage()).resolves.toBe("en");

    stubBrowser("", ["fr-FR"], "fr-FR");
    await expect(detectPreferredLanguage()).resolves.toBe("ko");
  });
});

describe("locale persistence", () => {
  it("injects the detected default into a new or language-less save", async () => {
    const emptyHost = createMockGameHost();
    const emptyStore = new GameSaveStore(emptyHost, "en");
    await emptyStore.load();
    expect(emptyStore.getSnapshot().settings.language).toBe("en");

    const legacyHost = createMockGameHost();
    await legacyHost.save.write({
      schemaVersion: 1,
      settings: { masterVolume: 0.5 },
    });
    const legacyStore = new GameSaveStore(legacyHost, "en");
    await legacyStore.load();
    expect(legacyStore.getSnapshot().settings.language).toBe("en");
  });

  it("keeps a stored choice ahead of a new environment default", async () => {
    const host = createMockGameHost();
    await host.save.write({
      schemaVersion: 1,
      settings: { language: "ko" },
    });

    const firstLaunch = new GameSaveStore(host, "en");
    await firstLaunch.load();
    expect(firstLaunch.getSnapshot().settings.language).toBe("ko");

    await firstLaunch.update((draft) => {
      draft.settings.language = "en";
    });
    const nextLaunch = new GameSaveStore(host, "ko");
    await nextLaunch.load();
    expect(nextLaunch.getSnapshot().settings.language).toBe("en");
  });
});

describe("active document locale", () => {
  it("updates the document language, title, and game accessibility label", () => {
    const shell = { setAttribute: vi.fn() };
    const documentStub = {
      documentElement: { lang: "ko" },
      title: "고양이 오디세이",
      querySelector: vi.fn((selector: string) => selector === "#game-shell" ? shell : null),
    };
    vi.stubGlobal("document", documentStub);

    setLanguage("en");
    expect(getLanguage()).toBe("en");
    expect(documentStub.documentElement.lang).toBe("en");
    expect(documentStub.title).toBe("Cat Odyssey");
    expect(shell.setAttribute).toHaveBeenLastCalledWith("aria-label", "Cat Odyssey game");

    setLanguage("ko");
    expect(documentStub.documentElement.lang).toBe("ko");
    expect(documentStub.title).toBe("고양이 오디세이");
    expect(shell.setAttribute).toHaveBeenLastCalledWith("aria-label", "고양이 오디세이 게임");
  });
});

describe("locale-independent diamond contract", () => {
  it("does not translate protocol fields used for manifest parity and idempotent replay", () => {
    setLanguage("ko");
    const koreanModeInput = createSpendInput("battle-rescue", "run-1:rescue");
    setLanguage("en");
    const englishModeInput = createSpendInput("battle-rescue", "run-1:rescue");

    expect(englishModeInput).toEqual(koreanModeInput);
    expect(manifest.economy.diamondActions.map(({ id, amount, reason, requiresConfirm, repeatable }) => ({
      id, amount, reason, requiresConfirm, repeatable,
    }))).toEqual(DIAMOND_ACTIONS);
  });
});
