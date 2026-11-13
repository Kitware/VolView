import {
  emptyRegistry,
  registerInstances,
  singleDecoderTable,
  wholeInstanceDecoder,
  type Instance,
  type WholeInstanceDecode,
} from '@/packages/dicom/core';

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
