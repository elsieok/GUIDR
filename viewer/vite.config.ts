/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The viewer calls /api/...; the dev server forwards it to FastAPI and strips the /api prefix,
    // so the browser sees a single origin and no CORS setup is needed in development.
    proxy: { "/api": { target: "http://127.0.0.1:8000", rewrite: (path) => path.replace(/^\/api/, "") } },
  },
  test: { environment: "node" },
});
