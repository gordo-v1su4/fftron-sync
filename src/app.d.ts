interface ImportMetaEnv {
  readonly VITE_ESSENTIA_API_BASE_URL?: string;
  readonly VITE_ESSENTIA_API_KEY?: string;
  readonly ESSENTIA_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  namespace App {
    interface Error {}
    interface Locals {}
    interface PageData {}
    interface PageState {}
    interface Platform {}
  }
}

export {};
