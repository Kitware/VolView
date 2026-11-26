import { element } from '../oct/dicom';
import {
  combine,
  elementHeader,
  encapsulatedPixelData,
  part10File,
  rawElement,
} from '../../specs/syntheticDicom';

const RLE_LOSSLESS = '1.2.840.10008.1.2.5';
const MULTIFRAME_WORD_SC = '1.2.840.10008.5.1.4.1.1.7.3';
const MULTIFRAME_COLOR_SC = '1.2.840.10008.5.1.4.1.1.7.4';
const [columns, rows] = [64, 48];

const us = (tag: string, value: number) =>
  rawElement(
    parseInt(tag.slice(0, 4), 16),
    parseInt(tag.slice(4), 16),
    'US',
    new Uint8Array(Uint16Array.of(value).buffer)
  );

/** PackBits for one row: a repeated byte as a replicate run, the rest as literals. */
function packRow(row: Uint8Array) {
  const packed: number[] = [];
  let start = 0;
  while (start < row.length) {
    let end = start + 1;
    while (end < row.length && end - start < 128 && row[end] === row[start])
      end += 1;
    if (end - start > 1) packed.push(257 - (end - start), row[start]);
    else {
      while (end < row.length && end - start < 128 && row[end] !== row[end - 1])
        end += 1;
      packed.push(end - start - 1, ...row.subarray(start, end));
    }
    start = end;
  }
  return packed;
}

/** One byte plane, each row packed on its own, padded to an even length. */
function segment(plane: Uint8Array) {
  const packed = Array.from({ length: rows }, (_, row) =>
    packRow(plane.subarray(row * columns, (row + 1) * columns))
  ).flat();
  return Uint8Array.from(packed.length % 2 ? [...packed, 0] : packed);
}

/**
 * An RLE frame of interleaved little endian samples: a segment per byte
 * plane, components in order and each component's most significant byte first.
 */
function rleFrame(samples: Uint8Array, components: number, bytes: number) {
  const stride = components * bytes;
  const segments = Array.from({ length: stride }, (_, index) => {
    const component = Math.floor(index / bytes);
    const offset = component * bytes + (bytes - 1 - (index % bytes));
    return segment(
      Uint8Array.from(
        { length: columns * rows },
        (__, pixel) => samples[pixel * stride + offset]
      )
    );
  });
  const header = new DataView(new ArrayBuffer(64));
  header.setUint32(0, segments.length, true);
  segments.reduce((offset, each, index) => {
    header.setUint32(4 + index * 4, offset, true);
    return offset + each.length;
  }, 64);
  return combine(new Uint8Array(header.buffer), ...segments);
}

type RleFile = {
  sopClass: string;
  instance: number;
  frames: Uint8Array[];
  samplesPerPixel: number;
  bitsAllocated: number;
  bitsStored: number;
  signed: boolean;
  offsetTable?: boolean;
};

function rleFile(file: RleFile) {
  const { sopClass, samplesPerPixel, bitsAllocated } = file;
  const sopInstance = `1.2.826.0.1.3680043.10.999.4.${file.instance}.3`;
  const dataset = combine(
    element('00080016', 'UI', sopClass),
    element('00080018', 'UI', sopInstance),
    element('00080060', 'CS', 'OT'),
    element(
      '0020000d',
      'UI',
      `1.2.826.0.1.3680043.10.999.4.${file.instance}.1`
    ),
    element(
      '0020000e',
      'UI',
      `1.2.826.0.1.3680043.10.999.4.${file.instance}.2`
    ),
    us('00280002', samplesPerPixel),
    element('00280004', 'CS', samplesPerPixel === 3 ? 'RGB' : 'MONOCHROME2'),
    ...(samplesPerPixel === 3 ? [us('00280006', 1)] : []),
    element('00280008', 'IS', String(file.frames.length)),
    us('00280010', rows),
    us('00280011', columns),
    us('00280100', bitsAllocated),
    us('00280101', file.bitsStored),
    us('00280102', file.bitsStored - 1),
    us('00280103', file.signed ? 1 : 0),
    elementHeader(0x7fe0, 0x0010, 'OB', 0xffffffff),
    encapsulatedPixelData({
      frames: file.frames.map((samples) => [
        rleFrame(samples, samplesPerPixel, bitsAllocated / 8),
      ]),
      offsetTable: file.offsetTable,
    })
  );
  return part10File(sopClass, sopInstance, RLE_LOSSLESS, dataset);
}

const bytesOf = (samples: ArrayBufferView) =>
  new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);

const pixels = <T>(sample: (x: number, y: number) => T) =>
  Array.from({ length: columns * rows }, (_, index) =>
    sample(index % columns, Math.floor(index / columns))
  );

/** Three signed 12 bit frames in 16 bit words, located by a Basic Offset Table. */
export const rleSignedFrames = () =>
  rleFile({
    sopClass: MULTIFRAME_WORD_SC,
    instance: 1,
    frames: [0, 1, 2].map((frame) =>
      bytesOf(
        Int16Array.from(
          pixels((x, y) => ((x * 61 + y * 17 + frame * 997) % 4096) - 2048)
        )
      )
    ),
    samplesPerPixel: 1,
    bitsAllocated: 16,
    bitsStored: 12,
    signed: true,
    offsetTable: true,
  });

/** Two 8 bit RGB frames with flat and varying runs in every plane. */
export const rleRgbFrames = () =>
  rleFile({
    sopClass: MULTIFRAME_COLOR_SC,
    instance: 2,
    frames: [0, 1].map((frame) =>
      Uint8Array.from(
        pixels((x, y) => [
          (x * 4 + frame * 40) % 256,
          y < rows / 2 ? 200 - frame * 100 : (x * y) % 256,
          (x + y * 5 + frame) % 256,
        ]).flat()
      )
    ),
    samplesPerPixel: 3,
    bitsAllocated: 8,
    bitsStored: 8,
    signed: false,
  });

/** One unsigned 32 bit frame whose samples use all four byte planes. */
export const rle32Bit = () =>
  rleFile({
    sopClass: MULTIFRAME_WORD_SC,
    instance: 3,
    frames: [
      bytesOf(
        Uint32Array.from(pixels((x, y) => (x * 65537 + y * 16777259) >>> 0))
      ),
    ],
    samplesPerPixel: 1,
    bitsAllocated: 32,
    bitsStored: 32,
    signed: false,
  });
