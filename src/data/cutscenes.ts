import { INTEGRATED_CUTSCENE_EPISODES } from "./generatedCutsceneMedia";

export type CutsceneTrigger =
  | { readonly kind: "stage"; readonly stageId: string; readonly timing: "before" | "after" }
  | { readonly kind: "route"; readonly routeId: string; readonly timing: "postlude" };

export type CutsceneStatus = "ready" | "missing";

export interface CutsceneDefinition {
  readonly id: string;
  readonly episode: number;
  readonly routeId: string;
  readonly trigger: CutsceneTrigger;
  readonly title: string;
  /** Automatic playback requires enabled=true, status=ready, and a non-null source. */
  readonly enabled: boolean;
  readonly status: CutsceneStatus;
  /** Relative to the packaged game root. Episodes are kept as full MP4 files. */
  readonly source: `assets/video/cutscenes/${string}.mp4` | null;
  /** Null means the runtime reads the full episode duration from video metadata. */
  readonly durationSeconds: number | null;
  readonly nextScene: string;
  readonly nextData?: Readonly<Record<string, unknown>>;
}

/**
 * Canon story beat that uses the existing Story scene instead of a video.
 * These keep campaign causality complete when no licensed episode file exists.
 */
export type StoryInterludeTrigger =
  | { readonly kind: "stage"; readonly stageId: string; readonly timing: "before" | "after" }
  | { readonly kind: "route"; readonly routeId: string; readonly timing: "prelude" };

export interface StoryInterludeDefinition {
  readonly id: string;
  readonly routeId: string;
  readonly trigger: StoryInterludeTrigger;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: readonly string[];
  readonly accent: number;
}

const episode = (
  episodeNumber: number,
  routeId: string,
  trigger: CutsceneTrigger,
  title: string,
  nextScene: string,
  nextData: Readonly<Record<string, unknown>>,
  ready = false,
): CutsceneDefinition => ({
  id: `cat-odyssey-ep${String(episodeNumber).padStart(2, "0")}`,
  episode: episodeNumber,
  routeId,
  trigger,
  title,
  enabled: ready,
  status: ready ? "ready" : "missing",
  source: ready ? `assets/video/cutscenes/ep${episodeNumber}.mp4` : null,
  durationSeconds: null,
  nextScene,
  nextData,
});

const integratedEpisode = (
  episodeNumber: number,
  routeId: string,
  trigger: CutsceneTrigger,
  title: string,
  nextScene: string,
  nextData: Readonly<Record<string, unknown>>,
): CutsceneDefinition => episode(
  episodeNumber,
  routeId,
  trigger,
  title,
  nextScene,
  nextData,
  INTEGRATED_CUTSCENE_EPISODES.includes(episodeNumber),
);

/**
 * CatTube Cat Odyssey canon, using the user's authoritative untrimmed full
 * episodes. EP1–11 are active source slots. EP12–20 are always present as
 * canonical metadata slots and become active only after the integration script
 * has copied a completed MP4 into the packaged public assets. Every active slot
 * is still metadata-probed
 * before automatic playback so a damaged local copy never blocks progression.
 */
export const CUTSCENE_MANIFEST: readonly CutsceneDefinition[] = Object.freeze([
  episode(1, "route-01-ogygia", { kind: "stage", stageId: "r01-s01", timing: "before" }, "캣-립소의 섬", "Party", { stageId: "r01-s01", cutsceneChecked: true }, true),
  episode(2, "route-01-ogygia", { kind: "stage", stageId: "r01-s04", timing: "before" }, "뗏목 출항", "Party", { stageId: "r01-s04", cutsceneChecked: true }, true),
  episode(3, "route-01-ogygia", { kind: "route", routeId: "route-01-ogygia", timing: "postlude" }, "나우시-캣과의 만남", "Route", { routeId: "route-02-lotus" }, true),
  episode(4, "route-02-lotus", { kind: "stage", stageId: "r02-s04", timing: "after" }, "로토스 먹는 자들의 섬", "Route", { routeId: "route-03-cyclops" }, true),
  episode(5, "route-03-cyclops", { kind: "stage", stageId: "r03-s01", timing: "before" }, "폴리-머오무스의 동굴", "Party", { stageId: "r03-s01", cutsceneChecked: true }, true),
  episode(6, "route-03-cyclops", { kind: "stage", stageId: "r03-s05", timing: "after" }, "‘아무도 아니다’의 책략", "Route", { routeId: "route-04-aeolus" }, true),
  episode(7, "route-03-cyclops", { kind: "route", routeId: "route-03-cyclops", timing: "postlude" }, "탈출과 오만한 실수", "Route", { routeId: "route-04-aeolus" }, true),
  episode(8, "route-04-aeolus", { kind: "stage", stageId: "r04-s04", timing: "after" }, "아이올로스의 바람 주머니", "Route", { routeId: "route-05-circe" }, true),
  episode(9, "route-05-circe", { kind: "stage", stageId: "r05-s04", timing: "after" }, "퍼-씨의 마법", "Route", { routeId: "route-06-underworld" }, true),
  episode(10, "route-05-circe", { kind: "route", routeId: "route-05-circe", timing: "postlude" }, "1년간의 체류", "Route", { routeId: "route-06-underworld" }, true),
  episode(11, "route-06-underworld", { kind: "stage", stageId: "r06-s04", timing: "after" }, "저승 방문", "Route", { routeId: "route-07-sirens" }, true),
  integratedEpisode(12, "route-07-sirens", { kind: "stage", stageId: "r07-s04", timing: "after" }, "사이렌의 노래", "Route", { routeId: "route-08-strait" }),
  integratedEpisode(13, "route-08-strait", { kind: "stage", stageId: "r08-s05", timing: "after" }, "스킬라와 카리브디스", "Route", { routeId: "route-09-thrinacia" }),
  integratedEpisode(14, "route-09-thrinacia", { kind: "stage", stageId: "r09-s04", timing: "after" }, "태양신의 소", "Route", { routeId: "route-10-ithaca" }),
  integratedEpisode(15, "route-10-ithaca", { kind: "stage", stageId: "r10-s01", timing: "before" }, "이타-캣의 숨겨진 집", "Party", { stageId: "r10-s01", cutsceneChecked: true }),
  integratedEpisode(16, "route-10-ithaca", { kind: "stage", stageId: "r10-s01", timing: "after" }, "아버지와 아들의 재회", "Route", { routeId: "route-10-ithaca" }),
  integratedEpisode(17, "route-10-ithaca", { kind: "stage", stageId: "r10-s02", timing: "before" }, "오랜 친구 아르고스", "Party", { stageId: "r10-s02", cutsceneChecked: true }),
  integratedEpisode(18, "route-10-ithaca", { kind: "stage", stageId: "r10-s02", timing: "after" }, "구혼자들의 모욕", "Route", { routeId: "route-10-ithaca" }),
  integratedEpisode(19, "route-10-ithaca", { kind: "stage", stageId: "r10-s03", timing: "after" }, "활의 시험", "Route", { routeId: "route-10-ithaca" }),
  integratedEpisode(20, "route-10-ithaca", { kind: "stage", stageId: "r10-s05", timing: "after" }, "집이 그를 알아보다", "Harbor", {}),
]);

export const CUTSCENE_BY_ID: Readonly<Record<string, CutsceneDefinition>> = Object.freeze(
  Object.fromEntries(CUTSCENE_MANIFEST.map((cutscene) => [cutscene.id, cutscene])),
);

/**
 * Post-EP11 bridge cards. Route preludes are already displayed by RouteScene;
 * stage triggers are a data-complete hook for RewardScene/PartyScene to call
 * without fabricating or requiring a video asset.
 */
export const STORY_INTERLUDE_MANIFEST: readonly StoryInterludeDefinition[] = Object.freeze([
  {
    id: "interlude-route07-circe-warning",
    routeId: "route-07-sirens",
    trigger: { kind: "route", routeId: "route-07-sirens", timing: "prelude" },
    eyebrow: "항로 07 · 예언 뒤의 항해",
    title: "노래 앞의 맹세",
    body: [
      "저승에서 돌아온 먀디세우스는 퍼-씨의 섬에서 예언과 앞으로의 위험을 다시 확인했다.",
      "선원들은 밀랍으로 귀를 막고, 선장은 노래를 듣되 돛대의 밧줄을 풀지 말라고 명했다.",
    ],
    accent: 0x6eb7d2,
  },
  {
    id: "interlude-route08-narrow-choice",
    routeId: "route-08-strait",
    trigger: { kind: "route", routeId: "route-08-strait", timing: "prelude" },
    eyebrow: "항로 08 · 노래가 멎은 뒤",
    title: "두 재앙 사이의 길",
    body: [
      "사이렌의 노랫결을 벗어난 배 앞에 스킬라와 카리브디스가 지키는 좁은 해협이 나타났다.",
      "모두를 구할 길은 없었다. 먀디세우스는 배 전체를 삼킬 소용돌이를 피해 절벽 쪽 항로를 택했다.",
    ],
    accent: 0x728ba2,
  },
  {
    id: "interlude-route09-taboo-reminder",
    routeId: "route-09-thrinacia",
    trigger: { kind: "route", routeId: "route-09-thrinacia", timing: "prelude" },
    eyebrow: "항로 09 · 해협의 대가",
    title: "태양 목장의 금기",
    body: [
      "해협에서 여섯 동료를 잃은 배는 마침내 헬리-포스의 소들이 사는 트리나키아에 닿았다.",
      "티레시아스의 경고는 분명했다. 아무리 굶주려도 신성한 소만은 건드려서는 안 된다.",
    ],
    accent: 0xe2ac55,
  },
  {
    id: "interlude-r09-wreck-to-ogygia",
    routeId: "route-09-thrinacia",
    trigger: { kind: "stage", stageId: "r09-s04", timing: "after" },
    eyebrow: "회상 막간 · 폭풍 뒤의 세월",
    title: "난파 뒤, 홀로",
    body: [
      "제우-푸스의 번개가 배를 산산이 흩뜨렸고, 먀디세우스만 부서진 돛대에 매달려 살아남았다.",
      "그는 다시 소용돌이를 지나 긴 표류 끝에 오기기아에 닿았고, 그곳에서 일곱 해를 보내게 되었다.",
    ],
    accent: 0x7ea6bd,
  },
  {
    id: "interlude-route10-phaeacia-return",
    routeId: "route-10-ithaca",
    trigger: { kind: "route", routeId: "route-10-ithaca", timing: "prelude" },
    eyebrow: "항로 10 · 회상의 끝",
    title: "파이아키아에서 이타-캣으로",
    body: [
      "트리나키아의 이야기가 끝나자 파이아키아 궁정의 회상도 현재로 돌아왔다.",
      "사람들은 홀로 남은 영웅의 귀향을 도왔고, 배는 잠든 먀디세우스를 마침내 이타-캣 해안에 내려놓았다.",
      "아-포-나는 왕궁을 되찾을 때까지 정체를 숨기라며 그를 늙은 떠돌이 고양이 모습으로 바꾸었다.",
    ],
    accent: 0xd8a94a,
  },
  {
    id: "interlude-r10-beggar-disguise",
    routeId: "route-10-ithaca",
    trigger: { kind: "stage", stageId: "r10-s01", timing: "before" },
    eyebrow: "귀향 막간 · 숨겨진 왕",
    title: "충직한 목자의 오두막",
    body: [
      "변장한 먀디세우스는 먼저 충직한 유-먀오스의 오두막으로 향했다.",
      "왕궁에 들어가기 전, 살아남은 벗과 아들 텔레-묘-쿠스를 찾아 구혼자들의 수를 살펴야 했다.",
    ],
    accent: 0xb4a06f,
  },
  {
    id: "interlude-r10-homecoming-complete",
    routeId: "route-10-ithaca",
    trigger: { kind: "stage", stageId: "r10-s05", timing: "after" },
    eyebrow: "귀향 종장 · 흔들리지 않는 약속",
    title: "마침내, 집으로",
    body: [
      "구혼자들의 오만이 꺾인 뒤에도 퍼-넬로페는 마지막으로 둘만 아는 침상의 비밀을 물었다.",
      "먀디세우스가 변함없는 답을 들려주자 오랜 기다림은 끝났고, 가족은 마침내 서로를 알아보았다.",
    ],
    accent: 0xe4c779,
  },
]);

export const STORY_INTERLUDE_BY_ID: Readonly<Record<string, StoryInterludeDefinition>> = Object.freeze(
  Object.fromEntries(STORY_INTERLUDE_MANIFEST.map((interlude) => [interlude.id, interlude])),
);
