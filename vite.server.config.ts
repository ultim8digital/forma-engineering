import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  publicDir: false,
  build: {
    target: "node24", outDir: "dist/server", emptyOutDir: true,
    lib: { entry: fileURLToPath(new URL("./server/index.ts", import.meta.url)), formats: ["es"], fileName: () => "index.js" },
    rolldownOptions: { external: [/^node:/, "zod", "vite"] },
  },
});
