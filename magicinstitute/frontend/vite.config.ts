/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Built into ../web/create (assets under /create/); the FastAPI app serves it as the home page. `npm run dev` runs on :5174 and proxies /api.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/create/" : "/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../web/create", emptyOutDir: true },
  server: { port: 5174, strictPort: true, proxy: { "/api": "http://localhost:8000" } },
  test: { environment: "jsdom", globals: false },
}));
