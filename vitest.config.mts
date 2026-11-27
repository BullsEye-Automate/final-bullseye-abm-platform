import { defineConfig } from "vitest/config";
import path from "node:path";

// Pruebas unitarias (lógica pura). Por ahora: ACTI (lib/acti/**).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
