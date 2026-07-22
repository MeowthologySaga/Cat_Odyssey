import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowedTargets = new Set(["dist/game", "standalone"]);
const targetIndex = process.argv.indexOf("--target");
const targetArgument = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;

if (!targetArgument || !allowedTargets.has(targetArgument.replace(/\\/g, "/"))) {
  throw new Error("Usage: node scripts/prune-build-assets.mjs --target dist/game|standalone");
}

const targetRoot = path.resolve(projectRoot, targetArgument);
if (!targetRoot.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error("Refusing to prune outside the project root.");
}

// The catalog is used by source validation only. Runtime audio references are
// compiled from src/audio/audioAssets.ts, so shipping it wastes public budget.
await rm(path.join(targetRoot, "assets", "audio", "catalog.json"), { force: true });
