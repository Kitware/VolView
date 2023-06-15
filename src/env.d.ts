/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DICOM_WEB_URL: string;
  readonly VITE_DICOM_WEB_NAME: string;
  readonly VITE_ENABLE_REMOTE_SAVE: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
