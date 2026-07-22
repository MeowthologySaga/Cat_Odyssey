const VISUAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_ASSET_URL_PATTERN = /^assets\/[a-z0-9_./-]+\.png$/;

export const COMMERCIAL_ART_GATES = Object.freeze([
  "backgroundAssetUrl",
  "wall-presentation",
  "prop-presentation",
]);

/** Player copy is derived from these objective types, so the runtime contract is closed. */
export const OBJECTIVE_RUNTIME_CONTRACTS = Object.freeze({
  "defeat-all": { victoryRule: "defeatAll", targetKind: "enemy" },
  "break-parts": { victoryRule: "completeTargets", targetKind: "breakable" },
  assemble: { victoryRule: "completeTargets", targetKind: "assembly" },
  survive: { victoryRule: "surviveTurns", targetKind: "turn" },
  protect: { victoryRule: "protectTargets-or-rescue", targetKind: "protected" },
  seal: { victoryRule: "completeTargets", targetKind: "seal" },
  escape: { victoryRule: "completeTargets", targetKind: "exit" },
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isSafeAssetUrl(value) {
  return typeof value === "string"
    && SAFE_ASSET_URL_PATTERN.test(value)
    && !value.includes("..")
    && !value.includes("\\");
}

function validateCommercialWaivers(waivers, errors) {
  const covered = new Set();
  const ids = new Set();
  for (const waiver of Array.isArray(waivers) ? waivers : []) {
    const label = `commercial waiver '${waiver?.id ?? "<missing>"}'`;
    if (!VISUAL_ID_PATTERN.test(waiver?.id ?? "")) errors.push(`${label} must declare a stable kebab-case id.`);
    else if (ids.has(waiver.id)) errors.push(`${label} is duplicated.`);
    else ids.add(waiver.id);
    if (!Array.isArray(waiver?.gates) || waiver.gates.length === 0) {
      errors.push(`${label} must declare at least one gate.`);
    } else {
      for (const gate of waiver.gates) {
        if (!COMMERCIAL_ART_GATES.includes(gate)) errors.push(`${label} references unknown gate '${gate}'.`);
        else covered.add(gate);
      }
    }
    if (typeof waiver?.reason !== "string" || waiver.reason.trim().length < 20) {
      errors.push(`${label} must explain the temporary production gap.`);
    }
    if (typeof waiver?.sunset !== "string" || waiver.sunset.trim().length === 0) {
      errors.push(`${label} must declare a sunset condition.`);
    }
  }
  return covered;
}

function validatePresentation(presentation, ownerLabel, folder, assetExists, errors) {
  if (!presentation) return;
  const visualIds = [
    presentation.visualId,
    ...Object.values(presentation.stateVisualIds ?? {}),
  ];
  if (!VISUAL_ID_PATTERN.test(presentation.visualId ?? "")) {
    errors.push(`${ownerLabel} presentation has invalid visualId '${presentation.visualId ?? ""}'.`);
  }
  if (presentation.width !== undefined && (!isFiniteNumber(presentation.width) || presentation.width <= 0)) {
    errors.push(`${ownerLabel} presentation width must be a positive number.`);
  }
  if (presentation.height !== undefined && (!isFiniteNumber(presentation.height) || presentation.height <= 0)) {
    errors.push(`${ownerLabel} presentation height must be a positive number.`);
  }
  for (const [axis, anchor] of [["anchorX", presentation.anchorX], ["anchorY", presentation.anchorY]]) {
    if (anchor !== undefined && (!isFiniteNumber(anchor) || anchor < 0 || anchor > 1)) {
      errors.push(`${ownerLabel} presentation ${axis} must be in [0, 1].`);
    }
  }
  for (const [state, visualId] of Object.entries(presentation.stateVisualIds ?? {})) {
    if (!state.trim()) errors.push(`${ownerLabel} presentation has an empty state key.`);
    if (!VISUAL_ID_PATTERN.test(visualId ?? "")) {
      errors.push(`${ownerLabel} presentation state '${state}' has invalid visualId '${visualId ?? ""}'.`);
    }
  }
  for (const visualId of new Set(visualIds.filter((value) => typeof value === "string" && value.length > 0))) {
    const assetUrl = `assets/art/${folder}/${visualId}.png`;
    if (!assetExists(assetUrl)) errors.push(`${ownerLabel} presentation asset is missing: ${assetUrl}`);
  }
}

function validateAssemblyTarget(stage, spawn, errors) {
  const label = `${stage.id} assemble target ${spawn.id}`;
  const interaction = spawn.interaction;
  if (spawn.kind !== "prop") {
    errors.push(`${label} must resolve to a prop spawn.`);
    return;
  }
  if (interaction?.mode !== "assembly") {
    errors.push(`${label} must declare interaction.mode 'assembly'.`);
    return;
  }
  if (!isPositiveInteger(interaction.hitsRequired)) {
    errors.push(`${label} hitsRequired must be a positive integer.`);
  }
  if (interaction.maxHp !== undefined) {
    errors.push(`${label} must not mix assembly hitsRequired with maxHp.`);
  }
  const destination = interaction.destination;
  if (!destination || !isFiniteNumber(destination.x) || !isFiniteNumber(destination.y)) {
    errors.push(`${label} must declare a finite destination.`);
    return;
  }
  const radius = Math.max(0, Number(spawn.radius) || 0);
  if (
    destination.x < radius
    || destination.x > stage.arena.width - radius
    || destination.y < radius
    || destination.y > stage.arena.height - radius
  ) {
    errors.push(`${label} destination must stay inside the arena after its radius is applied.`);
  }
}

function validateWaveFront(stage, hazard, errors) {
  const label = `${stage.id} wave-front ${hazard.id}`;
  const parameters = hazard.parameters ?? {};
  const axis = parameters.axis;
  if (axis !== "x" && axis !== "y") errors.push(`${label} axis must be 'x' or 'y'.`);
  if (parameters.direction !== -1 && parameters.direction !== 1) {
    errors.push(`${label} direction must be -1 or 1.`);
  }
  if (!isFiniteNumber(parameters.distance) || parameters.distance < 0) {
    errors.push(`${label} distance must be a non-negative number.`);
  }
  if (!Number.isInteger(parameters.warningTurns) || parameters.warningTurns < 0) {
    errors.push(`${label} warningTurns must be a non-negative integer.`);
  }
  if (!isPositiveInteger(parameters.activeTurns)) {
    errors.push(`${label} activeTurns must be a positive integer.`);
  }
  if (!isFiniteNumber(parameters.length) || parameters.length <= 0) {
    errors.push(`${label} length must be a positive number.`);
  } else {
    const crossAxisSize = axis === "x" ? stage.arena.height : stage.arena.width;
    if (parameters.length > crossAxisSize * 1.5) {
      errors.push(`${label} length is implausibly larger than its arena cross-axis.`);
    }
  }
  const hasVector = isFiniteNumber(parameters.forceX) && isFiniteNumber(parameters.forceY);
  const hasScalarForce = isFiniteNumber(parameters.force) && parameters.force >= 0;
  if (!hasVector && !hasScalarForce) {
    errors.push(`${label} must declare either finite forceX/forceY or a non-negative force.`);
  } else if (hasVector && parameters.forceX === 0 && parameters.forceY === 0 && (!hasScalarForce || parameters.force === 0)) {
    errors.push(`${label} must apply a non-zero force vector.`);
  }
  if (parameters.pushDistance !== undefined && (!isFiniteNumber(parameters.pushDistance) || parameters.pushDistance < 0)) {
    errors.push(`${label} pushDistance must be a non-negative number.`);
  }
  if (!isFiniteNumber(parameters.damage) || parameters.damage < 0) {
    errors.push(`${label} damage must be a non-negative number.`);
  }
  if (!isFiniteNumber(hazard.radius) || hazard.radius <= 0) {
    errors.push(`${label} radius must be a positive number.`);
  }
  if (axis === "x" || axis === "y") {
    const origin = axis === "x" ? hazard.x : hazard.y;
    const arenaSize = axis === "x" ? stage.arena.width : stage.arena.height;
    const destination = origin + Number(parameters.direction) * Number(parameters.distance);
    if (!isFiniteNumber(origin) || !isFiniteNumber(destination) || origin < 0 || origin > arenaSize || destination < 0 || destination > arenaSize) {
      errors.push(`${label} travel path must begin and end inside the arena.`);
    }
  }
}

function validateSoundWave(stage, hazard, errors) {
  const label = `${stage.id} sound-wave ${hazard.id}`;
  const parameters = hazard.parameters ?? {};
  const fanDegrees = parameters.fanDegrees;
  const fanCount = parameters.fanCount;
  if (fanDegrees !== undefined) {
    if (!isFiniteNumber(fanDegrees) || fanDegrees <= 0 || fanDegrees > 360) {
      errors.push(`${label} fanDegrees must be in (0, 360].`);
    }
    if (!isPositiveInteger(fanCount)) {
      errors.push(`${label} fanDegrees requires a positive integer fanCount so collision and telegraph agree.`);
    }
  } else if (fanCount !== undefined) {
    errors.push(`${label} fanCount requires a finite positive fanDegrees.`);
  }
  if (isPositiveInteger(fanCount) && isFiniteNumber(fanDegrees) && fanCount * fanDegrees >= 360) {
    errors.push(`${label} damage fans leave no readable safe angle.`);
  }
  const rotatingGap = parameters.rotatingGapDegrees;
  if (
    rotatingGap !== undefined
    && (!isFiniteNumber(rotatingGap) || rotatingGap <= 0 || rotatingGap >= 360)
  ) {
    errors.push(`${label} rotatingGapDegrees must be in (0, 360).`);
  }
}

function validateSolidCircleObjectiveEnclosure(stage, spawnById, bossPartById, errors) {
  const objectiveTargetsBossPart = (stage.objective?.targetIds ?? []).some((targetId) => bossPartById.has(targetId));
  if (!objectiveTargetsBossPart || !stage.boss?.bossId) return;
  const bossPlacement = (stage.enemies ?? []).find((enemy) => enemy.enemyId === stage.boss.bossId);
  const bossSpawn = bossPlacement ? spawnById.get(bossPlacement.spawnId) : undefined;
  const partySpawn = (stage.spawns ?? []).find((spawn) => spawn.kind === "party");
  if (!bossSpawn || !partySpawn) return;
  for (const wall of stage.walls ?? []) {
    if (wall.shape !== "circle" || !isFiniteNumber(wall.radius) || wall.radius <= 0) continue;
    const bossDistance = Math.hypot(bossSpawn.x - wall.x, bossSpawn.y - wall.y);
    const partyDistance = Math.hypot(partySpawn.x - wall.x, partySpawn.y - wall.y);
    const bossFullyInside = bossDistance + Math.max(0, Number(bossSpawn.radius) || 0) < wall.radius;
    const partyFullyOutside = partyDistance - Math.max(0, Number(partySpawn.radius) || 0) > wall.radius;
    if (bossFullyInside && partyFullyOutside) {
      errors.push(`${stage.id} solid circle wall ${wall.id} seals the objective boss away from the party; author a segmented ring with an entrance.`);
    }
  }
}

function validateObjectiveRuntimeConsistency(stage, spawnById, bossPartById, options, errors) {
  const objective = stage?.objective;
  if (!objective) return;
  const contract = OBJECTIVE_RUNTIME_CONTRACTS[objective.type];
  if (!contract) {
    errors.push(`${stage.id} objective '${objective.type}' has no runtime victory contract.`);
    return;
  }
  if (!isPositiveInteger(objective.turnLimit)) {
    errors.push(`${stage.id} ${objective.type} objective turnLimit must be a positive integer.`);
  }
  if (options.commercialStrict && options.playerVisibleObjectiveTypes) {
    const supportedCopy = options.playerVisibleObjectiveTypes instanceof Set
      ? options.playerVisibleObjectiveTypes
      : new Set(options.playerVisibleObjectiveTypes);
    if (!supportedCopy.has(objective.type)) {
      errors.push(`${stage.id} objective '${objective.type}' has no player-facing description mapped to its runtime rule.`);
    }
  }

  const targetIds = Array.isArray(objective.targetIds) ? objective.targetIds : [];
  if (["defeat-all", "survive"].includes(objective.type)) {
    if (targetIds.length > 0) errors.push(`${stage.id} ${objective.type} must not promise unused targetIds.`);
    if (objective.requiredCount !== undefined) errors.push(`${stage.id} ${objective.type} must not declare an unused requiredCount.`);
  }
  if (objective.type === "defeat-all" && (!Array.isArray(stage.enemies) || stage.enemies.length === 0)) {
    errors.push(`${stage.id} defeat-all has no enemies, so its player-facing promise would auto-complete.`);
  }
  if (objective.type === "escape") {
    if (targetIds.length !== 1 || (objective.requiredCount ?? 1) !== 1) {
      errors.push(`${stage.id} escape must expose exactly one reachable exit and require it once.`);
    }
  }
  if (objective.type === "break-parts") {
    for (const targetId of targetIds) {
      const spawn = spawnById.get(targetId);
      const part = bossPartById.get(targetId);
      const propCanBreak = spawn?.kind === "prop"
        && ["destructible", "bond"].includes(spawn.interaction?.mode);
      if (!propCanBreak && !(part?.breakable || part?.weakpoint)) {
        errors.push(`${stage.id} break-parts target '${targetId}' has no destructible/bond prop or hittable boss part contract.`);
      }
    }
  }
  if (objective.type === "seal") {
    for (const targetId of targetIds) {
      const spawn = spawnById.get(targetId);
      const part = bossPartById.get(targetId);
      if (spawn?.kind !== "prop" && !part?.weakpoint) {
        errors.push(`${stage.id} seal target '${targetId}' is not a contactable prop or weakpoint.`);
      }
    }
    if ((objective.requiredCount ?? targetIds.length) > objective.turnLimit) {
      errors.push(`${stage.id} seal requires more accepted contacts than its turnLimit permits.`);
    }
  }
  if (objective.type === "assemble") {
    const minimumShots = targetIds
      .map((targetId) => spawnById.get(targetId)?.interaction)
      .filter((interaction) => interaction?.mode === "assembly")
      .map((interaction) => interaction.hitsRequired)
      .sort((left, right) => left - right)
      .slice(0, objective.requiredCount ?? targetIds.length)
      .reduce((sum, hits) => sum + hits, 0);
    if (minimumShots > objective.turnLimit) {
      errors.push(`${stage.id} assembly needs at least ${minimumShots} shots but allows only ${objective.turnLimit} turns.`);
    }
  }

  const partySizes = options.partySizes ?? [];
  if (stage.modifiers?.includes("three-color-seal")) {
    for (const partySize of partySizes) {
      if (partySize < 3) errors.push(`${stage.id} cannot satisfy three-color-seal with a ${partySize}-hero party.`);
    }
  }
  const partySpawn = stage.spawns?.find((spawn) => spawn.kind === "party");
  if (partySpawn) {
    for (const partySize of partySizes) {
      if (!isPositiveInteger(partySize)) {
        errors.push(`${stage.id} party-size simulation received invalid size '${partySize}'.`);
        continue;
      }
      const spacing = partySpawn.radius * 2 + 12;
      const left = partySpawn.x - ((partySize - 1) / 2) * spacing - partySpawn.radius;
      const right = partySpawn.x + ((partySize - 1) / 2) * spacing + partySpawn.radius;
      if (left < 0 || right > stage.arena.width) {
        errors.push(`${stage.id} ${partySize}-hero party spawn extends outside the arena.`);
      }
    }
  }
}

/**
 * Validate the declarative parts of a stage that the deterministic runtime
 * consumes. `assetExists` is injected so GameKit/UGC tools can validate either
 * a local public folder or a virtual asset catalog.
 */
export function validateStageContract(stage, options = {}) {
  const errors = [];
  const assetExists = options.assetExists ?? (() => true);
  const commercialStrict = options.commercialStrict === true;
  const waivedGates = commercialStrict
    ? validateCommercialWaivers(options.commercialWaivers, errors)
    : new Set();
  const arena = stage?.arena;
  const spawns = Array.isArray(stage?.spawns) ? stage.spawns : [];
  const walls = Array.isArray(stage?.walls) ? stage.walls : [];
  const hazards = Array.isArray(stage?.hazards) ? stage.hazards : [];
  const objective = stage?.objective;

  if (!arena || !isFiniteNumber(arena.width) || !isFiniteNumber(arena.height)) return errors;

  if (arena.backgroundAssetUrl !== undefined) {
    if (!isSafeAssetUrl(arena.backgroundAssetUrl)) {
      errors.push(`${stage.id} backgroundAssetUrl must be a safe public PNG asset path.`);
    } else if (!assetExists(arena.backgroundAssetUrl)) {
      errors.push(`${stage.id} background asset is missing: ${arena.backgroundAssetUrl}`);
    }
  } else if (commercialStrict && !waivedGates.has("backgroundAssetUrl")) {
    errors.push(`${stage.id} commercial art gate requires arena.backgroundAssetUrl or an explicit waiver.`);
  }

  const spawnById = new Map(spawns.filter((spawn) => typeof spawn?.id === "string").map((spawn) => [spawn.id, spawn]));
  const bossPartById = new Map((stage.boss?.parts ?? []).map((part) => [part.id, part]));
  for (const spawn of spawns) {
    if (spawn.presentation && spawn.kind !== "prop") {
      errors.push(`${stage.id} spawn ${spawn.id} presentation is ignored unless kind is 'prop'.`);
    }
    if (spawn.kind === "prop") {
      validatePresentation(spawn.presentation, `${stage.id} prop ${spawn.id}`, "props", assetExists, errors);
      if (commercialStrict && !spawn.presentation && !waivedGates.has("prop-presentation")) {
        errors.push(`${stage.id} prop ${spawn.id} requires presentation art or an explicit waiver.`);
      }
    }
    if (spawn.interaction && spawn.kind !== "prop") {
      errors.push(`${stage.id} spawn ${spawn.id} interaction is only valid for prop spawns.`);
    }
    if (spawn.interaction?.mode === "destructible" || spawn.interaction?.mode === "bond") {
      if (!isFiniteNumber(spawn.interaction.maxHp) || spawn.interaction.maxHp <= 0) {
        errors.push(`${stage.id} prop ${spawn.id} ${spawn.interaction.mode} maxHp must be a positive number.`);
      }
    } else if (spawn.interaction && spawn.interaction.mode !== "assembly") {
      errors.push(`${stage.id} prop ${spawn.id} has unsupported interaction mode '${spawn.interaction.mode}'.`);
    }
  }
  for (const wall of walls) {
    if (!isFiniteNumber(wall.x) || !isFiniteNumber(wall.y)) {
      errors.push(`${stage.id} wall ${wall.id} must declare finite x/y coordinates.`);
    }
    if (wall.shape === "circle" || wall.shape === "capsule") {
      if (!isFiniteNumber(wall.radius) || wall.radius <= 0) {
        errors.push(`${stage.id} wall ${wall.id} ${wall.shape} radius must be a positive number.`);
      }
    }
    if (wall.shape === "capsule" || wall.shape === "segment") {
      if (!isFiniteNumber(wall.x2) || !isFiniteNumber(wall.y2)) {
        errors.push(`${stage.id} wall ${wall.id} ${wall.shape} must declare finite x2/y2 coordinates.`);
      }
    }
    validatePresentation(wall.presentation, `${stage.id} wall ${wall.id}`, "walls", assetExists, errors);
    if (commercialStrict && wall.presentation && wall.shape === "segment") {
      errors.push(`${stage.id} wall ${wall.id} has visible thickness but uses a zero-thickness segment collider; use a capsule so art and collision agree.`);
    }
    if (commercialStrict && !wall.presentation && !waivedGates.has("wall-presentation")) {
      errors.push(`${stage.id} wall ${wall.id} requires presentation art or an explicit waiver.`);
    }
  }

  if (commercialStrict) {
    const isModifierSupported = options.isModifierSupported;
    for (const modifier of Array.isArray(stage?.modifiers) ? stage.modifiers : []) {
      if (typeof isModifierSupported !== "function" || !isModifierSupported(modifier)) {
        errors.push(`${stage.id} exposes unsupported player-visible effect '${modifier}'.`);
      }
    }
  }

  if (objective && Array.isArray(objective.targetIds)) {
    const targetIds = objective.targetIds;
    if (new Set(targetIds).size !== targetIds.length) {
      errors.push(`${stage.id} objective targetIds must be unique.`);
    }
    if (objective.type !== "defeat-all" && objective.type !== "survive" && targetIds.length === 0) {
      errors.push(`${stage.id} ${objective.type} objective must declare at least one targetId.`);
    }
    if (objective.requiredCount !== undefined && !isPositiveInteger(objective.requiredCount)) {
      errors.push(`${stage.id} objective requiredCount must be a positive integer.`);
    }

    let resolvedTargetCount = 0;
    for (const targetId of targetIds) {
      const spawn = spawnById.get(targetId);
      const bossPart = bossPartById.get(targetId);
      if (targetId === "party") {
        const partySpawnExists = spawns.some((candidate) => candidate.kind === "party");
        if (!partySpawnExists) errors.push(`${stage.id} objective target 'party' has no party spawn.`);
        else resolvedTargetCount += 1;
      } else if (spawn?.kind === "prop") {
        resolvedTargetCount += 1;
      } else if (bossPart) {
        const count = Number(bossPart.count);
        if (!isPositiveInteger(count)) errors.push(`${stage.id} boss part ${targetId} has invalid count.`);
        else resolvedTargetCount += count;
      } else if (objective.type === "escape") {
        // Escape exits may be synthesized by the runtime from their authored id.
        resolvedTargetCount += 1;
      } else {
        errors.push(`${stage.id} objective target '${targetId}' does not resolve to a prop, boss part, or party.`);
      }

      if (objective.type === "assemble") {
        if (spawn) validateAssemblyTarget(stage, spawn, errors);
        else errors.push(`${stage.id} assemble target ${targetId} must resolve to a prop spawn.`);
      }
    }

    const countBoundObjectives = new Set(["break-parts", "assemble", "protect"]);
    const required = objective.requiredCount ?? resolvedTargetCount;
    if (countBoundObjectives.has(objective.type) && required > resolvedTargetCount) {
      errors.push(`${stage.id} objective requires ${required} targets but only ${resolvedTargetCount} resolve.`);
    }
    if (objective.type === "assemble") {
      for (const spawn of spawns.filter((candidate) => candidate.interaction?.mode === "assembly")) {
        if (!targetIds.includes(spawn.id)) errors.push(`${stage.id} assembly prop ${spawn.id} is not listed in objective.targetIds.`);
      }
    }
  }

  validateObjectiveRuntimeConsistency(stage, spawnById, bossPartById, options, errors);
  validateSolidCircleObjectiveEnclosure(stage, spawnById, bossPartById, errors);

  for (const hazard of hazards) {
    if (hazard.type === "wave-front") validateWaveFront(stage, hazard, errors);
    if (hazard.type === "sound-wave") validateSoundWave(stage, hazard, errors);
  }
  return errors;
}
