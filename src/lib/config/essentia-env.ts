/** Client-side Essentia credentials (inlined at dev/build from env files). */
export const getEssentiaClientApiKey = (): string =>
  (import.meta.env.VITE_ESSENTIA_API_KEY ?? import.meta.env.ESSENTIA_API_KEY ?? '').trim();
