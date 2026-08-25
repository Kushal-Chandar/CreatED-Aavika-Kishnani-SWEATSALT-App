import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev-only endpoint the ThemeEditorPanel posts to. `configureServer` only
// runs under `vite dev`/`vite serve`, never during `vite build` — so this
// write path (and the ability to edit theme.json from the browser at all)
// does not exist in the production bundle.
function themeEditorSavePlugin(): Plugin {
  return {
    name: "sweatsalt-theme-editor-save",
    configureServer(server) {
      server.middlewares.use("/__theme/save", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            const themePath = path.resolve(__dirname, "src/theme/theme.json");
            fs.writeFileSync(themePath, JSON.stringify(parsed, null, 2) + "\n");
            res.statusCode = 200;
            res.end("ok");
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: "/CreatED-Aavika-Kishnani-SWEATSALT-App/",
  plugins: [
    react(),
    tailwindcss(),
    themeEditorSavePlugin(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "SweatSalt",
        short_name: "SweatSalt",
        description: "SweatSalt heat-stress wearable companion app",
        theme_color: "#15110c",
        background_color: "#15110c",
        display: "standalone",
        start_url: "/CreatED-Aavika-Kishnani-SWEATSALT-App/",
        scope: "/CreatED-Aavika-Kishnani-SWEATSALT-App/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
  },
});
