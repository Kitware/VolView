import {
  emptyRegistry,
  registerInstances,
} from '@/src/dicom/core/collections/instanceRegistry';
import { singleDecoderTable } from '@/src/dicom/core/pixels/decoderTable';
import {
  wholeInstanceDecoder,
  type WholeInstanceDecode,
} from '@/src/dicom/core/pixels/pixelDecoder';
import type { Instance } from '@/src/dicom/core/instance/readInstance';

/** The first collection planned from these members. */
export const plannedUpdate = (members: Instance[]) =>
  registerInstances(emptyRegistry, members).updates[0];

/** Runtime options that send every instance whole to `decode`. */
export const decodingWith = (decode: WholeInstanceDecode) => ({
  decoders: () =>
    singleDecoderTable(wholeInstanceDecoder('Test decoder', decode)),
});
