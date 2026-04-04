/// <reference types="vite/client" />

/** Injected from root `package.json` via `vite.config.ts` `define`. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_CHAT_URL?: string;
  readonly VITE_COGNITO_DOMAIN?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_REGION?: string;
  readonly VITE_COGNITO_SCOPES?: string;
  readonly VITE_DISABLE_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
