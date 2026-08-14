import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["{app,src,tests}/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/*.integration.test.{ts,tsx}", "tests/e2e/**"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
