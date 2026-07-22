import fs from "node:fs";
import path from "node:path";
import { validateStageContract } from "./stage-contract-validator.mjs";

const root = process.cwd();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const heroes = readJson("src/data/heroes.json");
const enemyData = readJson("src/data/enemies.json");
const routes = readJson("src/data/routes.json");
const stages = readJson("src/data/stages.json");
const blessings = readJson("src/data/blessings.json");
const relics = readJson("src/data/relics.json");
const endgame = readJson("src/data/endgame.json");
const stageModifierSource = readText("src/core/battle/stageModifiers.ts");
const battleRuntimeSource = readText("src/core/battle/runtime.ts");
const routeSceneSource = readText("src/scenes/RouteScene.ts");
const relicEffectResolverSource = readText("src/core/meta/relicEffectResolver.ts");
const endgameOverridesSource = readText("src/core/meta/endgameOverrides.ts");

function quotedStrings(source) {
  return [...source.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function sourceBlock(source, pattern, label) {
  const match = source.match(pattern);
  if (!match?.[1]) throw new Error(`Could not read ${label} from its runtime source.`);
  return match[1];
}

const exactModifierBlock = sourceBlock(
  stageModifierSource,
  /export const EXACT_STAGE_MODIFIER_REGISTRY = \{([\s\S]*?)\n\} as const/,
  "exact stage modifier registry",
);
const exactStageModifierIds = new Set(
  [...exactModifierBlock.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]),
);
function isSupportedStageModifier(source) {
  if (exactStageModifierIds.has(source) || source === "tutorial:direct-hit") return true;
  const preview = source.match(/^preview-bounces:(\d+)$/);
  if (preview) return Number(preview[1]) >= 0 && Number(preview[1]) <= 8;
  const bossPhase = source.match(/^boss-phase-at:(\d+)$/);
  if (bossPhase) return Number(bossPhase[1]) >= 1 && Number(bossPhase[1]) <= 99;
  const shield = source.match(/^shield-front-reduction:(\d+)$/);
  if (shield) return Number(shield[1]) >= 0 && Number(shield[1]) <= 100;
  const protectHp = source.match(/^protect-target-hp-per-extra-hero:(\d+)$/);
  return Boolean(protectHp && Number(protectHp[1]) >= 0 && Number(protectHp[1]) <= 5000);
}

const exactModifierEffectFlags = new Map(
  [...exactModifierBlock.matchAll(/^\s*"([^"]+)":\s*\[([\s\S]*?)\](?:,\s*)?$/gm)].map((match) => [
    match[1],
    [...match[2].matchAll(/effect\("[^"]+",\s*"([^"]+)"/g)].map((effectMatch) => effectMatch[1]),
  ]),
);
function modifierEffectFlags(source) {
  if (exactModifierEffectFlags.has(source)) return exactModifierEffectFlags.get(source);
  if (/^preview-bounces:\d+$/.test(source)) return ["previewBounceLimit"];
  if (/^boss-phase-at:\d+$/.test(source)) return ["phaseHpThresholdPercent"];
  if (/^shield-front-reduction:\d+$/.test(source)) return ["shieldFrontDamageReductionPercent"];
  if (/^protect-target-hp-per-extra-hero:\d+$/.test(source)) return ["protectedTargetHpPerExtraHero"];
  if (source === "tutorial:direct-hit") return ["tutorialMode"];
  return [];
}
const authoredModifierEffectFlags = new Set(
  stages.flatMap((stage) => stage.modifiers ?? []).flatMap(modifierEffectFlags),
);
const runtimeModifierFlags = new Set([
  ...quotedStrings(sourceBlock(
    battleRuntimeSource,
    /export const BATTLE_RUNTIME_MODIFIER_FLAGS = Object\.freeze\(\[([\s\S]*?)\]\s+as const\);/,
    "battle runtime modifier consumers",
  )),
  ...quotedStrings(sourceBlock(
    battleRuntimeSource,
    /export const BATTLE_SCENE_MODIFIER_FLAGS = Object\.freeze\(\[([\s\S]*?)\]\s+as const\);/,
    "battle scene modifier consumers",
  )),
]);
const unsupportedStageEffects = [...authoredModifierEffectFlags]
  .filter((flag) => !runtimeModifierFlags.has(flag));

const authoredHeroEffectKinds = new Set(heroes.flatMap((hero) => [
  ...(hero.friendshipSkill?.effects ?? []),
  ...(hero.activeSkill?.effects ?? []),
]).map((effect) => effect.kind));
const unsupportedHeroEffects = [...authoredHeroEffectKinds]
  .filter((kind) => !battleRuntimeSource.includes(`"${kind}"`));

const blessingCompilerBlock = sourceBlock(
  endgameOverridesSource,
  /function compileBlessingRules\([^)]*\)[\s\S]*?\{([\s\S]*?)\n\}\n\nfunction compileEndgameRule/,
  "blessing runtime compiler",
);
const compiledBlessingEffectKinds = new Set(
  [...blessingCompilerBlock.matchAll(/case "([^"]+)"/g)].map((match) => match[1]),
);
const authoredBlessingEffectKinds = new Set(
  blessings.flatMap((blessing) => blessing.effects ?? []).map((effect) => effect.kind),
);
const unsupportedBlessingEffects = [...authoredBlessingEffectKinds]
  .filter((kind) => !compiledBlessingEffectKinds.has(kind));

const relicEffectSupport = new Map(
  [...relicEffectResolverSource.matchAll(/^\s*(?:"([^"]+)"|([a-z][a-z0-9-]*)):\s*\{[^\n]*support:\s*"(battle|reward|unsupported)"/gm)]
    .map((match) => [match[1] ?? match[2], match[3]]),
);
const authoredRelicEffectKinds = new Set(
  relics.flatMap((relic) => relic.effects ?? []).map((effect) => effect.kind),
);
const unsupportedRelicEffects = [...authoredRelicEffectKinds]
  .filter((kind) => !["battle", "reward"].includes(relicEffectSupport.get(kind)));

const unsupportedPlayerVisibleEffects = [
  ...unsupportedStageEffects.map((kind) => `stage:${kind}`),
  ...unsupportedHeroEffects.map((kind) => `hero:${kind}`),
  ...unsupportedBlessingEffects.map((kind) => `blessing:${kind}`),
  ...unsupportedRelicEffects.map((kind) => `relic:${kind}`),
];

const objectiveLabelBlock = sourceBlock(
  routeSceneSource,
  /const label: Readonly<Record<string, string>> = \{([\s\S]*?)\n\s*\};/,
  "player-facing objective labels",
);
const playerVisibleObjectiveTypes = new Set(
  [...objectiveLabelBlock.matchAll(/(?:"([a-z-]+)"|\b([a-z-]+))\s*:/g)]
    .map((match) => match[1] ?? match[2]),
);

const requiredPropIds = [
  "sleeping-sailor",
  "resonance-crystal",
  "scylla-forepaw",
  "sacred-cattle",
  "axe-ring",
];
const requiredHazardIds = [
  "slow-field",
  "wind-vector",
  "current",
  "whirlpool",
  "sound-wave",
  "portal",
  "lightning",
  "forbidden-target",
  "moving-bumper",
  "one-way-wall",
  "wave-front",
];

const errors = [];

const publicRoot = path.resolve(root, "public");

function publicAssetExists(assetUrl) {
  if (typeof assetUrl !== "string" || assetUrl.includes("..") || assetUrl.includes("\\")) return false;
  const resolved = path.resolve(publicRoot, ...assetUrl.split("/"));
  return resolved.startsWith(`${publicRoot}${path.sep}`) && fs.existsSync(resolved);
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

assert(
  unsupportedPlayerVisibleEffects.length === 0,
  `Player-visible effects lack a runtime/scene consumer: ${unsupportedPlayerVisibleEffects.join(", ")}`,
);
for (const objectiveType of ["defeat-all", "break-parts", "assemble", "survive", "protect", "seal", "escape"]) {
  assert(
    playerVisibleObjectiveTypes.has(objectiveType),
    `Objective '${objectiveType}' lacks a player-facing label tied to its runtime contract.`,
  );
}

function uniqueIndex(items, label) {
  const index = new Map();
  for (const item of items) {
    assert(item && typeof item.id === "string" && item.id.length > 0, `${label} has an empty id.`);
    if (!item?.id) continue;
    assert(!index.has(item.id), `${label} has duplicate id: ${item.id}`);
    index.set(item.id, item);
  }
  return index;
}

function partCount(boss, kind) {
  return (boss.parts ?? [])
    .filter((part) => part.kind === kind)
    .reduce((sum, part) => sum + Number(part.count ?? 0), 0);
}

const heroById = uniqueIndex(heroes, "heroes");
const behaviorById = uniqueIndex(enemyData.behaviors, "enemy behaviors");
const enemyById = uniqueIndex(enemyData.enemies, "enemies");
const routeById = uniqueIndex(routes, "routes");
const stageById = uniqueIndex(stages, "stages");
const blessingById = uniqueIndex(blessings, "blessings");
const relicById = uniqueIndex(relics, "relics");

assert(heroes.length === 16, `Expected 16 heroes, found ${heroes.length}.`);
const canonicalRefs = new Set([
  "meow-dysseus",
  "purr-nelope",
  "tele-meow-chus",
  "a-paw-na",
  "her-meows",
  "cat-lypso",
  "nausi-cat",
  "sailor-crew",
  "eumaeus",
  "argos",
  "aeolus",
  "purr-ce",
  "tiresias",
  "anticleia-ghost",
  "heli-paws",
]);
for (const hero of heroes) {
  assert(canonicalRefs.has(hero.canonicalRefId), `${hero.id} uses unknown canonicalRefId ${hero.canonicalRefId}.`);
  assert(hero.stats?.hp > 0 && hero.stats?.attack > 0 && hero.stats?.speed > 0, `${hero.id} has invalid stats.`);
  assert(Array.isArray(hero.friendshipSkill?.effects) && hero.friendshipSkill.effects.length > 0, `${hero.id} lacks friendship effects.`);
  assert(Array.isArray(hero.activeSkill?.effects) && hero.activeSkill.effects.length > 0, `${hero.id} lacks active skill effects.`);
  assert(
    fs.existsSync(path.join(root, "public", "assets", "art", "characters", `${hero.id}-flight.png`)),
    `${hero.id} lacks its runtime character image.`,
  );
}

const requiredBehaviorIds = ["charger", "shooter", "shield", "heavy", "support", "splitter", "summoner"];
assert(enemyData.behaviors.length === 7, `Expected 7 enemy behavior groups, found ${enemyData.behaviors.length}.`);
assert(
  requiredBehaviorIds.every((id) => behaviorById.has(id)) && behaviorById.size === requiredBehaviorIds.length,
  `Enemy behaviors must be exactly: ${requiredBehaviorIds.join(", ")}.`,
);
assert(enemyData.enemies.length >= 20, `Expected at least 20 enemies, found ${enemyData.enemies.length}.`);
for (const enemy of enemyData.enemies) {
  assert(behaviorById.has(enemy.behaviorId), `${enemy.id} references missing behavior ${enemy.behaviorId}.`);
  assert(enemy.radius > 0, `${enemy.id} has invalid radius.`);
  assert(enemy.stats?.hp > 0 && enemy.stats?.attack >= 0, `${enemy.id} has invalid stats.`);
  const enemyFolder = enemy.boss ? "bosses" : "enemies";
  assert(
    fs.existsSync(path.join(root, "public", "assets", "art", enemyFolder, `${enemy.id}.png`)),
    `${enemy.id} lacks its runtime ${enemy.boss ? "boss" : "enemy"} image.`,
  );
}

const expectedRouteOrder = [
  "route-01-ogygia",
  "route-02-lotus",
  "route-03-cyclops",
  "route-04-aeolus",
  "route-05-circe",
  "route-06-underworld",
  "route-07-sirens",
  "route-08-strait",
  "route-09-thrinacia",
  "route-10-ithaca",
];
assert(routes.length === 10, `Expected 10 routes, found ${routes.length}.`);
assert(stages.length === 43, `Expected 43 stages, found ${stages.length}.`);
assert(
  routes.slice().sort((a, b) => a.order - b.order).map((route) => route.id).join("|") === expectedRouteOrder.join("|"),
  "Route order no longer follows the Odyssey sequence.",
);
const coreRoutes = routes.filter((route) => route.coreRoute);
const regularRoutes = routes.filter((route) => !route.coreRoute);
assert(coreRoutes.length === 3, `Expected 3 core routes, found ${coreRoutes.length}.`);
assert(regularRoutes.length === 7, `Expected 7 regular routes, found ${regularRoutes.length}.`);
assert(coreRoutes.every((route) => route.stageIds.length === 5), "Every core route must contain exactly 5 stages.");
assert(regularRoutes.every((route) => route.stageIds.length === 4), "Every regular route must contain exactly 4 stages.");
assert(
  coreRoutes.map((route) => route.id).join("|") === "route-03-cyclops|route-08-strait|route-10-ithaca",
  "Core routes must remain Cyclops, Scylla/Charybdis, and Ithaca.",
);

const commercialWaiverIds = new Set();
for (const route of routes) {
  for (const waiver of route.commercialWaivers ?? []) {
    assert(!commercialWaiverIds.has(waiver.id), `Commercial waiver id is duplicated: ${waiver.id}`);
    commercialWaiverIds.add(waiver.id);
  }
}

for (const route of routes) {
  assert(enemyById.has(route.bossId), `${route.id} references missing boss enemy ${route.bossId}.`);
  assert(enemyById.get(route.bossId)?.boss === true, `${route.id} boss ${route.bossId} is not marked as a boss.`);
  const actualStages = stages.filter((stage) => stage.routeId === route.id).sort((a, b) => a.order - b.order);
  assert(actualStages.length === route.stageIds.length, `${route.id} stage count differs from stageIds.`);
  assert(actualStages.map((stage) => stage.id).join("|") === route.stageIds.join("|"), `${route.id} stageIds are out of order.`);
  assert(actualStages.every((stage, index) => stage.order === index + 1), `${route.id} stage order must start at 1 without gaps.`);
  assert(
    fs.existsSync(path.join(root, "public", "assets", "art", "maps", "routes", `${route.id}.png`)),
    `${route.id} lacks its runtime route map.`,
  );
  const missingCommercialArt = {
    backgroundAssetUrl: actualStages.some((stage) => !stage.arena?.backgroundAssetUrl),
    "wall-presentation": actualStages.some((stage) => stage.walls.some((wall) => !wall.presentation)),
    "prop-presentation": actualStages.some((stage) => stage.spawns.some(
      (spawn) => spawn.kind === "prop" && !spawn.presentation,
    )),
  };
  for (const waiver of route.commercialWaivers ?? []) {
    for (const gate of waiver.gates ?? []) {
      assert(
        missingCommercialArt[gate] === true,
        `${route.id} waiver ${waiver.id} keeps stale gate '${gate}' after coverage was completed.`,
      );
    }
  }
}

for (const propId of requiredPropIds) {
  assert(
    fs.existsSync(path.join(root, "public", "assets", "art", "props", `${propId}.png`)),
    `${propId} lacks its runtime prop image.`,
  );
}
for (const hazardId of requiredHazardIds) {
  assert(
    fs.existsSync(path.join(root, "public", "assets", "art", "hazards", `${hazardId}.png`)),
    `${hazardId} lacks its runtime hazard image.`,
  );
}

const requiredStageKeys = [
  "arena",
  "walls",
  "spawns",
  "enemies",
  "hazards",
  "objective",
  "rewards",
  "modifiers",
  "boss",
];

const commercialCoverage = {
  authoredBackgrounds: 0,
  waivedBackgrounds: 0,
  presentedWalls: 0,
  waivedWalls: 0,
  presentedProps: 0,
  waivedProps: 0,
};

function routeWaives(route, gate) {
  return (route?.commercialWaivers ?? []).some((waiver) => waiver.gates?.includes(gate));
}

for (const stage of stages) {
  assert(routeById.has(stage.routeId), `${stage.id} references missing route ${stage.routeId}.`);
  for (const key of requiredStageKeys) {
    assert(Object.hasOwn(stage, key), `${stage.id} is missing required data field ${key}.`);
  }
  assert(stage.arena?.width === 720 && stage.arena?.height === 1040, `${stage.id} must use the 720x1040 combat arena.`);
  assert(Array.isArray(stage.walls) && stage.walls.length > 0, `${stage.id} must declare at least one wall.`);
  assert(Array.isArray(stage.spawns) && stage.spawns.some((spawn) => spawn.kind === "party"), `${stage.id} lacks a party spawn.`);
  assert(Array.isArray(stage.enemies), `${stage.id}.enemies must be an array.`);
  assert(Array.isArray(stage.hazards), `${stage.id}.hazards must be an array.`);
  assert(Array.isArray(stage.modifiers), `${stage.id}.modifiers must be an array.`);
  assert(stage.objective?.turnLimit > 0, `${stage.id} has an invalid objective turnLimit.`);
  assert(stage.rewards?.gold >= 0 && stage.rewards?.heroXp >= 0, `${stage.id} has invalid rewards.`);

  const spawnById = uniqueIndex(stage.spawns, `${stage.id} spawns`);
  uniqueIndex(stage.walls, `${stage.id} walls`);
  uniqueIndex(stage.hazards, `${stage.id} hazards`);
  for (const placement of stage.enemies) {
    assert(enemyById.has(placement.enemyId), `${stage.id} references missing enemy ${placement.enemyId}.`);
    assert(spawnById.has(placement.spawnId), `${stage.id} enemy ${placement.enemyId} references missing spawn ${placement.spawnId}.`);
    assert(["enemy", "boss"].includes(spawnById.get(placement.spawnId)?.kind), `${stage.id} enemy ${placement.enemyId} uses a non-enemy spawn.`);
    assert(placement.level > 0, `${stage.id} enemy ${placement.enemyId} has invalid level.`);
  }

  const route = routeById.get(stage.routeId);
  const commercialWaivers = route?.commercialWaivers ?? [];
  errors.push(...validateStageContract(stage, {
    assetExists: publicAssetExists,
    commercialStrict: true,
    commercialWaivers,
    isModifierSupported: isSupportedStageModifier,
    playerVisibleObjectiveTypes,
    partySizes: [1, 2, 3],
  }));

  if (stage.arena.backgroundAssetUrl) commercialCoverage.authoredBackgrounds += 1;
  else if (routeWaives(route, "backgroundAssetUrl")) commercialCoverage.waivedBackgrounds += 1;
  for (const wall of stage.walls) {
    if (wall.presentation) commercialCoverage.presentedWalls += 1;
    else if (routeWaives(route, "wall-presentation")) commercialCoverage.waivedWalls += 1;
  }
  for (const prop of stage.spawns.filter((spawn) => spawn.kind === "prop")) {
    if (prop.presentation) commercialCoverage.presentedProps += 1;
    else if (routeWaives(route, "prop-presentation")) commercialCoverage.waivedProps += 1;
  }

  const firstClear = stage.rewards?.firstClear;
  assert(firstClear && ["hero", "relic", "fragment", "material"].includes(firstClear.kind), `${stage.id} has an invalid first-clear reward kind.`);
  assert(Number.isInteger(firstClear?.amount) && firstClear.amount > 0, `${stage.id} first-clear reward amount must be a positive integer.`);
  if (firstClear?.kind === "hero") assert(heroById.has(firstClear.id), `${stage.id} first-clear hero ${firstClear.id} does not exist.`);
  if (firstClear?.kind === "fragment") assert(heroById.has(firstClear.id), `${stage.id} first-clear fragment hero ${firstClear.id} does not exist.`);
  if (firstClear?.kind === "relic") assert(relicById.has(firstClear.id), `${stage.id} first-clear relic ${firstClear.id} does not exist.`);
  if (firstClear?.kind === "material") assert(typeof firstClear.id === "string" && firstClear.id.trim().length > 0, `${stage.id} first-clear material id is empty.`);

  if (stage.boss) {
    assert(enemyById.get(stage.boss.bossId)?.boss === true, `${stage.id} references invalid boss ${stage.boss.bossId}.`);
    for (const supportId of stage.boss.supportBossIds ?? []) {
      assert(enemyById.get(supportId)?.boss === true, `${stage.id} references invalid support boss ${supportId}.`);
    }
    uniqueIndex(stage.boss.parts ?? [], `${stage.id} boss parts`);
  }
}

const polyBosses = stages.filter((stage) => stage.boss?.bossId === "poly-meow-mus").map((stage) => stage.boss);
assert(polyBosses.length === 1, `Expected one Poly-meow-mus boss stage, found ${polyBosses.length}.`);
for (const boss of polyBosses) {
  assert(boss.anatomy?.eyes === 1, "Poly-meow-mus must have exactly one eye in anatomy data.");
  assert(partCount(boss, "eye") === 1, "Poly-meow-mus eye part count must be exactly one.");
}

const scyllaBosses = stages.filter((stage) => stage.boss?.bossId === "scylla-cat").map((stage) => stage.boss);
assert(scyllaBosses.length === 1, `Expected one Scylla boss stage, found ${scyllaBosses.length}.`);
for (const boss of scyllaBosses) {
  assert(boss.anatomy?.heads === 6, "Scylla must have exactly six heads.");
  assert(boss.anatomy?.necks === 6, "Scylla must have exactly six necks.");
  assert(boss.anatomy?.forepaws === 2, "Scylla must have exactly two forepaws.");
  assert(partCount(boss, "head") === 6, "Scylla head part count must be exactly six.");
  assert(partCount(boss, "neck") === 6, "Scylla neck part count must be exactly six.");
  assert(partCount(boss, "forepaw") === 2, "Scylla forepaw part count must be exactly two.");
}

assert(blessings.length === 30, `Expected 30 blessings, found ${blessings.length}.`);
assert(relics.length === 32, `Expected 32 relics, found ${relics.length}.`);
for (const blessing of blessings) {
  assert(Array.isArray(blessing.effects) && blessing.effects.length > 0, `${blessing.id} lacks effects.`);
}
for (const relic of relics) {
  assert(Array.isArray(relic.effects) && relic.effects.length > 0, `${relic.id} lacks effects.`);
}

const floors = endgame.oracleTower?.floors ?? [];
assert(floors.length === 30, `Expected 30 oracle floors, found ${floors.length}.`);
const floorById = uniqueIndex(floors, "oracle floors");
assert(floorById.size === 30, "Oracle floor ids must be unique.");
for (const [index, floor] of floors.entries()) {
  assert(floor.floor === index + 1, `Oracle floor sequence breaks at ${floor.id}.`);
  assert(stageById.has(floor.stageId), `${floor.id} references missing stage ${floor.stageId}.`);
  assert(floor.lockoutFloors === 3, `${floor.id} must preserve the three-floor hero lockout.`);
  assert(floor.bossFloor === ((index + 1) % 5 === 0), `${floor.id} bossFloor must be true only every fifth floor.`);
  if (floor.reward?.kind === "relic") assert(relicById.has(floor.reward.id), `${floor.id} references missing relic ${floor.reward.id}.`);
}

const stormRoute = endgame.stormRoute;
assert(stormRoute?.nodeCount === 12, "Storm route nodeCount must be 12.");
assert(stormRoute?.nodes?.length === 12, `Expected 12 storm route nodes, found ${stormRoute?.nodes?.length ?? 0}.`);
for (const [index, node] of (stormRoute?.nodes ?? []).entries()) {
  assert(node.index === index + 1, `Storm route node sequence breaks at ${node.index}.`);
  if (["battle", "elite", "boss"].includes(node.type)) {
    for (const stageId of node.pool) assert(stageById.has(stageId), `Storm node ${node.index} references missing stage ${stageId}.`);
  }
  if (node.type === "blessing") {
    for (const blessingId of node.pool) assert(blessingById.has(blessingId), `Storm node ${node.index} references missing blessing ${blessingId}.`);
  }
}

const raid = endgame.raid;
assert(raid?.partiesRequired === 3, "Raid must require exactly three parties.");
assert(raid?.heroesPerParty === 4, "Raid parties must contain four heroes.");
assert(raid?.duplicateHeroesAllowed === false, "Raid must prohibit duplicate heroes across parties.");
assert(raid?.phases?.length === 3, `Raid must have exactly three party phases, found ${raid?.phases?.length ?? 0}.`);
assert((raid?.phases ?? []).map((phase) => phase.party).join("|") === "1|2|3", "Raid party phases must be ordered 1, 2, 3.");
assert(raid?.anatomy?.heads === 6, "Raid Scylla must have six heads.");
assert(raid?.anatomy?.necks === 6, "Raid Scylla must have six necks.");
assert(raid?.anatomy?.forepaws === 2, "Raid Scylla must have two forepaws.");

// Stage content is JSON-only. Bespoke stage mechanics must be represented by data/modifier ids.
const forbiddenStageLogic = fs
  .readdirSync(path.join(root, "src/data"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^stage.*\.(?:ts|tsx|js|mjs)$/i.test(entry.name));
assert(forbiddenStageLogic.length === 0, `Stage-specific logic files are forbidden in src/data: ${forbiddenStageLogic.map((entry) => entry.name).join(", ")}`);

const summary = {
  heroes: heroes.length,
  enemyBehaviors: enemyData.behaviors.length,
  enemies: enemyData.enemies.length,
  routes: routes.length,
  regularRoutes: regularRoutes.length,
  coreRoutes: coreRoutes.length,
  stages: stages.length,
  blessings: blessings.length,
  relics: relics.length,
  oracleFloors: floors.length,
  stormNodes: stormRoute?.nodes?.length ?? 0,
  raidParties: raid?.phases?.length ?? 0,
  polyEyes: polyBosses[0]?.anatomy?.eyes ?? null,
  scylla: scyllaBosses[0]?.anatomy ?? null,
  commercialStrict: {
    unsupportedPlayerVisibleEffects: unsupportedPlayerVisibleEffects.length,
    objectiveTypesWithPlayerCopy: playerVisibleObjectiveTypes.size,
    simulatedPartySizes: [1, 2, 3],
    waiverCount: commercialWaiverIds.size,
    artCoverage: commercialCoverage,
  },
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) process.exitCode = 1;
