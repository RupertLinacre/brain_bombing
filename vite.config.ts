import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5198, strictPort: true },
  build: { target: "es2022" },
});
