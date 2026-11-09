import { defineConfig, mergeConfig } from 'vitest/config';
import vite from './vite.config.mts';

export default mergeConfig(
  vite,
  defineConfig({
    test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['src/test-setup.ts'] },
  }),
);
