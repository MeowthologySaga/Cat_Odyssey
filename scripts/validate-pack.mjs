import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
export const MAX_PACK_BYTES = 250 * 1024 * 1024;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

const LEGAL_AND_PROVENANCE_FILES = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "ASSET_LICENSES.md",
  "ASSET_INVENTORY.json",
  "MEDIA_MANIFEST.json",
  "CUTSCENE_CREDITS.md"
];

const REQUIRED_FILES = [
  "manifest.json",
  "README.md",
  "security-report.md",
  ...LEGAL_AND_PROVENANCE_FILES,
  "game/index.html",
  "assets/thumbnail.webp"
];

const ALLOWED_TOP_LEVEL_FILES = new Set([
  "manifest.json",
  "README.md",
  "security-report.md",
  ...LEGAL_AND_PROVENANCE_FILES
]);

const ALLOWED_TOP_LEVEL_DIRECTORIES = new Set(["game", "assets", "licenses"]);

const ALLOWED_GAME_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".css",
  ".json",
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".mp3",
  ".mp4",
  ".ogg",
  ".wav",
  ".m4a",
  ".woff2",
  ".woff",
  ".ttf",
  ".wasm",
  ".bin"
]);

const FORBIDDEN_SEGMENTS = new Set([
  "node_modules",
  "src",
  ".git",
  ".vscode",
  "coverage",
  "tests",
  "scripts",
  "docs",
  "references",
  "concept"
]);

const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg", ".md", ".txt"]);

export async function collectPackEntries(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const cartridgeRoot = path.join(projectRoot, "cartridge");
  const buildRoot = path.join(projectRoot, "dist", "game");
  const entries = new Map();
  const skippedDevelopmentArtifacts = [];

  for (const fileName of ["manifest.json", "README.md", "security-report.md"]) {
    const sourcePath = path.join(cartridgeRoot, fileName);
    entries.set(fileName, await readRequiredFile(sourcePath));
  }

  for (const fileName of LEGAL_AND_PROVENANCE_FILES) {
    entries.set(fileName, await readRequiredFile(path.join(projectRoot, fileName)));
  }

  await addDirectory(entries, buildRoot, "game", {
    filter(relativePath) {
      const packPath = `game/${toPackPath(relativePath)}`;
      if (isGeneratedDevelopmentArtifact(packPath)) {
        skippedDevelopmentArtifacts.push(packPath);
        return false;
      }
      return true;
    }
  });

  const cartridgeAssets = path.join(cartridgeRoot, "assets");
  if (await isDirectory(cartridgeAssets)) {
    await addDirectory(entries, cartridgeAssets, "assets");
  }

  const licenseRoot = path.join(projectRoot, "licenses");
  if (await isDirectory(licenseRoot)) {
    await addDirectory(entries, licenseRoot, "licenses");
  }

  for (const assetName of ["thumbnail.webp"]) {
    const packPath = `assets/${assetName}`;
    if (!entries.has(packPath)) {
      const buffer = await readFirstExisting([
        path.join(cartridgeRoot, "assets", assetName),
        path.join(buildRoot, "assets", assetName),
        path.join(projectRoot, "public", "assets", assetName)
      ]);
      if (buffer) {
        entries.set(packPath, buffer);
      }
    }
  }

  return {
    entries: withManifestIntegrity(entries),
    skippedDevelopmentArtifacts
  };
}

export function withManifestIntegrity(inputEntries) {
  const entries = cloneEntries(inputEntries);
  const manifestBuffer = entries.get("manifest.json");
  if (!manifestBuffer) throw new Error("manifest.json is required before integrity can be generated.");
  const manifest = JSON.parse(manifestBuffer.toString("utf8"));
  const files = Object.fromEntries(
    [...entries.entries()]
      .filter(([filePath]) => filePath !== "manifest.json")
      .sort(([left], [right]) => comparePaths(left, right))
      .map(([filePath, content]) => [filePath, sha256(content)])
  );
  manifest.integrity = { files };
  entries.set(
    "manifest.json",
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  );
  return entries;
}

export async function validatePackEntries(inputEntries, options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const entries = cloneEntries(inputEntries);
  const errors = [];
  const warnings = [];
  let totalBytes = 0;

  const caseFoldedPaths = new Map();
  for (const [filePath, content] of entries) {
    totalBytes += content.length;
    validatePackPath(filePath, errors);
    if (content.length > MAX_FILE_BYTES) {
      errors.push(`${filePath}: file exceeds ${MAX_FILE_BYTES} bytes.`);
    }
    const folded = filePath.toLocaleLowerCase("en-US");
    const previous = caseFoldedPaths.get(folded);
    if (previous && previous !== filePath) {
      errors.push(`Case-insensitive duplicate paths: ${previous}, ${filePath}`);
    } else {
      caseFoldedPaths.set(folded, filePath);
    }
  }
  if (totalBytes > MAX_PACK_BYTES) {
    errors.push(`Pack exceeds ${MAX_PACK_BYTES} unpacked bytes.`);
  }

  for (const requiredPath of REQUIRED_FILES) {
    if (!entries.has(requiredPath)) {
      errors.push(`Missing required file: ${requiredPath}`);
    }
  }
  if (![...entries.keys()].some((filePath) => filePath.startsWith("game/") && filePath.endsWith(".js"))) {
    errors.push("Missing compiled JavaScript under game/.");
  }

  let manifest;
  const manifestBuffer = entries.get("manifest.json");
  if (manifestBuffer) {
    try {
      manifest = JSON.parse(manifestBuffer.toString("utf8"));
      await validateManifest(manifest, entries, projectRoot, errors, warnings);
    } catch (error) {
      errors.push(
        `manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  scanPackContent(entries, errors, warnings);
  validateCutsceneAttribution(entries, errors);
  validateIntegrityManifest(entries, errors);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifest,
    fileCount: entries.size,
    totalBytes,
    assetCount: [...entries.keys()].filter(
      (filePath) => filePath.startsWith("assets/") || filePath.startsWith("game/assets/")
    ).length
  };
}

export async function validatePackArchive(archivePath, options = {}) {
  const archiveBytes = await readFile(archivePath);
  if (archiveBytes.length > MAX_PACK_BYTES) {
    return {
      ok: false,
      errors: [`Archive exceeds ${MAX_PACK_BYTES} compressed bytes.`],
      warnings: [],
      manifest: undefined,
      fileCount: 0,
      totalBytes: 0,
      assetCount: 0
    };
  }
  const archive = await JSZip.loadAsync(archiveBytes, {
    checkCRC32: true,
    createFolders: false
  });
  const entries = new Map();
  const archiveErrors = [];
  for (const [filePath, zipEntry] of Object.entries(archive.files)) {
    if (!zipEntry.dir) {
      if (zipEntry.unsafeOriginalName && zipEntry.unsafeOriginalName !== filePath) {
        archiveErrors.push(
          `Archive path was sanitized from ${zipEntry.unsafeOriginalName} to ${filePath}.`
        );
      }
      if (
        typeof zipEntry.unixPermissions === "number" &&
        (zipEntry.unixPermissions & 0o170000) === 0o120000
      ) {
        archiveErrors.push(`Symbolic link entry is forbidden: ${filePath}`);
      }
      entries.set(filePath, await zipEntry.async("nodebuffer"));
    }
  }
  const report = await validatePackEntries(entries, options);
  report.errors.unshift(...archiveErrors);
  report.ok = report.errors.length === 0;
  return report;
}

export function formatValidationReport(report, label = "Game Pack") {
  const lines = [
    `${label}: ${report.ok ? "VALID" : "INVALID"}`,
    `Files: ${report.fileCount}`,
    `Assets: ${report.assetCount}`,
    `Unpacked bytes: ${report.totalBytes}`
  ];
  for (const warning of report.warnings) {
    lines.push(`WARN: ${warning}`);
  }
  for (const error of report.errors) {
    lines.push(`ERROR: ${error}`);
  }
  return lines.join("\n");
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function isGeneratedDevelopmentArtifact(filePath) {
  const normalized = toPackPath(filePath).toLowerCase();
  const baseName = path.posix.basename(normalized);
  return (
    normalized === "game/assets/audio/catalog.json" ||
    baseName === "prompt-used.txt" ||
    baseName === "pipeline-meta.json" ||
    baseName.endsWith(".prompt.txt") ||
    /(^|\/)raw-sheet(?:-[^/]*)?\.[a-z0-9]+$/.test(normalized) ||
    /(^|\/)sheet-transparent\.[a-z0-9]+$/.test(normalized)
  );
}

async function validateManifest(manifest, entries, projectRoot, errors, warnings) {
  if (!isObject(manifest)) {
    errors.push("manifest.json must contain an object.");
    return;
  }
  requireEqual(manifest.schemaVersion, 1, "manifest.schemaVersion", errors);
  requireEqual(manifest.contentType, "game_pack", "manifest.contentType", errors);
  requireString(manifest.id, "manifest.id", errors, /^[a-z0-9][a-z0-9_.-]{2,79}$/);
  requireString(
    manifest.lineageId,
    "manifest.lineageId",
    errors,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  requireString(manifest.version, "manifest.version", errors, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  requireString(
    manifest.minPlayZoneVersion,
    "manifest.minPlayZoneVersion",
    errors,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
  );
  requireString(manifest.title, "manifest.title", errors);
  requireString(manifest.description, "manifest.description", errors);
  requireString(manifest.releaseNotes, "manifest.releaseNotes", errors);
  requireString(manifest.creator?.name, "manifest.creator.name", errors);
  requireEqual(
    manifest.license,
    "MIT AND LicenseRef-Meowthology-Official-Builtin AND LicenseRef-Cat-Odyssey-ElevenLabs-NC-1.0",
    "manifest.license",
    errors
  );
  requireEqual(
    manifest.sourceUrl,
    "https://github.com/MeowthologySaga/Cat_Odyssey",
    "manifest.sourceUrl",
    errors
  );
  requireEqual(manifest.category, "action-rpg", "manifest.category", errors);
  requireEqual(
    JSON.stringify(manifest.tags),
    JSON.stringify(["official", "action", "ricochet", "rpg", "collector", "boss-hunt"]),
    "manifest.tags",
    errors
  );

  requireEqual(manifest.entry?.type, "iframe", "manifest.entry.type", errors);
  requireEqual(manifest.entry?.path, "game/index.html", "manifest.entry.path", errors);
  requireEqual(manifest.metadata?.thumbnail, "assets/thumbnail.webp", "manifest.metadata.thumbnail", errors);
  requireEqual(manifest.metadata?.distribution, "non-commercial", "manifest.metadata.distribution", errors);
  requireEqual(
    manifest.metadata?.cutsceneVoiceAttribution,
    "elevenlabs.io",
    "manifest.metadata.cutsceneVoiceAttribution",
    errors
  );
  requireEqual(
    manifest.metadata?.cutsceneLicenseNotice,
    "CUTSCENE_CREDITS.md",
    "manifest.metadata.cutsceneLicenseNotice",
    errors
  );
  requireEqual(
    manifest.metadata?.cutsceneLicenseId,
    "LicenseRef-Cat-Odyssey-ElevenLabs-NC-1.0",
    "manifest.metadata.cutsceneLicenseId",
    errors
  );
  requireEqual(
    manifest.metadata?.cutsceneGenerationMode,
    "ElevenLabs Text to Speech",
    "manifest.metadata.cutsceneGenerationMode",
    errors
  );
  requireString(
    manifest.metadata?.cutsceneVoiceDisclosure,
    "manifest.metadata.cutsceneVoiceDisclosure",
    errors
  );

  const requiredPermissions = {
    walletSpend: true,
    storage: true,
    network: false,
    externalLinks: false,
    cardRead: false
  };
  for (const permission of Object.keys(manifest.permissions ?? {})) {
    if (!(permission in requiredPermissions)) {
      errors.push(`manifest.permissions contains unsupported capability: ${permission}`);
    }
  }
  for (const [permission, expected] of Object.entries(requiredPermissions)) {
    requireEqual(
      manifest.permissions?.[permission],
      expected,
      `manifest.permissions.${permission}`,
      errors
    );
  }
  requireEqual(manifest.save?.scope, "pack", "manifest.save.scope", errors);
  requireString(manifest.save?.key, "manifest.save.key", errors);
  requireEqual(manifest.save?.schemaVersion, 1, "manifest.save.schemaVersion", errors);

  const manifestActions = Array.isArray(manifest.economy?.diamondActions)
    ? manifest.economy.diamondActions
    : [];
  const ids = new Set();
  for (const [index, action] of manifestActions.entries()) {
    const label = `manifest.economy.diamondActions[${index}]`;
    requireString(action?.id, `${label}.id`, errors, /^[a-z0-9][a-z0-9-]{2,79}$/);
    if (ids.has(action?.id)) {
      errors.push(`${label}.id is duplicated: ${String(action?.id)}`);
    }
    ids.add(action?.id);
    if (!Number.isInteger(action?.amount) || action.amount <= 0) {
      errors.push(`${label}.amount must be a positive integer.`);
    }
    requireString(action?.reason, `${label}.reason`, errors);
    requireEqual(action?.requiresConfirm, true, `${label}.requiresConfirm`, errors);
    if (typeof action?.repeatable !== "boolean") {
      errors.push(`${label}.repeatable must be boolean.`);
    }
  }
  await validateEconomyContract(manifestActions, projectRoot, errors, warnings);

  for (const manifestPath of [manifest.entry?.path, manifest.metadata?.thumbnail]) {
    if (typeof manifestPath === "string" && !entries.has(manifestPath)) {
      errors.push(`Manifest path does not exist in pack: ${manifestPath}`);
    }
  }

  validateThumbnailRequirements(entries.get("assets/thumbnail.webp"), errors);
}

async function validateEconomyContract(manifestActions, projectRoot, errors, warnings) {
  const contractPath = path.join(projectRoot, "docs", "design", "DIAMOND_ECONOMY_CONTRACT.md");
  let contract;
  try {
    contract = await readFile(contractPath, "utf8");
  } catch {
    warnings.push("Could not read docs/design/DIAMOND_ECONOMY_CONTRACT.md for parity check.");
    return;
  }
  const expected = [];
  const rowPattern = /^\|\s*`([^`]+)`\s*\|[^|]*\|\s*(\d+)◆?\s*\|[^|]*\|\s*(예|아니오)\s*\|/gm;
  for (const match of contract.matchAll(rowPattern)) {
    expected.push({
      id: match[1],
      amount: Number(match[2]),
      repeatable: match[3] === "예"
    });
  }
  if (!expected.length) {
    errors.push("Diamond economy contract contains no parseable action rows.");
    return;
  }
  const actualById = new Map(manifestActions.map((action) => [action?.id, action]));
  if (manifestActions.length !== expected.length) {
    errors.push(
      `Manifest has ${manifestActions.length} diamond actions, contract requires ${expected.length}.`
    );
  }
  for (const action of expected) {
    const actual = actualById.get(action.id);
    if (!actual) {
      errors.push(`Manifest is missing contracted diamond action: ${action.id}`);
      continue;
    }
    if (actual.amount !== action.amount) {
      errors.push(`${action.id}: amount ${actual.amount} does not match contract ${action.amount}.`);
    }
    if (actual.repeatable !== action.repeatable) {
      errors.push(`${action.id}: repeatable does not match the economy contract.`);
    }
  }
  for (const action of manifestActions) {
    if (action?.id && !expected.some((contractAction) => contractAction.id === action.id)) {
      errors.push(`Manifest contains undeclared diamond action: ${action.id}`);
    }
  }
}

function validateThumbnailRequirements(content, errors) {
  if (!content) {
    return;
  }
  const image = decodePackWebpSize(content);
  if (!image) {
    errors.push("assets/thumbnail.webp is not a complete, readable WebP image.");
    return;
  }
  const aspect = image.width / image.height;
  if (Math.abs(aspect - 16 / 9) > 0.015) {
    errors.push(`Thumbnail must be 16:9, got ${image.width}x${image.height}.`);
  }
  if (image.width < 1280 || image.height < 720) {
    errors.push(`Thumbnail must be at least 1280x720, got ${image.width}x${image.height}.`);
  }
}

function decodePackWebpSize(content) {
  if (
    content.length < 30
    || content.toString("ascii", 0, 4) !== "RIFF"
    || content.toString("ascii", 8, 12) !== "WEBP"
  ) return undefined;
  const declaredBytes = content.readUInt32LE(4) + 8;
  if (declaredBytes > content.length) return undefined;
  let offset = 12;
  while (offset + 8 <= content.length) {
    const type = content.toString("ascii", offset, offset + 4);
    const length = content.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + length > content.length) return undefined;
    if (type === "VP8X" && length >= 10) {
      return {
        width: 1 + content[data + 4] + (content[data + 5] << 8) + (content[data + 6] << 16),
        height: 1 + content[data + 7] + (content[data + 8] << 8) + (content[data + 9] << 16)
      };
    }
    if (
      type === "VP8 "
      && length >= 10
      && content[data + 3] === 0x9d
      && content[data + 4] === 0x01
      && content[data + 5] === 0x2a
    ) {
      return {
        width: content.readUInt16LE(data + 6) & 0x3fff,
        height: content.readUInt16LE(data + 8) & 0x3fff
      };
    }
    if (type === "VP8L" && length >= 5 && content[data] === 0x2f) {
      const bits = content.readUInt32LE(data + 1);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff)
      };
    }
    offset = data + length + (length % 2);
  }
  return undefined;
}

function validateThumbnailPixels(image, errors) {
  const pixelCount = image.width * image.height;
  let visible = 0;
  let nearBlack = 0;
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let minimumLuminance = 255;
  let maximumLuminance = 0;

  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const alpha = image.pixels[offset + 3];
    if (alpha < 32) continue;
    const red = image.pixels[offset];
    const green = image.pixels[offset + 1];
    const blue = image.pixels[offset + 2];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    visible += 1;
    if (luminance < 14) nearBlack += 1;
    luminanceSum += luminance;
    luminanceSquaredSum += luminance * luminance;
    minimumLuminance = Math.min(minimumLuminance, luminance);
    maximumLuminance = Math.max(maximumLuminance, luminance);
  }

  if (visible / pixelCount < 0.85) {
    errors.push("Thumbnail must be an opaque launcher key art image, not a mostly transparent placeholder.");
    return;
  }
  const mean = luminanceSum / visible;
  const variance = Math.max(0, luminanceSquaredSum / visible - mean * mean);
  const deviation = Math.sqrt(variance);
  if (nearBlack / visible > 0.9 || deviation < 8 || maximumLuminance - minimumLuminance < 28) {
    errors.push("Thumbnail looks blank, near-black, or visually uniform; generate and review real launcher key art before packing.");
  }
}

function scanPackContent(entries, errors, warnings) {
  for (const [filePath, content] of entries) {
    const extension = path.posix.extname(filePath).toLowerCase();
    if (filePath.startsWith("game/") && !ALLOWED_GAME_EXTENSIONS.has(extension)) {
      errors.push(`${filePath}: extension is not allowed in the runtime bundle.`);
    }
    if (!TEXT_EXTENSIONS.has(extension) || content.length > 8 * 1024 * 1024) {
      continue;
    }
    const text = content.toString("utf8");
    if (/(?:^|[\s"'`(=])[A-Za-z]:[\\/][^\s"'`]*/m.test(text)) {
      errors.push(`${filePath}: contains an absolute Windows path.`);
    }
    if (/(?:^|[\s"'`(=])\/(?:Users|home)\/[^\s"'`]*/m.test(text)) {
      errors.push(`${filePath}: contains an absolute user path.`);
    }
    if (/file:\/\//i.test(text)) {
      errors.push(`${filePath}: contains a file:// URL.`);
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
      errors.push(`${filePath}: contains a private key marker.`);
    }
    if (/(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][^"']{12,}["']/i.test(text)) {
      errors.push(`${filePath}: contains a possible embedded secret.`);
    }
    if (filePath.startsWith("game/")) {
      scanRuntimeNetworkLiterals(filePath, text, errors, warnings);
      if (/sourceMappingURL\s*=/.test(text)) {
        errors.push(`${filePath}: contains a source map reference.`);
      }
    }
  }
}

function validateCutsceneAttribution(entries, errors) {
  const credits = entries.get("CUTSCENE_CREDITS.md")?.toString("utf8") ?? "";
  for (let episode = 1; episode <= 20; episode += 1) {
    const packPath = `game/assets/video/cutscenes/ep${episode}.mp4`;
    const video = entries.get(packPath);
    if (!video) {
      errors.push(`${packPath}: full-feature non-commercial cutscene is missing.`);
      continue;
    }
    if (!video.includes(Buffer.from("elevenlabs.io", "utf8"))) {
      errors.push(`${packPath}: MP4 title metadata is missing required elevenlabs.io attribution.`);
    }
    const sourcePath = `public/assets/video/cutscenes/ep${episode}.mp4`;
    const episodeLabel = `EP${String(episode).padStart(2, "0")}`;
    if (!credits.includes(sourcePath) || !credits.includes(episodeLabel) || !credits.includes("elevenlabs.io")) {
      errors.push(`${packPath}: CUTSCENE_CREDITS.md is missing its path, episode title, or attribution.`);
    }
  }
}

function scanRuntimeNetworkLiterals(filePath, text, errors, warnings) {
  const forbiddenPatterns = [
    /<(?:script|img|audio|video|source|iframe)\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i,
    /<link\b[^>]*\bhref\s*=\s*["'](?:https?:)?\/\//i,
    /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i,
    /url\(\s*["']?(?:https?:)?\/\//i,
    /\bfetch\s*\(\s*["'`](?:https?:)?\/\//i,
    /\bimportScripts\s*\(\s*["'`](?:https?:)?\/\//i,
    /new\s+(?:WebSocket|EventSource)\s*\(\s*["'`](?:https?:)?\/\//i,
    /\.open\s*\(\s*["'](?:GET|POST|PUT|PATCH|DELETE)["']\s*,\s*["'`](?:https?:)?\/\//i,
    /\.(?:src|href)\s*=\s*["'`](?:https?:)?\/\//i
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(text))) {
    errors.push(`${filePath}: contains an external network resource or request.`);
  }
  const informationalUrls = [...text.matchAll(/https?:\/\/[^\s"'`)<>{}]+/gi)]
    .map((match) => match[0])
    .filter(
      (url) =>
        !url.startsWith("http://www.w3.org/") &&
        !url.startsWith("https://www.w3.org/")
    );
  if (informationalUrls.length) {
    warnings.push(`${filePath}: contains URL text; verified as non-loading text by sink scan.`);
  }
}

function validateIntegrityManifest(entries, errors) {
  const content = entries.get("manifest.json");
  if (!content) return;
  let manifest;
  try {
    manifest = JSON.parse(content.toString("utf8"));
  } catch {
    return;
  }
  const declared = manifest?.integrity?.files;
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) {
    errors.push("manifest.integrity.files must list every non-manifest pack file.");
    return;
  }
  const actualPaths = [...entries.keys()]
    .filter((filePath) => filePath !== "manifest.json")
    .sort(comparePaths);
  const declaredPaths = Object.keys(declared).sort(comparePaths);
  for (const filePath of declaredPaths) {
    if (!entries.has(filePath)) {
      errors.push(`${filePath}: manifest.integrity.files declares a missing file.`);
    } else if (!/^[0-9a-f]{64}$/.test(String(declared[filePath]))) {
      errors.push(`${filePath}: manifest.integrity.files must contain a lowercase SHA-256 digest.`);
    } else if (sha256(entries.get(filePath)) !== declared[filePath]) {
      errors.push(`${filePath}: manifest.integrity.files hash does not match packaged bytes.`);
    }
  }
  for (const filePath of actualPaths) {
    if (!Object.hasOwn(declared, filePath)) {
      errors.push(`${filePath}: file is not listed in manifest.integrity.files.`);
    }
  }
}

function validatePackPath(filePath, errors) {
  if (!filePath || filePath !== toPackPath(filePath) || filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath)) {
    errors.push(`Unsafe or non-canonical pack path: ${filePath}`);
    return;
  }
  const segments = filePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    errors.push(`Unsafe path segments: ${filePath}`);
  }
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()))) {
    errors.push(`Forbidden directory in pack: ${filePath}`);
  }
  if (/\.map$/i.test(filePath) || /(^|\/)\.env(?:\.|$)/i.test(filePath)) {
    errors.push(`Forbidden release file: ${filePath}`);
  }
  if (segments.length === 1 && !ALLOWED_TOP_LEVEL_FILES.has(filePath)) {
    errors.push(`Unexpected top-level file: ${filePath}`);
  }
  if (segments.length > 1 && !ALLOWED_TOP_LEVEL_DIRECTORIES.has(segments[0])) {
    errors.push(`Unexpected top-level directory: ${filePath}`);
  }
}

function decodePackPng(content) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (content.length < 45 || !content.subarray(0, 8).equals(signature)) {
    return undefined;
  }
  let cursor = 8;
  let header;
  const imageDataChunks = [];
  let foundEnd = false;

  while (cursor + 12 <= content.length) {
    const length = content.readUInt32BE(cursor);
    const type = content.toString("ascii", cursor + 4, cursor + 8);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > content.length) return undefined;
    const data = content.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (header || length !== 13 || cursor !== 8) return undefined;
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12]
      };
    } else if (type === "IDAT") {
      imageDataChunks.push(data);
    } else if (type === "IEND") {
      if (length !== 0) return undefined;
      foundEnd = true;
      cursor = chunkEnd;
      break;
    }
    cursor = chunkEnd;
  }

  if (
    !header
    || !foundEnd
    || imageDataChunks.length === 0
    || header.width <= 0
    || header.height <= 0
    || header.bitDepth !== 8
    || ![2, 6].includes(header.colorType)
    || header.compression !== 0
    || header.filter !== 0
    || header.interlace !== 0
  ) {
    return undefined;
  }

  const bytesPerPixel = header.colorType === 6 ? 4 : 3;
  const stride = header.width * bytesPerPixel;
  const expectedBytes = (stride + 1) * header.height;
  let filtered;
  try {
    filtered = inflateSync(Buffer.concat(imageDataChunks));
  } catch {
    return undefined;
  }
  if (filtered.length !== expectedBytes) return undefined;

  const pixels = Buffer.alloc(header.width * header.height * 4);
  let sourceOffset = 0;
  let previousRow = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filterType = filtered[sourceOffset];
    sourceOffset += 1;
    if (filterType > 4) return undefined;
    const row = Buffer.allocUnsafe(stride);
    for (let x = 0; x < stride; x += 1) {
      const encoded = filtered[sourceOffset + x];
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previousRow[x];
      const upperLeft = x >= bytesPerPixel ? previousRow[x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filterType === 1) predictor = left;
      else if (filterType === 2) predictor = up;
      else if (filterType === 3) predictor = Math.floor((left + up) / 2);
      else if (filterType === 4) predictor = paethPredictor(left, up, upperLeft);
      row[x] = (encoded + predictor) & 0xff;
    }
    sourceOffset += stride;
    for (let x = 0; x < header.width; x += 1) {
      const sourcePixel = x * bytesPerPixel;
      const targetPixel = (y * header.width + x) * 4;
      pixels[targetPixel] = row[sourcePixel];
      pixels[targetPixel + 1] = row[sourcePixel + 1];
      pixels[targetPixel + 2] = row[sourcePixel + 2];
      pixels[targetPixel + 3] = bytesPerPixel === 4 ? row[sourcePixel + 3] : 255;
    }
    previousRow = row;
  }
  return { width: header.width, height: header.height, pixels };
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

async function addDirectory(entries, sourceRoot, packRoot, options = {}) {
  if (!(await isDirectory(sourceRoot))) {
    throw new Error(`Required directory does not exist: ${sourceRoot}`);
  }
  const files = await walkFiles(sourceRoot);
  for (const sourcePath of files) {
    const relativePath = toPackPath(path.relative(sourceRoot, sourcePath));
    if (options.filter && !options.filter(relativePath)) {
      continue;
    }
    const packPath = `${packRoot}/${relativePath}`;
    if (entries.has(packPath)) {
      throw new Error(`Duplicate pack path while collecting files: ${packPath}`);
    }
    entries.set(packPath, await readFile(sourcePath));
  }
}

async function walkFiles(rootPath) {
  const output = [];
  async function visit(directory) {
    const items = await readdir(directory, { withFileTypes: true });
    items.sort((left, right) => comparePaths(left.name, right.name));
    for (const item of items) {
      const itemPath = path.join(directory, item.name);
      const stats = await lstat(itemPath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in pack inputs: ${itemPath}`);
      }
      if (stats.isDirectory()) {
        await visit(itemPath);
      } else if (stats.isFile()) {
        output.push(itemPath);
      }
    }
  }
  await visit(rootPath);
  return output;
}

async function isDirectory(targetPath) {
  try {
    return (await lstat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function readRequiredFile(targetPath) {
  try {
    return await readFile(targetPath);
  } catch (error) {
    throw new Error(
      `Required package source is missing: ${targetPath} (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

async function readFirstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch {
      // Continue to the next canonical asset location.
    }
  }
  return undefined;
}

function cloneEntries(inputEntries) {
  return new Map(
    [...inputEntries].map(([filePath, content]) => [
      filePath,
      Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content)
    ])
  );
}

function requireString(value, label, errors, pattern) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a non-empty string.`);
    return;
  }
  if (pattern && !pattern.test(value)) {
    errors.push(`${label} has an invalid format.`);
  }
}

function requireEqual(actual, expected, label, errors) {
  if (actual !== expected) {
    errors.push(`${label} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toPackPath(filePath) {
  return filePath.replace(/\\/g, "/").normalize("NFC");
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function runCli() {
  const args = process.argv.slice(2);
  let report;
  let label;
  if (args[0] === "--archive") {
    if (!args[1]) {
      throw new Error("Usage: node scripts/validate-pack.mjs --archive releases/game.lemgame");
    }
    const archivePath = path.resolve(args[1]);
    report = await validatePackArchive(archivePath);
    label = archivePath;
  } else {
    const collected = await collectPackEntries();
    report = await validatePackEntries(collected.entries);
    label = "prospective .lemgame staging";
    if (collected.skippedDevelopmentArtifacts.length) {
      report.warnings.unshift(
        `Excluded ${collected.skippedDevelopmentArtifacts.length} generated development artifacts.`
      );
    }
  }
  console.log(formatValidationReport(report, label));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
