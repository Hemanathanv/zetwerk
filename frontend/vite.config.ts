import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

function getProxyTarget(env: Record<string, string>): string {
  const explicitBase = env.VITE_BACKEND_API_BASE || env.VITE_API_BASE_URL;
  if (explicitBase) {
    try {
      return new URL(explicitBase).origin;
    } catch {
      // Ignored if explicitBase is a relative URL path (e.g. /api/v1)
    }
  }

  const apiServerPort = Number(
    env.API_SERVER_PORT ??
    env.BACKEND_PORT ??
    env.PARSER_SERVER_PORT ??
    8120
  );
  return `http://127.0.0.1:${apiServerPort}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "");
  const port = Number(env.PORT ?? 5173);
  const basePath = env.BASE_PATH ?? "/";
  const proxyTarget = getProxyTarget(env);

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
