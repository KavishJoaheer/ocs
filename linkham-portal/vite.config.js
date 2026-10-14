import { env } from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  preview: { host: "127.0.0.1", port: 4175, proxy: { "/api": env.VITE_PREVIEW_API || "http://127.0.0.1:3001" } },
  server: {
    host: "0.0.0.0",
    port: 5175,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});