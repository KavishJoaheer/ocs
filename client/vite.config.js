import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { env } from "node:process";
import { execSync } from "node:child_process";

function resolveClientBuildSha() {
  const fromEnv = String(env.GIT_SHA || env.VITE_GIT_SHA || env.GITHUB_SHA || "").trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  define: {
    __OCS_CLIENT_BUILD_SHA__: JSON.stringify(resolveClientBuildSha()),
  },
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
        globPatterns: ["**/*.{js,css,html,png,webp,svg,woff2,webmanifest}"],
      },
      integration: {
        configureCustomSWViteBuild(viteConfig) {
          viteConfig.build = {
            ...viteConfig.build,
            codeSplitting: false,
          };
          const output = viteConfig.build?.rollupOptions?.output;
          if (output && !Array.isArray(output)) {
            delete output.inlineDynamicImports;
          }
        },
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
      "/api": env.VITE_PREVIEW_API || "http://127.0.0.1:3001",
    },
  },
});
