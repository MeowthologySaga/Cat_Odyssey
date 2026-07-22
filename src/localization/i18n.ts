import type Phaser from "phaser";
import type { GameLanguage } from "../state/saveSchema";
import type { EnglishCatalog, TranslationRule } from "./catalogTypes";
import { BATTLE_ENGLISH_CATALOG, BATTLE_ENGLISH_RULES } from "./catalogs/battle.en";
import { CONTENT_ENGLISH_CATALOG, CONTENT_ENGLISH_RULES } from "./catalogs/content.en";
import { CORE_ENGLISH_CATALOG, CORE_ENGLISH_RULES } from "./catalogs/core.en";
import { RELEASE_ENGLISH_CATALOG, RELEASE_ENGLISH_RULES } from "./catalogs/release.en";
import { SCENE_ENGLISH_CATALOG, SCENE_ENGLISH_RULES } from "./catalogs/scenes.en";
import { CAT_ODYSSEY_GLOSSARY } from "./glossary";

const HANGUL_PATTERN = /[가-힣ㄱ-ㅎㅏ-ㅣ]/u;
const PATCH_FLAG = Symbol.for("cat-odyssey.i18n.phaser-text");

const ENGLISH_CATALOG: EnglishCatalog = Object.freeze({
  ...CORE_ENGLISH_CATALOG,
  ...CONTENT_ENGLISH_CATALOG,
  ...SCENE_ENGLISH_CATALOG,
  ...BATTLE_ENGLISH_CATALOG,
  ...RELEASE_ENGLISH_CATALOG,
});

const ENGLISH_RULES: readonly TranslationRule[] = Object.freeze([
  ...CORE_ENGLISH_RULES,
  ...CONTENT_ENGLISH_RULES,
  ...SCENE_ENGLISH_RULES,
  ...BATTLE_ENGLISH_RULES,
  ...RELEASE_ENGLISH_RULES,
]);

const glossaryEntries = Object.entries(CAT_ODYSSEY_GLOSSARY)
  .sort(([left], [right]) => right.length - left.length);
const catalogEntries = Object.entries(ENGLISH_CATALOG)
  .filter(([korean]) => korean.length >= 2)
  .sort(([left], [right]) => right.length - left.length);

let activeLanguage: GameLanguage = "ko";
const missingEnglish = new Set<string>();

export function getLanguage(): GameLanguage {
  return activeLanguage;
}

export function setLanguage(language: GameLanguage): void {
  activeLanguage = language;
  updateDocumentLanguage(language);
}

export function normalizeLanguage(value: unknown): GameLanguage | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace("_", "-");
  if (normalized === "ko" || normalized.startsWith("ko-")) return "ko";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return undefined;
}

export async function detectPreferredLanguage(host?: LemGameHostApi): Promise<GameLanguage> {
  const hostLanguage = await readHostLanguage(host);
  if (hostLanguage) return hostLanguage;

  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["lang", "locale", "language"]) {
      const candidate = normalizeLanguage(params.get(key));
      if (candidate) return candidate;
    }
  }

  if (typeof navigator !== "undefined") {
    for (const candidate of navigator.languages ?? [navigator.language]) {
      const language = normalizeLanguage(candidate);
      if (language) return language;
    }
  }
  return "ko";
}

export function translateText<T extends string | string[]>(value: T): T {
  if (activeLanguage === "ko") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => translateEnglishString(String(entry))) as T;
  }
  return translateEnglishString(String(value)) as T;
}

export function translateForLanguage(value: string, language: GameLanguage): string {
  return language === "ko" ? value : translateEnglishString(value);
}

export function hasHangul(value: string): boolean {
  return HANGUL_PATTERN.test(value);
}

export function getMissingEnglishTranslations(): readonly string[] {
  return [...missingEnglish].sort();
}

export function clearMissingEnglishTranslations(): void {
  missingEnglish.clear();
}

/**
 * Phaser scenes contain a large amount of authored copy and frequently update
 * Text objects in place. Patching the single Text#setText boundary guarantees
 * static labels and live HUD messages use exactly the same catalog.
 */
export function installPhaserTextLocalization(phaser: typeof Phaser): void {
  const prototype = phaser.GameObjects.Text.prototype as typeof phaser.GameObjects.Text.prototype & {
    [PATCH_FLAG]?: boolean;
  };
  if (prototype[PATCH_FLAG]) return;
  const originalSetText = prototype.setText;
  prototype.setText = function localizedSetText(
    this: Phaser.GameObjects.Text,
    value: string | string[],
  ): Phaser.GameObjects.Text {
    return originalSetText.call(this, translateText(value));
  };
  prototype[PATCH_FLAG] = true;
}

function translateEnglishString(source: string): string {
  if (!source || !HANGUL_PATTERN.test(source)) return source;

  const exact = ENGLISH_CATALOG[source];
  if (exact !== undefined) return exact;

  // Multiline HUD copy is commonly assembled from independently cataloged rows.
  if (source.includes("\n")) {
    const translatedLines = source.split("\n").map((line) => translateEnglishString(line));
    const translated = translatedLines.join("\n");
    if (!HANGUL_PATTERN.test(translated)) return translated;
  }

  for (const rule of ENGLISH_RULES) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(source)) continue;
    rule.pattern.lastIndex = 0;
    const translated = translateKnownFragments(
      source.replace(rule.pattern, rule.replacement as never),
    );
    if (!HANGUL_PATTERN.test(translated)) return translated;
  }

  // Proper nouns are applied last so catalog sentences retain natural grammar
  // while diagnostics still identify the untranslated Korean phrase.
  const withGlossary = translateKnownFragments(source);
  missingEnglish.add(source);
  return `[English translation pending] ${withGlossary}`;
}

function translateKnownFragments(source: string): string {
  let translated = source;
  for (const [korean, english] of catalogEntries) {
    if (translated.includes(korean)) translated = translated.replaceAll(korean, english);
  }
  for (const [korean, english] of glossaryEntries) {
    if (translated.includes(korean)) translated = translated.replaceAll(korean, english);
  }
  return translated;
}

async function readHostLanguage(host?: LemGameHostApi): Promise<GameLanguage | undefined> {
  if (!host) return undefined;
  return normalizeLanguage(host.locale);
}

function updateDocumentLanguage(language: GameLanguage): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.title = language === "ko" ? "고양이 오디세이" : "Cat Odyssey";
  const shell = document.querySelector<HTMLElement>("#game-shell");
  shell?.setAttribute("aria-label", language === "ko" ? "고양이 오디세이 게임" : "Cat Odyssey game");
}
