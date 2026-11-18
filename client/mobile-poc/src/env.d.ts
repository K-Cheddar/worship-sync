/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MOBILE_POC_API_BASE_URL?: string;
  readonly MOBILE_POC_COUCHDB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __CAPACITOR_VERSION__: string;
