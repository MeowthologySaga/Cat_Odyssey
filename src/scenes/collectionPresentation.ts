export type CollectionTab = "heroes" | "relics" | "voyage" | "titles";
export const COLLECTION_SCENE_KEY = "Collection" as const;

export const COLLECTION_TABS: readonly {
  readonly id: CollectionTab;
  readonly label: string;
  readonly icon: string;
}[] = Object.freeze([
  { id: "heroes", label: "선원", icon: "♞" },
  { id: "relics", label: "유물", icon: "◆" },
  { id: "voyage", label: "항해", icon: "☷" },
  { id: "titles", label: "칭호", icon: "✦" },
]);

export const COLLECTION_PAGE_SIZES: Readonly<Record<CollectionTab, number>> = Object.freeze({
  heroes: 4,
  relics: 5,
  voyage: 1,
  titles: 4,
});

export const COLLECTION_LAYOUT = Object.freeze({
  topBarBottom: 92,
  tabTop: 124,
  tabBottom: 190,
  summaryY: 213,
  contentTop: 238,
  contentBottom: 1068,
  paginationY: 1124,
  paginationHeight: 54,
  footerY: 1207,
  viewportBottom: 1280,
});

export function collectionPageCount(tab: CollectionTab, itemCount: number): number {
  return Math.max(1, Math.ceil(Math.max(0, itemCount) / COLLECTION_PAGE_SIZES[tab]));
}

export function clampCollectionPage(page: number, pageCount: number): number {
  return Math.min(Math.max(0, Math.floor(page)), Math.max(0, Math.floor(pageCount) - 1));
}

export function collectionPageSlice<T>(tab: CollectionTab, items: readonly T[], page: number): readonly T[] {
  const size = COLLECTION_PAGE_SIZES[tab];
  const safePage = clampCollectionPage(page, collectionPageCount(tab, items.length));
  return items.slice(safePage * size, safePage * size + size);
}

export function starText(stars: number, maximum = 3): string {
  const filled = Math.min(maximum, Math.max(0, Math.floor(stars)));
  return `${"★".repeat(filled)}${"☆".repeat(Math.max(0, maximum - filled))}`;
}
