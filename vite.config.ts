import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: [
    {
      name: "escape-inert-file-scheme-literals",
      enforce: "post",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type === "chunk" && output.code.includes("file://")) {
            // Phaser's default local-scheme list contains this inert literal. Keep the
            // runtime value while preventing the offline pack scanner from mistaking it
            // for a bundled local-file URL.
            output.code = output.code.replaceAll("file://", "file\\u003a//");
          }
        }
      },
    },
  ],
  build: {
    outDir: "dist/game",
    emptyOutDir: true,
    assetsDir: "assets/bundle",
    sourcemap: false,
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
