export interface ManualClearAuditCandidate {
  readonly stageId: string;
  readonly partySize: 1 | 2 | 3;
  readonly objectiveType: "escape" | "break-parts" | "survive" | "protect";
  readonly requiredScriptFocus: readonly string[];
  readonly proof?: {
    readonly heroIds: readonly string[];
    readonly aimAnglesRadians: readonly number[];
    readonly aimPowers?: readonly number[];
    readonly expectedReason: "escaped" | "protected" | "survived" | "targetsCompleted";
  };
}

// Preserve the exact operation order used by the deterministic 48-angle
// search. Algebraically equivalent PI fractions can diverge after many bounces
// because their final IEEE-754 bits differ.
const aimGrid48 = (index: number): number => -Math.PI + index * Math.PI * 2 / 48;
const aimGrid72 = (index: number): number => -Math.PI + index * Math.PI * 2 / 72;

/**
 * A bounded greedy trajectory probe did not clear these combinations. That is
 * a review signal, not proof that the authored stage is impossible. Each case
 * remains explicit until a mechanic-aware deterministic script or a recorded
 * manual clear replaces the todo contract.
 */
export const MANUAL_CLEAR_AUDIT_CANDIDATES: readonly ManualClearAuditCandidate[] = Object.freeze([
  {
    stageId: "r03-s03",
    partySize: 1,
    objectiveType: "escape",
    requiredScriptFocus: ["brute stagger", "rear route opening", "exit contact"],
    proof: {
      heroIds: ["meow-dysseus"],
      aimAnglesRadians: [19, 32, 35].map(aimGrid48),
      expectedReason: "escaped",
    },
  },
  {
    stageId: "r07-s04",
    partySize: 1,
    objectiveType: "break-parts",
    requiredScriptFocus: ["mast channel", "white-gray-blue durability order", "completed verse persistence"],
    proof: {
      heroIds: ["meow-dysseus"],
      aimAnglesRadians: [45, 47, 1, 7].map(aimGrid72),
      aimPowers: [0.8, 0.8, 0.8, 0.8],
      expectedReason: "targetsCompleted",
    },
  },
  {
    stageId: "r07-s04",
    partySize: 2,
    objectiveType: "break-parts",
    requiredScriptFocus: ["mast channel", "white-gray-blue durability order", "completed verse persistence"],
    proof: {
      heroIds: ["meow-dysseus", "a-paw-na"],
      aimAnglesRadians: [32, 17, 71, 1].map(aimGrid72),
      aimPowers: [1, 0.8, 1, 0.8],
      expectedReason: "targetsCompleted",
    },
  },
  {
    stageId: "r07-s04",
    partySize: 3,
    objectiveType: "break-parts",
    requiredScriptFocus: ["mast channel", "white-gray-blue durability order", "completed verse persistence"],
    proof: {
      heroIds: ["meow-dysseus", "a-paw-na", "tele-meow-chus"],
      aimAnglesRadians: [3, 2, 69, 1, 11].map(aimGrid72),
      aimPowers: [1, 1, 0.8, 1, 0.8],
      expectedReason: "targetsCompleted",
    },
  },
  {
    stageId: "r08-s04",
    partySize: 1,
    objectiveType: "survive",
    requiredScriptFocus: ["anchor hits", "suction reduction", "ten-turn survival"],
    proof: {
      heroIds: ["orange-sailor"],
      aimAnglesRadians: [20, 9, 28, 30, 45, 45, 33, 30, 7, 0].map(aimGrid48),
      expectedReason: "survived",
    },
  },
  {
    stageId: "r09-s03",
    partySize: 1,
    objectiveType: "protect",
    requiredScriptFocus: ["forbidden cattle avoidance", "moving cattle", "protect timer"],
    proof: {
      heroIds: ["meow-dysseus"],
      aimAnglesRadians: [47, 5, 46, 12, 9, 8, 46, 22, 0, 0].map(aimGrid48),
      expectedReason: "protected",
    },
  },
  {
    stageId: "r09-s03",
    partySize: 2,
    objectiveType: "protect",
    requiredScriptFocus: ["forbidden cattle avoidance", "moving cattle", "extra-crew guard", "protect timer"],
    proof: {
      heroIds: ["meow-dysseus", "a-paw-na"],
      aimAnglesRadians: [1, 41, 41, 4, 19, 7, 7, 6, 0, 0].map(aimGrid48),
      expectedReason: "protected",
    },
  },
  {
    stageId: "r09-s03",
    partySize: 3,
    objectiveType: "protect",
    requiredScriptFocus: ["forbidden cattle avoidance", "moving cattle", "extra-crew guard", "protect timer"],
    proof: {
      heroIds: ["meow-dysseus", "a-paw-na", "orange-sailor"],
      aimAnglesRadians: [17, 5, 33, 22, 44, 18, 46, 6, 0, 0].map(aimGrid48),
      expectedReason: "protected",
    },
  },
  {
    stageId: "r09-s04",
    partySize: 1,
    objectiveType: "survive",
    requiredScriptFocus: ["lightning phase telegraph", "eleven-turn survival"],
    proof: {
      heroIds: ["orange-sailor"],
      aimAnglesRadians: [16, 16, 21, 43, 10, 23, 16, 22, 3, 23, 0].map(aimGrid48),
      expectedReason: "survived",
    },
  },
]);
