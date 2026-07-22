import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import {
  DEFAULT_PROJECT_ROOT,
  collectPackEntries,
  formatValidationReport,
  sha256,
  validatePackEntries
} from "./validate-pack.mjs";

const ZIP_EPOCH = new Date(1980, 0, 1, 0, 0, 0, 0);

export async function buildDeterministicArchive(inputEntries) {
  const zip = new JSZip();
  const sortedEntries = [...inputEntries.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  for (const [filePath, content] of sortedEntries) {
    zip.file(filePath, content, {
      binary: true,
      date: ZIP_EPOCH,
      createFolders: false,
      unixPermissions: 0o100644,
      dosPermissions: 0
    });
  }
  return zip.generateAsync({
    type: "nodebuffer",
    platform: "UNIX",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    streamFiles: false,
    comment: ""
  });
}

export async function packageLem(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const releaseRoot = path.resolve(options.releaseRoot ?? path.join(projectRoot, "releases"));
  const collected = await collectPackEntries({ projectRoot });
  const report = await validatePackEntries(collected.entries, { projectRoot });
  if (collected.skippedDevelopmentArtifacts.length) {
    report.warnings.unshift(
      `Excluded ${collected.skippedDevelopmentArtifacts.length} generated development artifacts.`
    );
  }
  if (!report.ok) {
    throw new Error(formatValidationReport(report, "prospective .lemgame staging"));
  }

  const archive = await buildDeterministicArchive(collected.entries);
  const manifest = report.manifest;
  const fileName = createReleaseFileName(manifest);
  const outputPath = path.join(releaseRoot, fileName);
  const sidecarPath = `${outputPath}.sha256`;
  const archiveHash = sha256(archive);

  await mkdir(releaseRoot, { recursive: true });
  await writeReleaseWithoutOverwrite(outputPath, archive, manifest.version);
  await writeIfChanged(
    sidecarPath,
    Buffer.from(`${archiveHash}  ${fileName}\n`, "utf8")
  );

  return {
    outputPath,
    sidecarPath,
    fileName,
    sha256: archiveHash,
    bytes: archive.length,
    report,
    skippedDevelopmentArtifacts: collected.skippedDevelopmentArtifacts
  };
}

export function createReleaseFileName(manifest) {
  const id = String(manifest?.id ?? "game-pack")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "game-pack";
  const version = String(manifest?.version ?? "0.0.0")
    .trim()
    .replace(/[^0-9a-zA-Z.-]+/g, "-");
  return `${id}-${version}.lemgame`;
}

async function writeIfChanged(targetPath, content) {
  try {
    const current = await readFile(targetPath);
    if (current.equals(content)) {
      return false;
    }
  } catch {
    // The release does not exist yet.
  }
  await writeFile(targetPath, content);
  return true;
}

async function writeReleaseWithoutOverwrite(targetPath, content, version) {
  try {
    const current = await readFile(targetPath);
    if (current.equals(content)) {
      return false;
    }
    throw new Error(
      `Refusing to overwrite a different release at ${targetPath}. Bump manifest.version above ${version}.`
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      await writeFile(targetPath, content);
      return true;
    }
    throw error;
  }
}

async function runCli() {
  const result = await packageLem();
  console.log(formatValidationReport(result.report, result.fileName));
  console.log(`Release: ${result.outputPath}`);
  console.log(`SHA-256: ${result.sha256}`);
  console.log(`Archive bytes: ${result.bytes}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
