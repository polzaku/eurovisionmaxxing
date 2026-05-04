import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig has `"jsx": "preserve"` for Next.js, which leaves JSX
  // untransformed. Tell vitest's esbuild to use the automatic runtime
  // so React JSX in test files compiles without an explicit React import.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    // Default env stays node — fast, what 90% of tests need.
    // Component tests opt into jsdom per-file via the
    // `// @vitest-environment jsdom` pragma at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
