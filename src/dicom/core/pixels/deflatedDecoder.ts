import { readDicomHeader } from '../header/readDicomHeader';
import { inflateDataSet } from '../metadata/dcmjsParser';
import {
  decodeNativeFrames,
  frameFormats,
  nativeCapability,
} from './nativeFrame';
import { frameCount, type PixelDecoder } from './pixelDecoder';

const streamOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

/** The Pixel Data value of an inflated data set, which is Explicit VR Little Endian. */
async function pixelDataValue(dataSet: Uint8Array) {
  const { pixelData } = await readDicomHeader(streamOf(dataSet));
  if (!pixelData || pixelData.length === null)
    throw new Error('The inflated data set holds no native Pixel Data');
  return dataSet.subarray(
    pixelData.valueOffset,
    pixelData.valueOffset + pixelData.length
  );
}

/**
 * Inflates a Deflated Explicit VR Little Endian file whole, on the calling
 * thread, then decodes its frames as native ones. Nothing in a deflated file
 * can be read by range.
 */
export const deflatedDecoder: PixelDecoder = {
  name: 'Deflated',
  plan: (instance, Target) => {
    const capability = nativeCapability(instance, true);
    if (capability.kind === 'declined') return { declined: capability.reason };
    const frames = frameCount(instance.dataset);
    const formats = frameFormats(capability.format, instance.dataset, frames);
    return [
      {
        firstFrame: 0,
        frames,
        range: null,
        decode: async (bytes) =>
          decodeNativeFrames(
            await pixelDataValue(inflateDataSet(bytes)),
            formats,
            Target
          ),
      },
    ];
  },
};
