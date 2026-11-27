import type { DicomDataset, DicomElement } from '../metadata/dicomDataset';
import { findElement } from '../metadata/dicomDataset';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import { paletteSampleBits } from '../volume/pixelFormat';

/** Red, green and blue tables that turn a stored value into a color. */
export type Palette = Readonly<{
  /** The stored value the first entry of each table stands for. */
  firstMapped: number;
  /** Bits of each color sample the lookup yields. */
  bits: 8 | 16;
  tables: readonly [Uint16Array, Uint16Array, Uint16Array];
}>;

const CHANNELS = [
  { descriptor: '00281101', data: '00281201', segmented: '00281221' },
  { descriptor: '00281102', data: '00281202', segmented: '00281222' },
  { descriptor: '00281103', data: '00281203', segmented: '00281223' },
];

const words = (bytes: Uint8Array, littleEndian: boolean) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  return Uint16Array.from({ length: bytes.length >> 1 }, (_, index) =>
    view.getUint16(index * 2, littleEndian)
  );
};

const bytesOf = ({ values }: DicomElement) =>
  values.kind === 'bytes' ? values.values[0] : undefined;

// Rounds halves to even, as the reference expansion of a linear segment does.
const roundHalfEven = (value: number) => {
  const floor = Math.floor(value);
  const rest = value - floor;
  if (rest !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
};

/** Appends one segment's values and returns how many table values it took. */
type Segment = (
  data: ArrayLike<number>,
  at: number,
  expanded: number[]
) => number;

const discrete: Segment = (data, at, expanded) => {
  const length = data[at + 1];
  for (let index = 0; index < length; index += 1)
    expanded.push(data[at + 2 + index]);
  return 2 + length;
};

// A ramp from the last value to the one given, which cannot open a table.
const linear: Segment = (data, at, expanded) => {
  if (expanded.length === 0)
    throw new Error('A segmented palette starts with a linear segment');
  const length = data[at + 1];
  const from = expanded[expanded.length - 1];
  const to = data[at + 2];
  const step = (to - from) / length;
  for (let index = 1; index <= length; index += 1)
    expanded.push(index === length ? to : roundHalfEven(from + step * index));
  return 3;
};

// Repeats a run of earlier segments, found by a 32 bit offset in two words.
const indirect: Segment = (data, at, expanded) => {
  const start = (data[at + 3] << 16) | data[at + 2];
  expandSegmentedTable(
    Array.prototype.slice.call(data, start),
    data[at + 1],
    expanded
  );
  return 4;
};

const SEGMENTS: Segment[] = [discrete, linear, indirect];

/** Expands Segmented Palette Color Lookup Table Data (PS3.3 C.7.9.2). */
export function expandSegmentedTable(
  data: ArrayLike<number>,
  segments = Infinity,
  expanded: number[] = []
) {
  let at = 0;
  // A segment is longer than two values, so a trailing pad is not one.
  for (let read = 0; read < segments && at + 1 < data.length; read += 1) {
    const segment = SEGMENTS[data[at]];
    if (!segment)
      throw new Error(`Segmented palette opcode ${data[at]} is not defined`);
    at += segment(data, at, expanded);
  }
  return expanded;
}

type Table = Readonly<{ values: Uint16Array; wide: boolean }>;

/** A channel's table, and whether the file holds each entry in 16 bits. */
function readTable(
  dataset: DicomDataset,
  channel: (typeof CHANNELS)[number],
  entries: number,
  littleEndian: boolean
): Table | undefined {
  const plain = findElement(dataset, channel.data);
  if (plain?.values.kind === 'number')
    return { values: Uint16Array.from(plain.values.values), wide: true };
  const bytes = plain && bytesOf(plain);
  // A table shorter than two bytes an entry holds one byte an entry.
  if (bytes && bytes.length < entries * 2)
    return {
      values: Uint16Array.from(bytes.subarray(0, entries)),
      wide: false,
    };
  if (bytes) return { values: words(bytes, littleEndian), wide: true };
  const segmented = findElement(dataset, channel.segmented);
  const data = segmented && bytesOf(segmented);
  return data
    ? {
        values: Uint16Array.from(
          expandSegmentedTable(words(data, littleEndian))
        ),
        wide: true,
      }
    : undefined;
}

const number = (dataset: DicomDataset, tag: string) =>
  Number(getDatasetTag(dataset, tag));

/** The palette a PALETTE COLOR data set declares, or why it has none. */
export function readPalette(
  dataset: DicomDataset,
  littleEndian: boolean
): Palette | Readonly<{ missing: string }> {
  const [count, first, entryBits] = (
    getDatasetTag(dataset, CHANNELS[0].descriptor) ?? ''
  )
    .split('\\')
    .map(Number);
  const bits = paletteSampleBits(dataset);
  if (!Number.isFinite(first) || !bits)
    return { missing: 'No usable Palette Color Lookup Table Descriptor' };
  const tables = CHANNELS.flatMap(
    (channel) =>
      readTable(dataset, channel, count || 2 ** 16, littleEndian) ?? []
  );
  if (tables.length < 3 || tables.some(({ values }) => values.length === 0))
    return { missing: 'Palette Color Lookup Table Data is missing' };
  // 8 bit color is the high byte of entries that span 16 bits. Entries held
  // in 16 bits under an 8 bit descriptor may be small numbers or may span 16.
  const spans16 = tables.some(
    ({ values, wide }) =>
      wide && (entryBits === 16 || values.some((value) => value > 0xff))
  );
  const [red, green, blue] = tables.map(({ values }) =>
    spans16 && bits === 8 ? values.map((value) => value >> 8) : values
  );
  // Implicit VR reads the descriptor as unsigned, whatever the pixels are.
  const signed = number(dataset, Tags.PixelRepresentation) === 1;
  return {
    firstMapped: signed && first > 0x7fff ? first - 0x10000 : first,
    bits: bits === 8 ? 8 : 16,
    tables: [red, green, blue],
  };
}

/**
 * Stored values as interleaved RGB, little endian where a sample takes two
 * bytes. Values before the first mapped take the first entry and values past
 * the table take the last.
 */
export function paletteAsRgb(
  values: ArrayLike<number>,
  { firstMapped, bits, tables }: Palette
) {
  const Samples = bits === 8 ? Uint8Array : Uint16Array;
  const rgb = new Samples(values.length * 3);
  tables.forEach((table, channel) => {
    const last = table.length - 1;
    for (let pixel = 0; pixel < values.length; pixel += 1) {
      const entry = Math.min(Math.max(values[pixel] - firstMapped, 0), last);
      rgb[pixel * 3 + channel] = table[entry];
    }
  });
  return rgb;
}
