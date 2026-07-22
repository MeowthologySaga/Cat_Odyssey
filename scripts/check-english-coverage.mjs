import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectPackEntries,
  formatValidationReport,
  validatePackArchive,
  validatePackEntries,
} from "./validate-pack.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const HANGUL_PATTERN = /[\u3131-\u318e\uac00-\ud7a3]/u;
const PENDING_PATTERN = /\[?english translation pending\]?|translation[- ]pending/iu;
const REQUIRED_SCENES = Object.freeze([
  "Title",
  "Tutorial",
  "Cutscene",
  "Story",
  "Settings",
  "Harbor",
  "Collection",
  "Route",
  "Party",
  "Battle",
  "Reward",
  "Summon",
  "Endgame",
]);
const REQUIRED_FLOWS = Object.freeze([
  "language-switch",
  "save-reload",
  "purchase-confirm",
  "purchase-cancel",
  "purchase-failure",
  "purchase-success",
]);
const TARGETS = Object.freeze(["lemgame", "standalone"]);
const SCALES = Object.freeze([100, 125, 150]);

function usage() {
  return [
    "Usage: node scripts/check-english-coverage.mjs [options]",
    "",
    "Options:",
    "  --archive <path>         Validate this .lemgame archive.",
    "  --runtime-report <path>  Validate the 940x680 runtime smoke JSON.",
    "  --skip-unit              Skip the Vitest translation-corpus gate.",
    "  --source-only            Check unit coverage and language declarations only.",
    "  --allow-legacy-lem       Permit .lem instead of .lemgame for non-release diagnostics.",
    "  --help                    Show this message.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    archive: undefined,
    runtimeReport: undefined,
    skipUnit: false,
    sourceOnly: false,
    allowLegacyLem: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--archive" || argument === "--runtime-report") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path.`);
      options[argument === "--archive" ? "archive" : "runtimeReport"] = path.resolve(value);
      index += 1;
    } else if (argument === "--skip-unit") options.skipUnit = true;
    else if (argument === "--source-only") options.sourceOnly = true;
    else if (argument === "--allow-legacy-lem") options.allowLegacyLem = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function createReporter() {
  const errors = [];
  const warnings = [];
  const passes = [];
  return {
    errors,
    warnings,
    passes,
    pass(message) { passes.push(message); },
    warn(message) { warnings.push(message); },
    fail(message) { errors.push(message); },
  };
}

async function walkFiles(targetPath) {
  const info = await stat(targetPath);
  if (info.isFile()) return [targetPath];
  const output = [];
  for (const entry of await readdir(targetPath, { withFileTypes: true })) {
    const child = path.join(targetPath, entry.name);
    if (entry.isDirectory()) output.push(...await walkFiles(child));
    else if (entry.isFile()) output.push(child);
  }
  return output;
}

async function newestMtime(paths) {
  let newest = 0;
  for (const targetPath of paths) {
    if (!existsSync(targetPath)) continue;
    for (const filePath of await walkFiles(targetPath)) {
      newest = Math.max(newest, (await stat(filePath)).mtimeMs);
    }
  }
  return newest;
}

function collectLanguageCodes(manifest) {
  const metadata = manifest?.metadata && typeof manifest.metadata === "object"
    ? manifest.metadata
    : {};
  const values = [
    manifest?.languages,
    manifest?.supportedLanguages,
    metadata.language,
    metadata.languages,
    metadata.supportedLanguages,
  ];
  const output = new Set();
  const add = (value) => {
    if (Array.isArray(value)) return void value.forEach(add);
    if (typeof value !== "string") return;
    const code = value.trim().toLowerCase().replace("_", "-").split("-")[0];
    if (code) output.add(code);
  };
  values.forEach(add);
  return output;
}

function checkLanguageDeclaration(manifest, label, reporter) {
  const codes = collectLanguageCodes(manifest);
  for (const required of ["ko", "en"]) {
    if (!codes.has(required)) reporter.fail(`${label}: missing supported language ${required}.`);
  }
  if (codes.has("ko") && codes.has("en")) reporter.pass(`${label}: declares ko/en.`);
}

async function checkSourceDeclarations(manifest, reporter) {
  checkLanguageDeclaration(manifest, "cartridge/manifest.json", reporter);
  const readme = await readFile(path.join(PROJECT_ROOT, "cartridge", "README.md"), "utf8");
  if (!/(?:지원\s*언어|supported\s+languages?)/iu.test(readme)
    || !/(?:한국어|Korean)/u.test(readme)
    || !/English/u.test(readme)) {
    reporter.fail("cartridge/README.md must explicitly state supported languages ko/en (Korean/English).");
  } else reporter.pass("cartridge/README.md documents Korean and English support.");

  const runtimeFiles = (await walkFiles(path.join(PROJECT_ROOT, "src")))
    .filter((filePath) => [".ts", ".json"].includes(path.extname(filePath).toLowerCase()));
  const runtimeSource = (await Promise.all(runtimeFiles.map((filePath) => readFile(filePath, "utf8"))))
    .join("\n");
  if (!/(?:지원\s*언어|supported\s+languages?)/iu.test(runtimeSource)
    || !/(?:한국어|Korean)/u.test(runtimeSource)
    || !/English/u.test(runtimeSource)) {
    reporter.fail("In-game credits must explicitly state supported languages: Korean (ko), English (en).");
  } else reporter.pass("In-game credits source declares Korean and English.");
}

function runUnitGate(reporter) {
  const vitest = path.join(PROJECT_ROOT, "node_modules", "vitest", "vitest.mjs");
  if (!existsSync(vitest)) {
    reporter.fail("Vitest is unavailable; run npm install before the English coverage gate.");
    return;
  }
  const result = spawnSync(process.execPath, [
    vitest,
    "run",
    "--exclude", ".upgrade/**",
    "--exclude", ".public-release/**",
    "tests/localization/english-coverage.test.ts",
    "--reporter=dot",
  ], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error) reporter.fail(`English unit gate could not run: ${result.error.message}`);
  else if (result.status !== 0) reporter.fail(`English unit gate failed with exit code ${result.status}.`);
  else reporter.pass("English translation-corpus unit gate passed.");
}

async function newestBundleFile(directory, extension) {
  if (!existsSync(directory)) return undefined;
  const candidates = (await walkFiles(directory))
    .filter((filePath) => path.extname(filePath).toLowerCase() === extension);
  let newest;
  for (const candidate of candidates) {
    const mtimeMs = (await stat(candidate)).mtimeMs;
    if (!newest || mtimeMs > newest.mtimeMs) newest = { path: candidate, mtimeMs };
  }
  return newest;
}

async function assertFresh(outputPath, inputMtime, label, reporter) {
  if (!existsSync(outputPath)) {
    reporter.fail(`${label}: missing ${path.relative(PROJECT_ROOT, outputPath)}.`);
    return;
  }
  const outputMtime = (await stat(outputPath)).mtimeMs;
  if (outputMtime + 1_000 < inputMtime) {
    reporter.fail(`${label}: output is older than its source inputs; rebuild it.`);
  } else reporter.pass(`${label}: output is fresh.`);
}

async function comparePublicTree(destinationRoot, label, reporter) {
  const publicRoot = path.join(PROJECT_ROOT, "public");
  const sourceFiles = await walkFiles(publicRoot);
  const failures = [];
  for (const sourcePath of sourceFiles) {
    const relative = path.relative(publicRoot, sourcePath);
    const destination = path.join(destinationRoot, relative);
    if (!existsSync(destination)) {
      failures.push(`${relative}: missing`);
      continue;
    }
    const [sourceInfo, destinationInfo] = await Promise.all([stat(sourcePath), stat(destination)]);
    if (sourceInfo.size !== destinationInfo.size) failures.push(`${relative}: byte-size mismatch`);
  }
  if (failures.length) {
    reporter.fail(`${label}: ${failures.length} public asset parity failure(s): ${failures.slice(0, 12).join(", ")}`);
  } else reporter.pass(`${label}: ${sourceFiles.length} public assets are present with matching byte sizes.`);
}

async function checkBuildOutputs(reporter) {
  const sourceMtime = await newestMtime([
    path.join(PROJECT_ROOT, "src"),
    path.join(PROJECT_ROOT, "index.html"),
    path.join(PROJECT_ROOT, "vite.config.ts"),
  ]);
  const standaloneInputMtime = await newestMtime([
    path.join(PROJECT_ROOT, "src"),
    path.join(PROJECT_ROOT, "standalone-src"),
    path.join(PROJECT_ROOT, "vite.standalone.config.mjs"),
  ]);
  const distRoot = path.join(PROJECT_ROOT, "dist", "game");
  const bundleRoot = path.join(distRoot, "assets", "bundle");
  const distJs = await newestBundleFile(bundleRoot, ".js");
  const distCss = await newestBundleFile(bundleRoot, ".css");
  if (!distJs) reporter.fail("Pack build: compiled JavaScript is missing under dist/game/assets/bundle.");
  else await assertFresh(distJs.path, sourceMtime, "Pack JavaScript", reporter);
  if (!distCss) reporter.fail("Pack build: compiled CSS is missing under dist/game/assets/bundle.");
  else await assertFresh(distCss.path, sourceMtime, "Pack CSS", reporter);
  await assertFresh(path.join(distRoot, "index.html"), sourceMtime, "Pack index", reporter);
  await comparePublicTree(distRoot, "Pack build", reporter);

  const standaloneRoot = path.join(PROJECT_ROOT, "standalone");
  await assertFresh(path.join(standaloneRoot, "game.js"), standaloneInputMtime, "Standalone JavaScript", reporter);
  await assertFresh(path.join(standaloneRoot, "game.css"), standaloneInputMtime, "Standalone CSS", reporter);
  await assertFresh(path.join(standaloneRoot, "index.html"), standaloneInputMtime, "Standalone index", reporter);
  if (existsSync(path.join(standaloneRoot, "index.html"))) {
    const standaloneHtml = await readFile(path.join(standaloneRoot, "index.html"), "utf8");
    if (!standaloneHtml.includes('href="./game.css"') || !standaloneHtml.includes('src="./game.js"')
      || /(?:src|href)="\//u.test(standaloneHtml)) {
      reporter.fail("Standalone index must use only relative classic-script and stylesheet paths.");
    } else reporter.pass("Standalone index uses offline-safe relative paths.");
  }
  await comparePublicTree(standaloneRoot, "Standalone build", reporter);
}

function releaseFileName(manifest, extension = ".lemgame") {
  const id = String(manifest?.id ?? "game-pack")
    .trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "game-pack";
  const version = String(manifest?.version ?? "0.0.0").trim().replace(/[^0-9a-zA-Z.-]+/g, "-");
  return `${id}-${version}${extension}`;
}

async function resolveArchive(options, manifest, reporter) {
  if (options.archive) return options.archive;
  const releaseRoot = path.join(PROJECT_ROOT, "releases");
  const lemgame = path.join(releaseRoot, releaseFileName(manifest));
  if (existsSync(lemgame)) return lemgame;
  const legacy = path.join(releaseRoot, releaseFileName(manifest, ".lem"));
  if (options.allowLegacyLem && existsSync(legacy)) {
    reporter.warn("Using legacy .lem archive; public release still requires a verified .lemgame artifact.");
    return legacy;
  }
  reporter.fail(`Missing release archive: ${path.relative(PROJECT_ROOT, lemgame)}.`);
  return undefined;
}

async function checkSidecar(archivePath, reporter) {
  const sidecar = `${archivePath}.sha256`;
  if (!existsSync(sidecar)) {
    reporter.fail(`${path.basename(archivePath)}: missing SHA-256 sidecar.`);
    return;
  }
  const expected = (await readFile(sidecar, "utf8")).trim().split(/\s+/u)[0]?.toLowerCase();
  const actual = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  if (expected !== actual) reporter.fail(`${path.basename(archivePath)}: SHA-256 sidecar does not match.`);
  else reporter.pass(`${path.basename(archivePath)}: SHA-256 sidecar matches.`);
}

async function checkPackage(options, manifest, reporter) {
  const collected = await collectPackEntries({ projectRoot: PROJECT_ROOT });
  const staging = await validatePackEntries(collected.entries, { projectRoot: PROJECT_ROOT });
  if (!staging.ok) reporter.fail(formatValidationReport(staging, "prospective .lemgame staging"));
  else reporter.pass(`Prospective pack is valid (${staging.fileCount} files, ${staging.totalBytes} bytes).`);

  const archivePath = await resolveArchive(options, manifest, reporter);
  if (!archivePath) return;
  const extension = path.extname(archivePath).toLowerCase();
  if (extension !== ".lemgame" && !(options.allowLegacyLem && extension === ".lem")) {
    reporter.fail(`${path.basename(archivePath)} must use the .lemgame release extension.`);
  }
  const archiveReport = await validatePackArchive(archivePath, { projectRoot: PROJECT_ROOT });
  if (!archiveReport.ok) reporter.fail(formatValidationReport(archiveReport, archivePath));
  else reporter.pass(`${path.basename(archivePath)} archive validation passed.`);
  if (archiveReport.manifest) {
    checkLanguageDeclaration(archiveReport.manifest, path.basename(archivePath), reporter);
    if (archiveReport.manifest.id !== manifest.id || archiveReport.manifest.version !== manifest.version) {
      reporter.fail(`${path.basename(archivePath)} manifest id/version does not match cartridge/manifest.json.`);
    }
  }
  const archiveInputsMtime = await newestMtime([
    path.join(PROJECT_ROOT, "dist", "game"),
    path.join(PROJECT_ROOT, "cartridge"),
  ]);
  await assertFresh(archivePath, archiveInputsMtime, "Release archive", reporter);
  await checkSidecar(archivePath, reporter);
}

function reportText(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    for (const key of ["text", "label", "name", "value"]) {
      if (typeof entry[key] === "string") return entry[key];
    }
  }
  return undefined;
}

function nonEmptyArray(value) {
  return Array.isArray(value) ? value : [];
}

async function checkRuntimeReport(reportPath, reporter) {
  if (!existsSync(reportPath)) {
    reporter.fail(`Missing runtime smoke report: ${path.relative(PROJECT_ROOT, reportPath)}.`);
    return;
  }
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    reporter.fail(`Runtime smoke report is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (report?.schemaVersion !== 1 || !Array.isArray(report.cases)) {
    reporter.fail("Runtime smoke report must have schemaVersion 1 and a cases array.");
    return;
  }
  const reportDirectory = path.dirname(reportPath);
  for (const target of TARGETS) {
    const targetCases = report.cases.filter((entry) => entry?.target === target);
    const coveredFlows = new Set(targetCases.flatMap((entry) => nonEmptyArray(entry.coveredFlows)));
    for (const flow of REQUIRED_FLOWS) {
      if (!coveredFlows.has(flow)) reporter.fail(`${target}: runtime report did not cover flow ${flow}.`);
    }
    for (const scalePercent of SCALES) {
      const entry = targetCases.find((candidate) => candidate?.scalePercent === scalePercent);
      const label = `${target} 940x680 @ ${scalePercent}%`;
      if (!entry) {
        reporter.fail(`${label}: missing runtime case.`);
        continue;
      }
      if (entry.language !== "en") reporter.fail(`${label}: language must be en.`);
      if (entry.physicalViewport?.width !== 940 || entry.physicalViewport?.height !== 680) {
        reporter.fail(`${label}: physicalViewport must be exactly 940x680.`);
      }
      const scenes = new Set(nonEmptyArray(entry.coveredScenes));
      for (const scene of REQUIRED_SCENES) {
        if (!scenes.has(scene)) reporter.fail(`${label}: missing scene ${scene}.`);
      }
      for (const field of ["overflow", "clippedButtons", "consoleErrors", "pageErrors"]) {
        const violations = nonEmptyArray(entry[field]);
        if (violations.length) reporter.fail(`${label}: ${field} has ${violations.length} violation(s).`);
      }
      if (entry.pageOverflow !== false) reporter.fail(`${label}: pageOverflow must be false.`);

      const textEntries = [
        ...nonEmptyArray(entry.renderedTexts),
        ...nonEmptyArray(entry.accessibilityLabels),
      ];
      if (!textEntries.length) reporter.fail(`${label}: no rendered text/accessibility labels were captured.`);
      for (const raw of textEntries) {
        const value = reportText(raw);
        if (!value) continue;
        if (HANGUL_PATTERN.test(value) || PENDING_PATTERN.test(value)) {
          reporter.fail(`${label}: exposed untranslated text ${JSON.stringify(value.slice(0, 180))}.`);
        }
      }

      if (typeof entry.screenshot !== "string" || !entry.screenshot.trim()) {
        reporter.fail(`${label}: screenshot evidence is missing.`);
      } else {
        const screenshot = path.resolve(reportDirectory, entry.screenshot);
        if (!existsSync(screenshot)) reporter.fail(`${label}: screenshot file does not exist (${entry.screenshot}).`);
      }
      reporter.pass(`${label}: runtime case inspected.`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const reporter = createReporter();
  const manifest = JSON.parse(
    await readFile(path.join(PROJECT_ROOT, "cartridge", "manifest.json"), "utf8"),
  );

  if (!options.skipUnit) runUnitGate(reporter);
  await checkSourceDeclarations(manifest, reporter);
  if (!options.sourceOnly) {
    await checkBuildOutputs(reporter);
    await checkPackage(options, manifest, reporter);
    await checkRuntimeReport(
      options.runtimeReport ?? path.join(PROJECT_ROOT, "tmp", "localization", "runtime-report.json"),
      reporter,
    );
  }

  console.log("\nEnglish release gate");
  reporter.passes.forEach((message) => console.log(`PASS: ${message}`));
  reporter.warnings.forEach((message) => console.log(`WARN: ${message}`));
  reporter.errors.forEach((message) => console.error(`FAIL: ${message}`));
  if (reporter.errors.length) {
    console.error(`RESULT: FAILED (${reporter.errors.length} issue(s))`);
    process.exitCode = 1;
  } else {
    console.log("RESULT: PASSED");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
