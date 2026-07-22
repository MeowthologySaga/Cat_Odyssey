import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [
    {
      name: "write-standalone-index",
      closeBundle() {
        // Keep the source/test catalog local; the runtime does not request it.
        rmSync(path.join(projectRoot, "standalone", "assets", "audio", "catalog.json"), { force: true });
        writeFileSync(
          path.join(projectRoot, "standalone", "index.html"),
          readFileSync(path.join(projectRoot, "standalone-src", "index.html")),
        );
      },
    },
  ],
  build: {
    outDir: "standalone",
    emptyOutDir: true,
    copyPublicDir: true,
    sourcemap: false,
    target: "es2020",
    cssCodeSplit: false,
    lib: {
      entry: "src/main.ts",
      name: "CatOdysseyStandalone",
      formats: ["iife"],
      fileName: () => "game.js",
      cssFileName: "game",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
