import { describe, expect, it } from "vitest";
import {
  capHeroContactDamage,
  resolveHeroImpactFormula,
  RICOCHET_PHYSICS_PROFILES,
} from "../../src/core/battle";

describe("commercial contact damage formula", () => {
  it("keeps low-speed grazing hits readable without rewarding them like a clean strike", () => {
    const graze = resolveHeroImpactFormula({
      ricochetClass: "bounce",
      mass: 1,
      impactSpeed: 25,
      referenceSpeed: 800,
      incidence: 0.12,
      ricochetCount: 0,
      comboCount: 0,
    });
    const clean = resolveHeroImpactFormula({
      ricochetClass: "bounce",
      mass: 1,
      impactSpeed: 800,
      referenceSpeed: 800,
      incidence: 1,
      ricochetCount: 0,
      comboCount: 0,
    });

    expect(graze.grade).toBe("glancing");
    expect(graze.multiplier).toBeGreaterThan(0.4);
    expect(graze.multiplier).toBeLessThan(clean.multiplier);
  });

  it("rewards bank and combo quality conservatively", () => {
    const base = resolveHeroImpactFormula({
      ricochetClass: "burst", mass: 0.8, impactSpeed: 720, referenceSpeed: 720,
      incidence: 0.85, ricochetCount: 0, comboCount: 0,
    });
    const chained = resolveHeroImpactFormula({
      ricochetClass: "burst", mass: 0.8, impactSpeed: 720, referenceSpeed: 720,
      incidence: 0.85, ricochetCount: 14, comboCount: 30,
    });

    expect(chained.multiplier).toBeGreaterThan(base.multiplier);
    expect(chained.multiplier / base.multiplier).toBeLessThan(1.5);
  });

  it("caps a single normal, elite and boss contact at distinct durability ratios", () => {
    expect(capHeroContactDamage({ rawDamage: 9999, targetMaxHp: 1000, target: "enemy" })).toMatchObject({ damage: 780, capped: true });
    expect(capHeroContactDamage({ rawDamage: 9999, targetMaxHp: 1000, target: "enemy", elite: true })).toMatchObject({ damage: 480, capped: true });
    expect(capHeroContactDamage({ rawDamage: 9999, targetMaxHp: 1000, target: "enemy", boss: true })).toMatchObject({ damage: 220, capped: true });
  });

  it("gives every ricochet role a distinct handling identity", () => {
    const profiles = Object.values(RICOCHET_PHYSICS_PROFILES);
    expect(new Set(profiles.map((profile) => profile.label)).size).toBe(5);
    expect(RICOCHET_PHYSICS_PROFILES.heavy.launchSpeedMultiplier).toBeLessThan(RICOCHET_PHYSICS_PROFILES.pierce.launchSpeedMultiplier);
    expect(RICOCHET_PHYSICS_PROFILES.burst.frictionMultiplier).toBeGreaterThan(RICOCHET_PHYSICS_PROFILES.heavy.frictionMultiplier);
    expect(RICOCHET_PHYSICS_PROFILES.support.impactMultiplier).toBeLessThan(RICOCHET_PHYSICS_PROFILES.heavy.impactMultiplier);
  });
});
