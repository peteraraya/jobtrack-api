import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Middle de la pirámide: app real (AppModule) + Postgres real, sin HTTP.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.integration-spec.ts'],
    setupFiles: ['./test/env.setup.ts'],
    // La DB real se comparte entre integration tests: secuencial y estable.
    fileParallelism: false,
  },
});
