import { createWebWorker, setDefaultWebWorker } from 'itk-wasm';

let webWorker: Worker | null = null;

export async function initItkWorker() {
  if (webWorker) return;
  webWorker = await createWebWorker(null);
  setDefaultWebWorker(webWorker);
}

export function getWorker() {
  return webWorker;
}
