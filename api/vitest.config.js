import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files share in-memory state (db.js), so run them sequentially
    // to avoid race conditions between parallel workers.
    fileParallelism: false,
  },
});
