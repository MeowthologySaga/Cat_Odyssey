/**
 * Heroes who permanently join at a story milestone, independently of the
 * stage's single authored first-clear reward.
 *
 * Keep this catalog separate from reward settlement so save compatibility can
 * repair an old completed milestone without importing the reward reducer (and
 * creating a compat <-> rewards dependency cycle).
 */
export const STORY_HERO_UNLOCKS_BY_STAGE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Route 2 is Meow-dysseus' chronological recollection. The two original
  // sailors board first; Nausi-cat, met later in the timeline, follows them.
  "r02-s02": ["orange-sailor", "tuxedo-sailor", "nausi-cat"],
  "r06-s03": ["anticleia-ghost"],
  "r06-s04": ["tiresias"],
  // EP16 (r10-s01 after) is the father-and-son reunion. RewardScene plays the
  // episode before presenting pending crew cards, so Tele-meow-chus appears
  // only after that reveal. Argos joins after r10-s02: EP17 introduces him
  // before the stage, avoiding the old pre-introduction crew card.
  "r10-s01": ["tele-meow-chus"],
  "r10-s02": ["argos"],
  "r10-s05": ["purr-nelope"],
});
