/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DICOM_WEB_URL: string;
  readonly VITE_DICOM_WEB_NAME: string;
  readonly VITE_ENABLE_REMOTE_SAVE: boolean;
  readonly VITE_REMOTE_SERVER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __VERSIONS__: Record<string, string>;
