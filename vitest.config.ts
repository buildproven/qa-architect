import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/accessibility.test.js',
      'tests/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.{ts,tsx}'],
      thresholds: {
        lines: 50,
        branches: 40,
        functions: 40,
        statements: 50,
      },
    },
  },
})
