import { execFileSync } from "node:child_process";
import { renameSync, unlinkSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const PNG_ROOTS = [path.join(ROOT, "public", "assets"), path.join(ROOT, "cartridge", "assets")];
const AUDIO_ROOT = path.join(ROOT, "public", "assets", "audio");
const VIDEO_ROOT = path.join(ROOT, "public", "assets", "video");
const REMOVED_PNG_CHUNKS = new Set(["caBX", "eXIf", "iTXt", "pHYs", "tEXt", "tIME", "zTXt"]);
const REMUX_VIDEOS = process.argv.includes("--remux-video");
const CUTSCENE_TITLES = Object.freeze([
  "캣-립소의 섬",
  "뗏목 출항",
  "나우시-캣과의 만남",
  "로토스 먹는 자들의 섬",
  "폴리-머오무스의 동굴",
  "‘아무도 아니다’의 책략",
  "탈출과 오만한 실수",
  "아이올로스의 바람 주머니",
  "퍼-씨의 마법",
  "1년간의 체류",
  "저승 방문",
  "사이렌의 노래",
  "스킬라와 카리브디스",
  "태양신의 소",
  "이타-캣의 숨겨진 집",
  "아버지와 아들의 재회",
  "오랜 친구 아르고스",
  "구혼자들의 모욕",
  "활의 시험",
  "집이 그를 알아보다",
]);

const counters = { png: 0, mp3: 0, mp4: 0 };

for (const root of PNG_ROOTS) {
  for (const filePath of await walk(root)) {
    if (path.extname(filePath).toLowerCase() === ".png" && await sanitizePng(filePath)) counters.png += 1;
  }
}
for (const filePath of await walk(AUDIO_ROOT)) {
  if (path.extname(filePath).toLowerCase() === ".mp3" && await stripMp3Metadata(filePath)) counters.mp3 += 1;
}
if (REMUX_VIDEOS) {
  for (const filePath of await walk(VIDEO_ROOT)) {
    if (path.extname(filePath).toLowerCase() === ".mp4") {
      sanitizeMp4(filePath);
      counters.mp4 += 1;
    }
  }
}

console.log(JSON.stringify({ status: "ok", sanitized: counters }, null, 2));

async function sanitizePng(filePath) {
  const input = await readFile(filePath);
  const signature = input.subarray(0, 8);
  if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`Invalid PNG signature: ${path.relative(ROOT, filePath)}`);
  }
  const chunks = [signature];
  let cursor = 8;
  let changed = false;
  let foundEnd = false;
  while (cursor + 12 <= input.length) {
    const length = input.readUInt32BE(cursor);
    const type = input.toString("ascii", cursor + 4, cursor + 8);
    const end = cursor + 12 + length;
    if (end > input.length) throw new Error(`Truncated PNG chunk: ${path.relative(ROOT, filePath)}`);
    if (REMOVED_PNG_CHUNKS.has(type)) changed = true;
    else chunks.push(input.subarray(cursor, end));
    cursor = end;
    if (type === "IEND") {
      foundEnd = true;
      break;
    }
  }
  if (!foundEnd) throw new Error(`Missing PNG IEND: ${path.relative(ROOT, filePath)}`);
  if (changed) await writeFile(filePath, Buffer.concat(chunks));
  return changed;
}

async function stripMp3Metadata(filePath) {
  const input = await readFile(filePath);
  let start = 0;
  let end = input.length;
  while (start + 10 <= end && input.toString("ascii", start, start + 3) === "ID3") {
    const flags = input[start + 5];
    const size = synchsafe(input.subarray(start + 6, start + 10));
    start += 10 + size + ((flags & 0x10) ? 10 : 0);
  }
  if (end - start >= 128 && input.toString("ascii", end - 128, end - 125) === "TAG") end -= 128;
  if (end - start >= 32 && input.toString("ascii", end - 32, end - 24) === "APETAGEX") {
    const size = input.readUInt32LE(end - 20);
    if (size > 0 && size <= end - start) end -= size;
  }
  if (start === 0 && end === input.length) return false;
  await writeFile(filePath, input.subarray(start, end));
  return true;
}

function sanitizeMp4(filePath) {
  const episode = Number(path.basename(filePath).match(/^ep(\d+)\.mp4$/i)?.[1]);
  const episodeTitle = CUTSCENE_TITLES[episode - 1];
  if (!Number.isInteger(episode) || !episodeTitle) {
    throw new Error(`Unexpected cutscene MP4 path: ${path.relative(ROOT, filePath)}`);
  }
  const episodeCode = `EP${String(episode).padStart(2, "0")}`;
  const publicationTitle = `Cat Odyssey ${episodeCode} · ${episodeTitle} · elevenlabs.io`;
  const planStatus = episode <= 11 ? "generation plan unknown" : "free plan confirmed";
  const tempPath = `${filePath}.metadata-sanitize.tmp.mp4`;
  try {
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", filePath,
      "-map", "0",
      "-map_metadata", "-1",
      "-c", "copy",
      "-metadata", `title=${publicationTitle}`,
      "-metadata", "artist=MeowthologySaga",
      "-metadata", "album=Cat Odyssey",
      "-metadata", `comment=ElevenLabs narration; ${planStatus}; non-commercial distribution only; attribution: elevenlabs.io`,
      "-metadata", "copyright=Cat Odyssey assets © 2026 MeowthologySaga; narration subject to ElevenLabs terms",
      "-movflags", "+faststart+use_metadata_tags",
      tempPath,
    ], { stdio: "inherit", windowsHide: true });
    renameSync(tempPath, filePath);
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function synchsafe(bytes) {
  return ((bytes[0] & 0x7f) << 21) | ((bytes[1] & 0x7f) << 14) | ((bytes[2] & 0x7f) << 7) | (bytes[3] & 0x7f);
}

async function walk(root) {
  const output = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) output.push(target);
    }
  }
  await visit(root);
  return output;
}
