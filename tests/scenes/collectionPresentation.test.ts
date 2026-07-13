import { describe, expect, it } from "vitest";

import {
  clampCollectionPage,
  collectionPageCount,
  collectionPageSlice,
  COLLECTION_LAYOUT,
  COLLECTION_SCENE_KEY,
  COLLECTION_TABS,
  starText,
} from "../../src/scenes/collectionPresentation";

describe("collection scene presentation", () => {
  it("fits all persistent rails inside the 720x1280 canvas", () => {
    expect(COLLECTION_LAYOUT.topBarBottom).toBeLessThan(COLLECTION_LAYOUT.tabTop);
    expect(COLLECTION_LAYOUT.tabBottom).toBeLessThan(COLLECTION_LAYOUT.contentTop);
    expect(COLLECTION_LAYOUT.contentBottom).toBeLessThan(
      COLLECTION_LAYOUT.paginationY - COLLECTION_LAYOUT.paginationHeight / 2,
    );
    expect(COLLECTION_LAYOUT.paginationY + COLLECTION_LAYOUT.paginationHeight / 2).toBeLessThan(COLLECTION_LAYOUT.footerY);
    expect(COLLECTION_LAYOUT.footerY).toBeLessThan(COLLECTION_LAYOUT.viewportBottom);
  });

  it("paginates the promised launch collection without dropping entries", () => {
    expect(COLLECTION_TABS.map((tab) => tab.id)).toEqual(["heroes", "relics", "voyage", "titles"]);
    expect(collectionPageCount("heroes", 16)).toBe(4);
    expect(collectionPageCount("relics", 32)).toBe(7);
    expect(collectionPageCount("voyage", 11)).toBe(11);
    expect(collectionPageCount("titles", 4)).toBe(1);
    const relics = Array.from({ length: 32 }, (_, index) => index);
    expect(Array.from({ length: 7 }, (_, page) => collectionPageSlice("relics", relics, page)).flat()).toEqual(relics);
    expect(clampCollectionPage(-4, 7)).toBe(0);
    expect(clampCollectionPage(99, 7)).toBe(6);
  });

  it("formats stable three-star stage records", () => {
    expect(starText(0)).toBe("☆☆☆");
    expect(starText(2)).toBe("★★☆");
    expect(starText(9)).toBe("★★★");
  });

  it("keeps one stable scene key for Harbor navigation and registration", () => {
    expect(COLLECTION_SCENE_KEY).toBe("Collection");
  });
});
