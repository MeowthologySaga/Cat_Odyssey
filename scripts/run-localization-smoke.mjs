import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { chromium } from "playwright-core";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const SCALES = [100, 125, 150];
const HANGUL_PATTERN = /[\u3131-\u318e\uac00-\ud7a3]/u;
const PENDING_PATTERN = /\[?english translation pending\]?|translation[- ]pending/iu;
const SCENES = [
  ["Title", {}],
  ["Tutorial", { replay: true, returnScene: "Title" }],
  ["Cutscene", { cutsceneId: "cat-odyssey-ep01", replay: true, nextScene: "Harbor" }],
  ["Story", { kind: "route", routeId: "route-01-ogygia", replay: true, returnScene: "Harbor" }],
  ["Settings", { returnScene: "Harbor" }],
  ["Harbor", {}],
  ["Collection", { tab: "heroes" }],
  ["Route", { routeId: "route-01-ogygia" }],
  ["Party", { fromHarbor: true }],
  ["Battle", { stageId: "r01-s01" }],
  ["Reward", { stageId: "r01-s01", turns: 4, bestCombo: 5, totalDamage: 900, hpRatio: 0.8, partyHeroIds: ["meow-dysseus"] }],
  ["Summon", {}],
  ["Endgame", {}],
];

function parseArgs(argv) {
  const options = {
    archive: undefined,
    report: path.join(PROJECT_ROOT, "tmp", "localization", "runtime-report.json"),
    chrome: undefined,
    target: "both",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--archive", "--report", "--chrome", "--target"].includes(argument)) {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === "--target") options.target = value;
      else options[argument.slice(2)] = path.resolve(value);
    } else if (argument === "--help" || argument === "-h") {
      console.log("Usage: node scripts/run-localization-smoke.mjs [--archive <release.lemgame>] [--report <report.json>] [--chrome <browser.exe>] [--target both|lemgame|standalone]");
      process.exit(0);
    } else throw new Error(`Unknown option: ${argument}`);
  }
  if (!["both", "lemgame", "standalone"].includes(options.target)) {
    throw new Error("--target must be both, lemgame, or standalone.");
  }
  return options;
}

async function exists(filePath) {
  try { await stat(filePath); return true; }
  catch { return false; }
}

async function findChrome(explicitPath) {
  if (explicitPath && await exists(explicitPath)) return explicitPath;
  for (const candidate of CHROME_PATHS) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("Chrome or Edge executable was not found. Pass --chrome <path>.");
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
  })[extension] ?? "application/octet-stream";
}

async function startDirectoryServer(root) {
  const resolvedRoot = path.resolve(root);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const target = path.resolve(resolvedRoot, relative);
      if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const bytes = await readFile(target);
      response.writeHead(200, { "Content-Type": contentType(target), "Cache-Control": "no-store" });
      response.end(bytes);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function startArchiveServer(archivePath) {
  const zip = await JSZip.loadAsync(await readFile(archivePath), { checkCRC32: true });
  const cache = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const requested = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "game/index.html";
      const archivePathName = requested === "game" ? "game/index.html" : requested;
      const entry = zip.file(archivePathName);
      if (!entry || archivePathName.includes("..")) {
        response.writeHead(404).end("Not found");
        return;
      }
      const bytes = cache.get(archivePathName) ?? await entry.async("nodebuffer");
      cache.set(archivePathName, bytes);
      response.writeHead(200, { "Content-Type": contentType(archivePathName), "Cache-Control": "no-store" });
      response.end(bytes);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/game/index.html` };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

const HOST_INIT_SCRIPT = `(() => {
  const saveKey = "smoke:cat-odyssey:save-v1";
  let balance = 2000;
  let sequence = 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const host = {
    packId: "meowthology.cat-odyssey",
    appVersion: "localization-smoke",
    locale: "en-US",
    wallet: {
      async getBalance() { return { balance }; },
      async spend(input) {
        if (balance < input.amount) return { ok: false, code: "insufficient_balance", message: "Not enough diamonds.", balance };
        if (input.requiresConfirm && !window.confirm(input.reason + "\\n\\nDiamonds: " + input.amount)) {
          return { ok: false, code: "cancelled", message: "Cancelled by the player.", balance };
        }
        balance -= input.amount;
        return { ok: true, transactionId: "smoke-" + (++sequence), balanceAfter: balance };
      },
    },
    save: {
      async load(fallback) {
        const raw = localStorage.getItem(saveKey);
        return raw ? JSON.parse(raw) : clone(fallback);
      },
      async write(value) { localStorage.setItem(saveKey, JSON.stringify(value)); },
      async clear() { localStorage.removeItem(saveKey); },
    },
    ui: {
      toast(message) { window.__SMOKE_TOASTS__.push(String(message)); },
      async confirm(input) { return window.confirm([input.title, input.message].filter(Boolean).join("\\n\\n")); },
    },
    setBalance(value) { balance = Math.max(0, Math.floor(Number(value) || 0)); },
    setSave(value) { localStorage.setItem(saveKey, JSON.stringify(value)); },
    getSave() { const raw = localStorage.getItem(saveKey); return raw ? JSON.parse(raw) : undefined; },
  };
  window.__SMOKE_TOASTS__ = [];
  window.__SMOKE_HOST__ = host;
  window.LEM_GAME_HOST_API = host;
})();`;

async function waitForDebug(page) {
  await page.waitForFunction(() => Boolean(window.__CAT_ODYSSEY_DEBUG__?.game), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const scenes = window.__CAT_ODYSSEY_DEBUG__.game.scene;
    return scenes.isActive("Title") || scenes.isActive("Debug");
  }, null, { timeout: 60_000 });
}

async function startScene(page, key, data) {
  await page.evaluate(({ key, data }) => {
    const game = window.__CAT_ODYSSEY_DEBUG__.game;
    for (const active of game.scene.getScenes(true)) active.scene.stop();
    game.scene.start(key, data);
  }, { key, data });
  await page.waitForFunction((sceneKey) => window.__CAT_ODYSSEY_DEBUG__.game.scene.isActive(sceneKey), key, { timeout: 15_000 });
  await page.waitForTimeout(key === "Cutscene" || key === "Battle" || key === "Reward" ? 900 : 350);
  if (key === "Cutscene") {
    await page.evaluate(() => {
      const scene = window.__CAT_ODYSSEY_DEBUG__.game.scene.getScene("Cutscene");
      if (scene?.video?.setCurrentTime) scene.video.setCurrentTime(1.25);
      if (scene?.updateProgress) scene.updateProgress();
    });
  }
}

async function activateFocusKey(page, sceneKey, focusKey) {
  const activated = await page.evaluate(({ sceneKey, focusKey }) => {
    const scene = window.__CAT_ODYSSEY_DEBUG__.game.scene.getScene(sceneKey);
    const button = scene?.children?.list?.find((entry) => entry?.getData?.("uiFocusKey") === focusKey);
    if (!button) return false;
    button.emit("pointerup");
    return true;
  }, { sceneKey, focusKey });
  if (!activated) throw new Error(`${sceneKey}: focus key not found: ${focusKey}`);
  await page.waitForTimeout(450);
}

async function collectSceneState(page, sceneKey) {
  return page.evaluate((targetScene) => {
    const game = window.__CAT_ODYSSEY_DEBUG__.game;
    const scene = game.scene.getScene(targetScene);
    const renderedTexts = [];
    const accessibilityLabels = [];
    const overflow = [];
    const clippedButtons = [];
    const visited = new Set();
    const visit = (entry, parentButton) => {
      if (!entry || visited.has(entry) || entry.visible === false || entry.alpha === 0) return;
      visited.add(entry);
      const aria = entry.getData?.("uiAriaLabel");
      const isButton = typeof aria === "string" && aria.trim();
      if (isButton) accessibilityLabels.push(aria.trim());
      const button = isButton ? entry : parentButton;
      if (entry.type === "Text" && typeof entry.text === "string" && entry.text.trim()) {
        let bounds;
        try { bounds = entry.getBounds(); } catch { bounds = undefined; }
        renderedTexts.push({ scene: targetScene, text: entry.text, bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined });
        if (bounds && (bounds.left < -8 || bounds.right > 728 || bounds.top < -8 || bounds.bottom > 1288)) {
          overflow.push({ scene: targetScene, text: entry.text, bounds });
        }
        if (button && button.width > 0 && button.height > 0) {
          const left = entry.x - entry.displayOriginX * entry.scaleX;
          const right = left + entry.displayWidth;
          const top = entry.y - entry.displayOriginY * entry.scaleY;
          const bottom = top + entry.displayHeight;
          if (left < -button.width / 2 - 4 || right > button.width / 2 + 4
            || top < -button.height / 2 - 4 || bottom > button.height / 2 + 4) {
            clippedButtons.push({ scene: targetScene, label: aria || button.getData?.("uiAriaLabel"), text: entry.text, localBounds: { left, right, top, bottom }, button: { width: button.width, height: button.height } });
          }
        }
      }
      if (Array.isArray(entry.list)) entry.list.forEach((child) => visit(child, button));
    };
    scene?.children?.list?.forEach((entry) => visit(entry, undefined));
    return { renderedTexts, accessibilityLabels, overflow, clippedButtons };
  }, sceneKey);
}

async function analyzeScreenshot(page, screenshotBytes) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { samples: 0, nonDarkRatio: 0, colorfulRatio: 0 };
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let samples = 0;
    let nonDark = 0;
    let colorful = 0;
    for (let y = 2; y < canvas.height; y += 4) {
      for (let x = 2; x < canvas.width; x += 4) {
        const index = (y * canvas.width + x) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        samples += 1;
        if ((red + green + blue) / 3 > 24) nonDark += 1;
        if (maximum > 35 && maximum - minimum > 12) colorful += 1;
      }
    }
    return {
      samples,
      nonDarkRatio: samples ? nonDark / samples : 0,
      colorfulRatio: samples ? colorful / samples : 0,
    };
  }, screenshotBytes.toString("base64"));
}

async function clickLogical(page, x, y) {
  const canvas = page.locator("#game-root canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Game canvas is missing.");
  await page.mouse.click(box.x + box.width * x / 720, box.y + box.height * y / 1280);
}

async function exercisePurchaseFlows(page, baseUrl) {
  await page.goto(`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}lang=en`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#game-root canvas", { timeout: 20_000 });
  await page.waitForTimeout(900);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  await clickLogical(page, 536, 952);
  await page.waitForTimeout(900);

  page.once("dialog", (dialog) => dialog.dismiss());
  await clickLogical(page, 190, 858);
  await page.waitForTimeout(650);

  await page.evaluate(() => window.__SMOKE_HOST__.setBalance(0));
  await clickLogical(page, 190, 858);
  await page.waitForTimeout(650);

  await page.evaluate(() => window.__SMOKE_HOST__.setBalance(2000));
  page.once("dialog", (dialog) => dialog.accept());
  await clickLogical(page, 190, 858);
  await page.waitForTimeout(1500);
  return ["purchase-confirm", "purchase-cancel", "purchase-failure", "purchase-success"];
}

async function runCase(browser, target, baseUrl, scalePercent, screenshotPath) {
  const factor = scalePercent / 100;
  const cssWidth = Math.round(940 / factor);
  const cssHeight = Math.round(680 / factor);
  const context = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: factor,
    locale: "en-US",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await context.addInitScript({ content: HOST_INIT_SCRIPT });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) consoleErrors.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    consoleErrors.push(`REQUEST FAILED ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const debugUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}catDebug=1&lang=en`;
  await page.goto(debugUrl, { waitUntil: "domcontentloaded" });
  try {
    await waitForDebug(page);
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      documentReadyState: document.readyState,
      activeScenes: window.__CAT_ODYSSEY_DEBUG__?.game?.scene?.getScenes?.(true)?.map((scene) => scene.scene.key) ?? [],
      hasCanvas: Boolean(document.querySelector("#game-root canvas")),
      bodyText: document.body.innerText.slice(0, 500),
    }));
    throw new Error(`${target} ${scalePercent}% did not reach its first scene: ${JSON.stringify({ diagnostics, consoleErrors, pageErrors })}`, { cause: error });
  }
  if (!await page.evaluate(() => window.__CAT_ODYSSEY_DEBUG__.game.scene.isActive("Debug"))) {
    await startScene(page, "Debug", {});
  }
  await activateFocusKey(page, "Debug", "debug-all");

  const languageSwitchFlows = [];
  await startScene(page, "Settings", { returnScene: "Harbor" });
  await activateFocusKey(page, "Settings", "settings-language");
  await activateFocusKey(page, "Settings", "settings-language");
  languageSwitchFlows.push("language-switch");

  const snapshot = await page.evaluate(() => window.__CAT_ODYSSEY_DEBUG__.services.save.getSnapshot());
  await page.evaluate((save) => window.__SMOKE_HOST__.setSave(save), snapshot);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForDebug(page);
  const persistedLanguage = await page.evaluate(() => ({
    save: window.__CAT_ODYSSEY_DEBUG__.services.save.getSnapshot().settings.language,
    document: document.documentElement.lang,
  }));
  if (persistedLanguage.save !== "en" || persistedLanguage.document !== "en") {
    throw new Error(`${target} ${scalePercent}%: saved English language did not survive reload.`);
  }
  languageSwitchFlows.push("save-reload");

  const coveredScenes = [];
  const renderedTexts = [];
  const accessibilityLabels = [];
  const overflow = [];
  const clippedButtons = [];
  for (const [sceneKey, data] of SCENES) {
    await startScene(page, sceneKey, data);
    if (!await page.evaluate((key) => window.__CAT_ODYSSEY_DEBUG__.game.scene.isActive(key), sceneKey)) continue;
    coveredScenes.push(sceneKey);
    const collected = await collectSceneState(page, sceneKey);
    renderedTexts.push(...collected.renderedTexts);
    accessibilityLabels.push(...collected.accessibilityLabels);
    overflow.push(...collected.overflow);
    clippedButtons.push(...collected.clippedButtons);
  }
  const shellLabel = await page.locator("#game-shell").getAttribute("aria-label");
  if (shellLabel) accessibilityLabels.push(shellLabel);
  const untranslated = [
    ...renderedTexts.map((entry) => ({ scene: entry.scene, text: entry.text })),
    ...accessibilityLabels.map((text) => ({ scene: "accessibility", text })),
  ].filter((entry) => HANGUL_PATTERN.test(entry.text) || PENDING_PATTERN.test(entry.text));

  // Persist the complete debug snapshot for a non-debug wallet-flow reload.
  const completeSave = await page.evaluate(() => window.__CAT_ODYSSEY_DEBUG__.services.save.getSnapshot());
  await page.evaluate((save) => window.__SMOKE_HOST__.setSave(save), completeSave);
  const purchaseFlows = await exercisePurchaseFlows(page, baseUrl);

  // Purchase success can end on a transition frame. Return to a deterministic,
  // text-heavy scene so the saved artifact is useful for visual review as well.
  await page.goto(debugUrl, { waitUntil: "domcontentloaded" });
  await waitForDebug(page);
  await startScene(page, "Tutorial", { replay: true, returnScene: "Title" });

  await mkdir(path.dirname(screenshotPath), { recursive: true });
  const screenshotBytes = await page.screenshot({ path: screenshotPath, type: "png" });
  const visualSample = await analyzeScreenshot(page, screenshotBytes);
  const canvasBlank = visualSample.samples === 0 || visualSample.nonDarkRatio < 0.01;
  const pageOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
    || document.documentElement.scrollHeight > document.documentElement.clientHeight
    || document.body.scrollWidth > document.body.clientWidth
    || document.body.scrollHeight > document.body.clientHeight
  ));
  const accessibilityOverlayVisible = await page.evaluate(() => {
    const region = document.querySelector("#game-modal-root");
    if (!(region instanceof HTMLElement) || !region.textContent?.trim()) return false;
    const style = getComputedStyle(region);
    const bounds = region.getBoundingClientRect();
    const visuallyClipped = style.clipPath !== "none"
      || style.clip.includes("rect(0px")
      || (bounds.width <= 2 && bounds.height <= 2 && style.overflow === "hidden");
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || "1") > 0
      && bounds.width > 0
      && bounds.height > 0
      && !visuallyClipped;
  });

  await context.close();
  return {
    target,
    language: "en",
    physicalViewport: { width: 940, height: 680 },
    cssViewport: { width: cssWidth, height: cssHeight },
    scalePercent,
    coveredScenes,
    coveredFlows: [...languageSwitchFlows, ...purchaseFlows],
    renderedTexts,
    accessibilityLabels: [...new Set(accessibilityLabels)],
    overflow,
    clippedButtons,
    consoleErrors,
    pageErrors,
    pageOverflow,
    accessibilityOverlayVisible,
    visualSample,
    canvasBlank,
    untranslated,
    screenshot: `screenshots/${target}-${scalePercent}.png`,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.archive && options.target !== "standalone") {
    const manifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, "cartridge", "manifest.json"), "utf8"));
    options.archive = path.join(PROJECT_ROOT, "releases", `${manifest.id}-${manifest.version}.lemgame`);
  }
  const chrome = await findChrome(options.chrome);
  const targets = [];
  if (options.target === "both" || options.target === "lemgame") {
    targets.push(["lemgame", await startArchiveServer(options.archive)]);
  }
  if (options.target === "both" || options.target === "standalone") {
    targets.push(["standalone", await startDirectoryServer(path.join(PROJECT_ROOT, "standalone"))]);
  }
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--disable-features=TranslateUI"],
  });
  const cases = [];
  try {
    for (const [target, server] of targets) {
      for (const scale of SCALES) {
        const screenshot = path.join(path.dirname(options.report), "screenshots", `${target}-${scale}.png`);
        cases.push(await runCase(browser, target, server.url, scale, screenshot));
      }
    }
  } finally {
    await browser.close();
    await Promise.all(targets.map(([, server]) => closeServer(server.server)));
  }
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), browser: chrome, cases };
  await mkdir(path.dirname(options.report), { recursive: true });
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const violations = cases.reduce((count, entry) => count
    + entry.overflow.length + entry.clippedButtons.length
    + entry.consoleErrors.length + entry.pageErrors.length
    + entry.untranslated.length + Number(entry.pageOverflow)
    + Number(entry.accessibilityOverlayVisible) + Number(entry.canvasBlank), 0);
  console.log(`Localization smoke: ${cases.length} case(s), ${violations} layout/runtime violation(s).`);
  console.log(`Report: ${options.report}`);
  if (violations) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
