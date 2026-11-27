import {
  createDicomRuntime,
  type DicomRuntimeOptions,
} from '@/src/dicom/core/runtime/createDicomRuntime';
import { fromBlob, fromUrl } from '@/src/dicom/core/source/byteSource';

const runtimes: Array<{ dispose: () => void }> = [];

export const createRuntime = (options: DicomRuntimeOptions = {}) => {
  const runtime = createDicomRuntime(options);
  runtimes.push(runtime);
  return runtime;
};

export const runtime = createRuntime();

/** Pages never cancel; disposing the runtime stops everything on pagehide. */
export const never = new AbortController().signal;

export const sourceOf = (input: URL | File) =>
  input instanceof File
    ? fromBlob(input)
    : fromUrl(input, { fetch: runtime.fetch });

export function report(name: string, value: string) {
  const output = document.createElement('output');
  output.id = name;
  output.textContent = value;
  document.querySelector('main')!.append(output);
}

export function failed(error: unknown) {
  report('error', error instanceof Error ? error.message : String(error));
}

window.addEventListener(
  'pagehide',
  () => runtimes.forEach((owned) => owned.dispose()),
  { once: true }
);
