export interface SeededRandom {
  /** A deterministic value in [0, 1). */
  next(): number;
  /** A deterministic integer in the inclusive range. */
  integer(min: number, max: number): number;
  /** Select an item without mutating the input. */
  pick<T>(items: readonly T[]): T;
  /** Deterministic in-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): T[];
}

export function hashSeed(seed: number | string): number {
  if (typeof seed === "number") return (Number.isFinite(seed) ? seed : 0) >>> 0;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: number | string): SeededRandom {
  let state = hashSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    integer(min: number, max: number): number {
      const low = Math.ceil(Math.min(min, max));
      const high = Math.floor(Math.max(min, max));
      return low + Math.floor(next() * (high - low + 1));
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("Cannot pick from an empty list.");
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new RangeError("Cannot pick from an empty list.");
      return item;
    },
    shuffle<T>(items: T[]): T[] {
      for (let index = items.length - 1; index > 0; index -= 1) {
        const other = Math.floor(next() * (index + 1));
        const temporary = items[index];
        const replacement = items[other];
        if (temporary === undefined || replacement === undefined) continue;
        items[index] = replacement;
        items[other] = temporary;
      }
      return items;
    },
  };
}

