import { defineConfig } from 'vitest/config';

// Tests cover the shared lib and Action scripts; they run in plain Node,
// independent of the Vite site root.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
  },
});
