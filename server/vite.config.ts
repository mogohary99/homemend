import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";
const here = import.meta.dirname;

// Builds the MCP App view (served to hosts via resources/read as a single self-contained HTML file).
export default defineConfig({
  root: resolve(here, "ui"),
  plugins: [viteSingleFile()],
  build: {
    outDir: resolve(here, "dist-ui"),
    emptyOutDir: true,
    rollupOptions: { input: resolve(here, "ui/view.html") },
    minify: true,
  },
});
