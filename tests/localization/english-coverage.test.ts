// @ts-nocheck -- This release gate intentionally inspects source files through the TypeScript AST.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  clearMissingEnglishTranslations,
  getMissingEnglishTranslations,
  translateForLanguage,
} from "../../src/localization";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HANGUL_PATTERN = /[\u3131-\u318e\uac00-\ud7a3]/u;
const PENDING_PATTERN = /\[?english translation pending\]?|translation[- ]pending/iu;
const SOURCE_EXTENSIONS = new Set([".ts", ".json"]);

interface Candidate {
  readonly text: string;
  readonly location: string;
  readonly kind: "literal" | "template" | "json" | "html" | "manifest";
}

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function projectPath(filePath: string): string {
  return path.relative(PROJECT_ROOT, filePath).replaceAll("\\", "/");
}

function addCandidate(
  candidates: Map<string, Candidate>,
  text: string,
  location: string,
  kind: Candidate["kind"],
): void {
  if (!HANGUL_PATTERN.test(text) || candidates.has(text)) return;
  candidates.set(text, { text, location, kind });
}

function isPropertyName(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)
      || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent))
    && parent.name === node
  );
}

function isModuleSpecifier(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  return (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
    && parent.moduleSpecifier === node
  );
}

function collectTypeScriptCandidates(
  filePath: string,
  candidates: Map<string, Candidate>,
): void {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const relative = projectPath(filePath);

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isPropertyName(node) && !isModuleSpecifier(node)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        addCandidate(candidates, node.text, `${relative}:${line}`, "literal");
      }
    } else if (ts.isTemplateExpression(node)) {
      const sample = node.templateSpans.reduce(
        (text, span) => `${text}1${span.literal.text}`,
        node.head.text,
      );
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      addCandidate(candidates, sample, `${relative}:${line}`, "template");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectJsonValues(
  value: unknown,
  filePath: string,
  candidates: Map<string, Candidate>,
  kind: "json" | "manifest" = "json",
): void {
  if (typeof value === "string") {
    addCandidate(candidates, value, `${projectPath(filePath)}:1`, kind);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonValues(entry, filePath, candidates, kind));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach((entry) => collectJsonValues(entry, filePath, candidates, kind));
}

function collectHtmlCandidates(filePath: string, candidates: Map<string, Candidate>): void {
  const source = readFileSync(filePath, "utf8");
  const expressions = [
    /<title>([^<]+)<\/title>/giu,
    /\baria-label\s*=\s*["']([^"']+)["']/giu,
  ];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) {
      if (match[1]) addCandidate(candidates, match[1], `${projectPath(filePath)}:1`, "html");
    }
  }
}

function runtimeCandidates(): readonly Candidate[] {
  const candidates = new Map<string, Candidate>();
  const sourceRoot = path.join(PROJECT_ROOT, "src");
  for (const filePath of walkFiles(sourceRoot)) {
    const relative = projectPath(filePath);
    if (relative.startsWith("src/localization/")) continue;
    const extension = path.extname(filePath).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(extension)) continue;
    if (extension === ".json") {
      collectJsonValues(JSON.parse(readFileSync(filePath, "utf8")), filePath, candidates);
    } else {
      collectTypeScriptCandidates(filePath, candidates);
    }
  }

  const manifestPath = path.join(PROJECT_ROOT, "cartridge", "manifest.json");
  collectJsonValues(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    manifestPath,
    candidates,
    "manifest",
  );
  collectHtmlCandidates(path.join(PROJECT_ROOT, "index.html"), candidates);
  collectHtmlCandidates(path.join(PROJECT_ROOT, "standalone-src", "index.html"), candidates);
  return [...candidates.values()].sort((left, right) => left.location.localeCompare(right.location));
}

function declaredLanguages(manifest: Record<string, unknown>): Set<string> {
  const metadata = manifest.metadata && typeof manifest.metadata === "object"
    ? manifest.metadata as Record<string, unknown>
    : {};
  const values = [
    manifest.languages,
    manifest.supportedLanguages,
    metadata.language,
    metadata.languages,
    metadata.supportedLanguages,
  ];
  const output = new Set<string>();
  const add = (value: unknown): void => {
    if (Array.isArray(value)) return void value.forEach(add);
    if (typeof value !== "string") return;
    const code = value.trim().toLowerCase().replace("_", "-").split("-")[0];
    if (code) output.add(code);
  };
  values.forEach(add);
  return output;
}

function compact(value: string): string {
  const normalized = value.replaceAll("\n", "\\n");
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

describe("English release coverage", () => {
  it("translates rows assembled from live save values", () => {
    const runtimeRows = [
      "영웅 도감 · 수집 1/16",
      "먀디세우스  ★★★★★",
      "귀향의 책략가  ·  바다  ·  반사형 · 벽 연계",
      "가까운 적 화살비 76",
      "1성 · 스테이지 클리어\n2성 · 8턴 이내 목표 파괴\n3성 · 7턴 이내 · 남은 HP 60% 이상",
      "첫 돌파 · 첫 돌파 · 항해 매듭 ×1",
      "먀디세우스  Lv.1",
      "예상선 연장 3 · 약점 피해 증가 65",
      "◆ 벌목 대상",
    ];
    for (const row of runtimeRows) {
      const translated = translateForLanguage(row, "en");
      expect(translated).not.toMatch(HANGUL_PATTERN);
      expect(translated).not.toMatch(PENDING_PATTERN);
    }
  });

  it("translates every runtime-reachable Korean literal without Hangul or placeholders", () => {
    clearMissingEnglishTranslations();
    const candidates = runtimeCandidates();
    const violations: string[] = [];

    for (const candidate of candidates) {
      const translated = translateForLanguage(candidate.text, "en");
      if (!HANGUL_PATTERN.test(translated) && !PENDING_PATTERN.test(translated)) continue;
      violations.push(
        `${candidate.location} [${candidate.kind}] ${JSON.stringify(compact(candidate.text))}`
        + ` -> ${JSON.stringify(compact(translated))}`,
      );
    }

    const missing = getMissingEnglishTranslations();
    if (violations.length || missing.length) {
      const preview = violations.slice(0, 120).join("\n");
      const missingPreview = missing.slice(0, 120)
        .map((text) => `catalog miss: ${JSON.stringify(compact(text))}`)
        .join("\n");
      throw new Error(
        `English localization gate found ${violations.length} exposed literal(s) and `
        + `${missing.length} catalog miss(es).\n${preview}`
        + (preview && missingPreview ? "\n" : "")
        + missingPreview
        + (violations.length > 120 ? `\n... ${violations.length - 120} more` : ""),
      );
    }
    expect(candidates.length).toBeGreaterThan(100);
  });

  it("declares ko/en in manifest and documents them in README and in-game credits", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(PROJECT_ROOT, "cartridge", "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const languages = declaredLanguages(manifest);
    expect([...languages]).toEqual(expect.arrayContaining(["ko", "en"]));

    const readme = readFileSync(path.join(PROJECT_ROOT, "cartridge", "README.md"), "utf8");
    expect(readme).toMatch(/(?:지원\s*언어|supported\s+languages?)/iu);
    expect(readme).toMatch(/(?:한국어|Korean)/u);
    expect(readme).toMatch(/English/u);

    const runtimeSource = walkFiles(path.join(PROJECT_ROOT, "src"))
      .filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
      .map((filePath) => readFileSync(filePath, "utf8"))
      .join("\n");
    expect(runtimeSource).toMatch(/(?:지원\s*언어|supported\s+languages?)/iu);
    expect(runtimeSource).toMatch(/(?:한국어|Korean)/u);
    expect(runtimeSource).toMatch(/English/u);
  });
});
