import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    // Unit tests viven junto al fuente que prueban. Los integration live en
    // test/integration (config aparte) y los e2e en test/*.e2e-spec.ts.
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./test/env.setup.ts'],
  },
});
