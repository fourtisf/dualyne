import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    "create-key": "scripts/create-key.ts",
    "resolve-models": "scripts/resolve-models.ts",
    seed: "prisma/seed.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so bundle them into the output.
  noExternal: ["@refract/config", "@refract/shared"],
});
