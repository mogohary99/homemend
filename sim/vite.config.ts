import { defineConfig } from "vite";
// Relative base so the same build works at /sim/ on the HomeMend server and on GitHub Pages.
export default defineConfig({ base: "./", build: { outDir: "dist", emptyOutDir: true, target: "es2022" }, server: { port: 5173, strictPort: true } });
