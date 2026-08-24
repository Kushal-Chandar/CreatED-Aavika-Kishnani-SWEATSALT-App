import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/sweatsalt-app/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "SweatSalt",
        short_name: "SweatSalt",
        description: "SweatSalt heat-stress wearable companion app",
        theme_color: "#15110c",
        background_color: "#15110c",
        display: "standalone",
        start_url: "/sweatsalt-app/",
        scope: "/sweatsalt-app/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
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
