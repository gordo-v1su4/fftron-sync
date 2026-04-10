import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

export default mergeConfig(
  createViteConfig('test'),
  defineConfig({
    test: {
      include: ['src/**/*.test.ts']
    }
  })
);
