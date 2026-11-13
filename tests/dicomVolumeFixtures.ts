import {
  emptyRegistry,
  registerInstances,
} from '@/packages/dicom/core/collections/instanceRegistry';
import { singleDecoderTable } from '@/packages/dicom/core/pixels/decoderTable';
import {
  wholeInstanceDecoder,
  type WholeInstanceDecode,
} from '@/packages/dicom/core/pixels/pixelDecoder';
import type { Instance } from '@/packages/dicom/core/instance/readInstance';

/** The first collection planned from these members, which must be an image. */
export const plannedUpdate = (members: Instance[]) => {
  const [update] = registerInstances(emptyRegistry, members).updates;
  if (update.kind !== 'image') throw new Error(`Planned a ${update.kind}`);
  return update;
};

/** Runtime options that send every instance whole to `decode`. */
export const decodingWith = (decode: WholeInstanceDecode) => ({
  decoders: () =>
    singleDecoderTable(wholeInstanceDecoder('Test decoder', decode)),
});
