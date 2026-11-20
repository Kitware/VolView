import { readInstance, type Instance } from '../../instance/readInstance';
import { fromBlob } from '../../source/byteSource';
import {
  nativePixelDicom,
  type NativePixelOptions,
} from '@/tests/nativePixelDicom';

/** An instance read from a synthesized file, as the runtime would read it. */
export async function pixelInstance(options: NativePixelOptions = {}) {
  const bytes = nativePixelDicom(options);
  const instance = await readInstance(
    fromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>])),
    new AbortController().signal
  );
  return { bytes, instance };
}

/** The same instance with one numeric header value replaced. */
export const withNumber = (
  instance: Instance,
  tag: string,
  value: number
): Instance => ({
  ...instance,
  dataset: {
    ...instance.dataset,
    elements: instance.dataset.elements.map((element) =>
      element.tag === tag
        ? { ...element, values: { kind: 'number', values: [value] } }
        : element
    ),
  },
});
