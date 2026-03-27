import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    setupFiles: ['./tests/helpers/vitest-setup.js'],
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: 'forks',
    maxWorkers: 1, // jsdom + shared window.VSC globals isn't thread-safe
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'dist/', 'tests/', 'scripts/', '*.config.*'],
    },
  },
});
