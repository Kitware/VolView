import createOpenJph from '@cornerstonejs/codec-openjph';
import { element } from '../oct/dicom';
import {
  combine,
  elementHeader,
  encapsulatedPixelData,
  part10File,
  rawElement,
} from '../../specs/syntheticDicom';

const HTJ2K_LOSSLESS = '1.2.840.10008.1.2.4.201';
const MULTIFRAME_WORD_SC = '1.2.840.10008.5.1.4.1.1.7.3';
const [columns, rows, frames] = [64, 48, 3];
const bitsStored = 12;

const us = (tag: string, value: number) =>
  rawElement(
    parseInt(tag.slice(0, 4), 16),
    parseInt(tag.slice(4), 16),
    'US',
    new Uint8Array(Uint16Array.of(value).buffer)
  );

/** Signed 12 bit samples spanning the whole stored range, distinct per frame. */
const frameSamples = (frame: number) =>
  Int16Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns;
    const y = Math.floor(index / columns);
    return ((x * 61 + y * 17 + frame * 997) % 4096) - 2048;
  });

async function encodeFrames() {
  const openJph = await createOpenJph();
  return Array.from({ length: frames }, (_, frame) => {
    const encoder = new openJph.HTJ2KEncoder();
    try {
      encoder
        .getDecodedBuffer({
          width: columns,
          height: rows,
          bitsPerSample: bitsStored,
          componentCount: 1,
          isSigned: true,
          isUsingColorTransform: false,
        })
        .set(new Uint8Array(frameSamples(frame).buffer));
      encoder.encode();
      return [encoder.getEncodedBuffer().slice()];
    } finally {
      encoder.delete();
    }
  });
}

/** Three signed 12 bit frames, losslessly HTJ2K encoded, with no geometry. */
export async function htj2kSignedFrames() {
  const sopInstance = '1.2.826.0.1.3680043.10.999.3.3';
  const dataset = combine(
    element('00080016', 'UI', MULTIFRAME_WORD_SC),
    element('00080018', 'UI', sopInstance),
    element('00080060', 'CS', 'OT'),
    element('0020000d', 'UI', '1.2.826.0.1.3680043.10.999.3.1'),
    element('0020000e', 'UI', '1.2.826.0.1.3680043.10.999.3.2'),
    us('00280002', 1),
    element('00280004', 'CS', 'MONOCHROME2'),
    element('00280008', 'IS', String(frames)),
    us('00280010', rows),
    us('00280011', columns),
    us('00280100', 16),
    us('00280101', bitsStored),
    us('00280102', bitsStored - 1),
    us('00280103', 1),
    elementHeader(0x7fe0, 0x0010, 'OB', 0xffffffff),
    encapsulatedPixelData({ frames: await encodeFrames() })
  );
  return part10File(MULTIFRAME_WORD_SC, sopInstance, HTJ2K_LOSSLESS, dataset);
}
