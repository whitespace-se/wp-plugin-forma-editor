import { defineConfig } from "vite";

export default defineConfig({
  oxc: { jsx: { runtime: "classic" } },
  build: {
    outDir: "build",
    emptyOutDir: false,
    target: "baseline-widely-available",
    lib: {
      entry: "src/blocks/index.tsx",
      name: "FormaBlocks",
      formats: ["iife"],
      fileName: () => "blocks.js",
      cssFileName: "blocks",
    },
    rolldownOptions: {
      external: ["react", "react-dom", "react-dom/client"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "react-dom/client": "ReactDOM",
        },
      },
    },
  },
});
