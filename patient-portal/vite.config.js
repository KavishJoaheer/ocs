import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectRegister: false,
      includeAssets: ["favicon.png", "ocs-medecins-mark.png", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "OCS Médecins — Patient Portal",
        short_name: "OCS Patient",
        description:
          "Manage your appointments, home visits, billing, and health records with OCS Médecins.",
        theme_color: "#065a60",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5174,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
