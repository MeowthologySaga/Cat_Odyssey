import { CUTSCENE_MANIFEST, type CutsceneDefinition, type CutsceneTrigger } from "../data/cutscenes";
import type { GameSaveV1 } from "../state";

const CUTSCENE_SEEN_PREFIX = "__ux:cutscene-seen:";
const availableProbeCache = new Map<string, Promise<boolean>>();

export interface CutsceneDestination {
  readonly sceneKey: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface TriggerResolutionOptions {
  readonly replay?: boolean;
  readonly manifest?: readonly CutsceneDefinition[];
}

export function cutsceneSeenMarker(cutsceneId: string): string {
  return `${CUTSCENE_SEEN_PREFIX}${cutsceneId}`;
}

export function hasSeenCutscene(save: GameSaveV1, cutsceneId: string): boolean {
  return save.inventory.skinIds.includes(cutsceneSeenMarker(cutsceneId));
}

export function markCutsceneSeen(save: GameSaveV1, cutsceneId: string): void {
  const marker = cutsceneSeenMarker(cutsceneId);
  if (!save.inventory.skinIds.includes(marker)) save.inventory.skinIds.push(marker);
}

export function markCutscenesSeen(save: GameSaveV1, cutsceneIds: readonly string[]): void {
  for (const cutsceneId of new Set(cutsceneIds)) markCutsceneSeen(save, cutsceneId);
}

export function resolveTriggeredCutscene(
  save: GameSaveV1,
  trigger: CutsceneTrigger,
  options: TriggerResolutionOptions = {},
): CutsceneDefinition | undefined {
  return resolveTriggeredCutscenes(save, trigger, options)[0];
}

export function resolveTriggeredCutscenes(
  save: GameSaveV1,
  trigger: CutsceneTrigger,
  options: TriggerResolutionOptions = {},
): readonly CutsceneDefinition[] {
  const manifest = options.manifest ?? CUTSCENE_MANIFEST;
  return manifest.filter((cutscene) => (
    cutscene.enabled
    && cutscene.status === "ready"
    && Boolean(cutscene.source)
    && triggerMatches(cutscene.trigger, trigger)
    && (options.replay || !hasSeenCutscene(save, cutscene.id))
  ));
}

export function resolveCutsceneNext(
  cutscene: CutsceneDefinition,
  override: { readonly nextScene?: string; readonly nextData?: Readonly<Record<string, unknown>> } = {},
): CutsceneDestination {
  const sceneKey = override.nextScene ?? cutscene.nextScene;
  const data = override.nextData ?? cutscene.nextData;
  return { sceneKey, ...(data ? { data } : {}) };
}

export function latestSeenCutscene(save: GameSaveV1): CutsceneDefinition | undefined {
  return [...CUTSCENE_MANIFEST].reverse().find((cutscene) => hasSeenCutscene(save, cutscene.id));
}

/**
 * Checks only enough metadata to know an optional MP4 exists and is readable.
 * Missing slots are not marked seen and the illustrated story remains active.
 */
export function probeCutsceneAsset(cutscene: CutsceneDefinition, timeoutMs = 1800): Promise<boolean> {
  if (typeof document === "undefined" || !cutscene.enabled || cutscene.status !== "ready" || !cutscene.source) {
    return Promise.resolve(false);
  }
  const source = cutscene.source;
  const cached = availableProbeCache.get(cutscene.id);
  if (cached) return cached;

  const probe = new Promise<boolean>((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      resolve(available);
    };
    const timeout = globalThis.setTimeout(() => finish(false), Math.max(250, timeoutMs));
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => finish(video.duration > 0 || video.readyState >= 1);
    video.onerror = () => finish(false);
    video.src = source;
    video.load();
  }).then((available) => {
    if (!available) availableProbeCache.delete(cutscene.id);
    return available;
  });
  availableProbeCache.set(cutscene.id, probe);
  return probe;
}

function triggerMatches(authored: CutsceneTrigger, requested: CutsceneTrigger): boolean {
  if (authored.kind !== requested.kind || authored.timing !== requested.timing) return false;
  return authored.kind === "route"
    ? authored.routeId === (requested as Extract<CutsceneTrigger, { kind: "route" }>).routeId
    : authored.stageId === (requested as Extract<CutsceneTrigger, { kind: "stage" }>).stageId;
}
