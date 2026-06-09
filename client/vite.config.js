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
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2,webmanifest}"],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
