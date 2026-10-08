import { defineConfig } from 'vitest/config'

// Node-side runner: the pure domain layer, services over fake ports, and
// repo-level tests. Wiring, dispatch rules and ui/ on surfaces are tested with
// `claude plugin test plugin`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['plugin/hooks/domain/**/*.ts', 'plugin/hooks/services/**/*.ts'],
      reporter: ['text', 'json-summary'],
      // The whole and services/ apart, so services' margin shows.
      thresholds: {
        lines: 95,
        branches: 95,
        'plugin/hooks/services/**/*.ts': { lines: 95, branches: 90 },
      },
    },
  },
})
