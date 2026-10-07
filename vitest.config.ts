import { defineConfig } from 'vitest/config'

// Node-side runner: the pure domain layer and repo-level tests only.
// services/ and ui/ are tested with `claude plugin test plugin` (PLAN §9).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['plugin/hooks/domain/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 95, branches: 95 },
    },
  },
})
