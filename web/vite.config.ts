import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // the devignerui components import these; local stand-ins live in src/lib
    alias: {
      cn: src("lib/cn.ts"),
      "devignerui/hooks": src("lib/hooks.ts"),
      "devignerui/motion": src("lib/motion.ts"),
    },
  },
});
