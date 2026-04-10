import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import type { UserConfig } from 'vite';
import { defineConfig, loadEnv } from 'vite';

/** Shared Vite options; `mode` selects `.env`, `.env.[mode]`, etc. */
export function createViteConfig(mode: string): UserConfig {
  const env = loadEnv(mode, process.cwd(), '');
  const essentiaApiKey = (env.VITE_ESSENTIA_API_KEY ?? env.ESSENTIA_API_KEY ?? '').trim();

  return {
    envPrefix: ['VITE_', 'ESSENTIA_'],
    // Ensure either env name works: client injection for ESSENTIA_* is unreliable across tooling.
    define: {
      'import.meta.env.VITE_ESSENTIA_API_KEY': JSON.stringify(essentiaApiKey)
    },
    plugins: [tailwindcss(), sveltekit()]
  };
}

export default defineConfig(({ mode }) => createViteConfig(mode));
