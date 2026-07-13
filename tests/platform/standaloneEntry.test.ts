// @ts-nocheck -- This test reads project entry files through Node APIs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const standaloneHtml = readFileSync(
  new URL("../../standalone-src/index.html", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

describe("double-click standalone entry", () => {
  it("redirects file launches before the Vite development module is evaluated", () => {
    const redirectPosition = rootHtml.indexOf('window.location.protocol === "file:"');
    const modulePosition = rootHtml.indexOf('type="module"');

    expect(redirectPosition).toBeGreaterThan(-1);
    expect(modulePosition).toBeGreaterThan(redirectPosition);
    expect(rootHtml).toContain("./standalone/index.html");
  });

  it("loads the standalone bundle as classic scripts with relative paths", () => {
    expect(standaloneHtml).toContain('href="./game.css"');
    expect(standaloneHtml).toContain('src="./game.js"');
    expect(standaloneHtml).not.toContain('type="module"');
    expect(standaloneHtml).not.toMatch(/(?:src|href)="\//);
  });

  it("regenerates the standalone build as part of the normal build", () => {
    expect(packageJson.scripts.build).toContain("npm run build:standalone");
    expect(packageJson.scripts["build:standalone"]).toContain(
      "vite.standalone.config.mjs",
    );
  });
});
