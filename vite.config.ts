import { defineConfig } from "vite";
import {
  wordpressAssets,
  wordpressExternals,
} from "./tooling/wordpress-assets";

export default defineConfig(({ command, mode }) => {
  if (command === "serve") {
    throw new Error(
      "Use npm run dev: Forma develops against WordPress assets with a watched build, not a Vite server.",
    );
  }

  return {
    plugins: [wordpressAssets()],
    // Classic JSX keeps WordPress's React as the sole runtime in both modes.
    oxc: { jsx: { runtime: "classic" } },
    build: {
      outDir: "build",
      target: "baseline-widely-available",
      sourcemap: mode === "development",
      minify: mode !== "development",
      lib: {
        entry: "src/editor/index.tsx",
        name: "FormaEditor",
        formats: ["iife"],
        fileName: () => "editor.js",
        cssFileName: "editor",
      },
      rolldownOptions: {
        external: Object.keys(wordpressExternals),
        output: {
          globals: Object.fromEntries(
            Object.entries(wordpressExternals).map(([id, value]) => [
              id,
              value.global,
            ]),
          ),
        },
      },
    },
  };
});
