/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Built into ../web/create and served by the FastAPI app at /create/. `npm run dev` runs on :5174 and proxies /api.
export default defineConfig({
  base: "/create/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../web/create", emptyOutDir: true },
  server: { port: 5174, strictPort: true, proxy: { "/api": "http://localhost:8000" } },
  test: { environment: "jsdom", globals: false },
});
