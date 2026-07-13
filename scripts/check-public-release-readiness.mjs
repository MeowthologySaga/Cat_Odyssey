import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const inventory = JSON.parse(await readFile(path.join(ROOT, "ASSET_INVENTORY.json"), "utf8"));
const media = JSON.parse(await readFile(path.join(ROOT, "MEDIA_MANIFEST.json"), "utf8"));
const errors = [];

const inventoryByPath = new Map(inventory.assets.map((entry) => [entry.path, entry]));
if (inventory.assetCount !== inventory.assets.length) {
  errors.push(`ASSET_INVENTORY assetCount mismatch: ${inventory.assetCount} != ${inventory.assets.length}`);
}
if (media.fileCount !== media.files.length) {
  errors.push(`MEDIA_MANIFEST fileCount mismatch: ${media.fileCount} != ${media.files.length}`);
}

for (const entry of inventory.assets) {
  const content = await readFile(path.join(ROOT, ...entry.path.split("/")));
  const actualHash = createHash("sha256").update(content).digest("hex");
  if (content.length !== entry.bytes) errors.push(`${entry.path}: byte count does not match inventory`);
  if (actualHash !== entry.sha256) errors.push(`${entry.path}: SHA-256 does not match inventory`);
  const status = String(entry.rightsStatus ?? "");
  const license = String(entry.licenseId ?? "");
  if (/BLOCKED|REVIEW/i.test(status) || /REVIEW/i.test(license)) {
    errors.push(`${entry.path}: unresolved rights state (${status}; ${license})`);
  }
}

for (const entry of media.files) {
  const inventoryEntry = inventoryByPath.get(entry.path);
  if (!inventoryEntry) errors.push(`${entry.path}: media manifest entry is absent from asset inventory`);
  else if (entry.sha256 !== inventoryEntry.sha256 || entry.bytes !== inventoryEntry.bytes) {
    errors.push(`${entry.path}: media manifest and asset inventory disagree`);
  }
}

const expectedCutscenes = Array.from({ length: 20 }, (_, index) =>
  `public/assets/video/cutscenes/ep${index + 1}.mp4`
);
for (const filePath of expectedCutscenes) {
  if (!inventoryByPath.has(filePath)) errors.push(`${filePath}: full-feature cutscene is missing`);
}

if (errors.length) {
  console.error(`Public release readiness: BLOCKED (${errors.length} errors)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Public release readiness: PASS (${inventory.assets.length} assets verified)`);
}
