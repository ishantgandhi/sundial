import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Send every /api request to the sundial server, so the page and the API look like one site.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3001" } },
});
