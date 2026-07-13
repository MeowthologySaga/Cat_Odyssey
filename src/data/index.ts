import blessingsData from "./blessings.json";
import endgameData from "./endgame.json";
import enemiesData from "./enemies.json";
import heroesData from "./heroes.json";
import relicsData from "./relics.json";
import routesData from "./routes.json";
import stagesData from "./stages.json";

import type {
  BlessingDefinition,
  EndgameCatalogDefinition,
  EnemyBehaviorDefinition,
  EnemyDefinition,
  HeroDefinition,
  RelicDefinition,
  RouteDefinition,
  StageDefinition,
} from "./types";

export * from "./types";

export const CONTENT_SCHEMA_VERSION = 1 as const;
export const CONTENT_VERSION = "0.1.1" as const;

export const HEROES = heroesData as unknown as readonly HeroDefinition[];
export const ENEMY_BEHAVIORS = enemiesData.behaviors as unknown as readonly EnemyBehaviorDefinition[];
export const ENEMIES = enemiesData.enemies as unknown as readonly EnemyDefinition[];
export const ROUTES = routesData as unknown as readonly RouteDefinition[];
export const STAGES = stagesData as unknown as readonly StageDefinition[];
export const BLESSINGS = blessingsData as unknown as readonly BlessingDefinition[];
export const RELICS = relicsData as unknown as readonly RelicDefinition[];
export const ENDGAME = endgameData as unknown as EndgameCatalogDefinition;

function indexById<T extends { readonly id: string }>(items: readonly T[]): Readonly<Record<string, T>> {
  return Object.freeze(Object.fromEntries(items.map((item) => [item.id, item]))) as Readonly<Record<string, T>>;
}

export const HERO_BY_ID = indexById(HEROES);
export const ENEMY_BEHAVIOR_BY_ID = indexById(ENEMY_BEHAVIORS);
export const ENEMY_BY_ID = indexById(ENEMIES);
export const ROUTE_BY_ID = indexById(ROUTES);
export const STAGE_BY_ID = indexById(STAGES);
export const BLESSING_BY_ID = indexById(BLESSINGS);
export const RELIC_BY_ID = indexById(RELICS);

export const CONTENT_CATALOG = Object.freeze({
  schemaVersion: CONTENT_SCHEMA_VERSION,
  version: CONTENT_VERSION,
  heroes: HEROES,
  enemyBehaviors: ENEMY_BEHAVIORS,
  enemies: ENEMIES,
  routes: ROUTES,
  stages: STAGES,
  blessings: BLESSINGS,
  relics: RELICS,
  endgame: ENDGAME,
});

// Lower-camel aliases keep scene code concise without duplicating catalog data.
export const heroCatalog = HEROES;
export const enemyBehaviorCatalog = ENEMY_BEHAVIORS;
export const enemyCatalog = ENEMIES;
export const routeCatalog = ROUTES;
export const stageCatalog = STAGES;
export const blessingCatalog = BLESSINGS;
export const relicCatalog = RELICS;
export const endgameCatalog = ENDGAME;
