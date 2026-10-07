import { defineConfig } from 'vitest/config'

// Node-side runner: the pure domain layer, services over fake ports (C2), and
// repo-level tests. Wiring, dispatch rules and ui/ on surfaces are tested with
// `claude plugin test plugin` (PLAN §9).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['plugin/hooks/domain/**/*.ts', 'plugin/hooks/services/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 95, branches: 95 },
    },
  },
})
