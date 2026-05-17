import { describe, it, expect } from 'vitest';
import { parseCineDicom } from '../parseCineDicom';

// =================================================================
// Synthetic DICOM builder (Explicit VR LE)
// =================================================================
//
// Lets the parser smoke tests run anywhere without committing real ultrasound
// fixtures. Produces the minimum byte layout the parser cares about: 128-byte
// preamble, DICM magic, a TransferSyntaxUID file-meta element, and a hand-
// rolled dataset.

const TS_EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
const TS_JPEG_BASELINE = '1.2.840.10008.1.2.4.50';

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function evenPad(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength % 2 === 0) return bytes;
  const out = new Uint8Array(bytes.byteLength + 1);
  out.set(bytes);
  out[bytes.byteLength] = 0x20;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

const VR4 = new Set([
  'OB',
  'OW',
  'OF',
  'OD',
  'OL',
  'SQ',
  'UC',
  'UR',
  'UT',
  'UN',
]);

function elementShort(
  group: number,
  element: number,
  vr: string,
  value: Uint8Array
): Uint8Array {
  const padded = evenPad(value);
  const header = new Uint8Array(8);
  const dv = new DataView(header.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, element, true);
  header[4] = vr.charCodeAt(0);
  header[5] = vr.charCodeAt(1);
  dv.setUint16(6, padded.byteLength, true);
  return concat([header, padded]);
}

function elementLong(
  group: number,
  element: number,
  vr: string,
  value: Uint8Array
): Uint8Array {
  if (!VR4.has(vr)) throw new Error(`VR ${vr} is not 4-byte length`);
  const header = new Uint8Array(12);
  const dv = new DataView(header.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, element, true);
  header[4] = vr.charCodeAt(0);
  header[5] = vr.charCodeAt(1);
  // header[6..8] reserved zero
  dv.setUint32(8, value.byteLength, true);
  return concat([header, value]);
}

function u16Bytes(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function fileMeta(transferSyntaxUID: string): Uint8Array {
  return elementShort(0x0002, 0x0010, 'UI', ascii(transferSyntaxUID));
}

const COMMON_TAGS = (
  numberOfFrames: number,
  rows: number,
  cols: number,
  options: {
    samplesPerPixel?: number;
    photometricInterpretation?: string;
    planarConfiguration?: number;
  } = {}
) => {
  const samplesPerPixel = options.samplesPerPixel ?? 1;
  const photometricInterpretation =
    options.photometricInterpretation ?? 'MONOCHROME2';

  return concat([
    elementShort(0x0008, 0x0016, 'UI', ascii('1.2.840.10008.5.1.4.1.1.3.1')),
    elementShort(0x0008, 0x0018, 'UI', ascii('1.2.3.4.5.6.7.8.9')),
    elementShort(0x0008, 0x0060, 'CS', ascii('US')),
    elementShort(0x0020, 0x000d, 'UI', ascii('1.2.3.4.5.6.7.8.9.1')),
    elementShort(0x0020, 0x000e, 'UI', ascii('1.2.3.4.5.6.7.8.9.2')),
    elementShort(0x0028, 0x0002, 'US', u16Bytes(samplesPerPixel)),
    elementShort(0x0028, 0x0004, 'CS', ascii(photometricInterpretation)),
    ...(options.planarConfiguration == null
      ? []
      : [
          elementShort(
            0x0028,
            0x0006,
            'US',
            u16Bytes(options.planarConfiguration)
          ),
        ]),
    elementShort(0x0028, 0x0008, 'IS', ascii(String(numberOfFrames))),
    elementShort(0x0028, 0x0010, 'US', u16Bytes(rows)),
    elementShort(0x0028, 0x0011, 'US', u16Bytes(cols)),
    elementShort(0x0028, 0x0100, 'US', u16Bytes(8)),
    elementShort(0x0028, 0x0101, 'US', u16Bytes(8)),
  ]);
};

function buildNativeDicom(opts: {
  numberOfFrames: number;
  rows: number;
  cols: number;
  fillByte?: number;
  samplesPerPixel?: number;
  photometricInterpretation?: string;
  planarConfiguration?: number;
}): Uint8Array {
  const {
    numberOfFrames,
    rows,
    cols,
    fillByte = 0x42,
    samplesPerPixel = 1,
  } = opts;
  const preamble = new Uint8Array(128);
  const dicm = ascii('DICM');
  const meta = fileMeta(TS_EXPLICIT_VR_LE);
  const dataset = COMMON_TAGS(numberOfFrames, rows, cols, opts);

  const pixelBytes = new Uint8Array(
    numberOfFrames * rows * cols * samplesPerPixel
  );
  pixelBytes.fill(fillByte);
  const pixelData = elementLong(0x7fe0, 0x0010, 'OB', pixelBytes);

  return concat([preamble, dicm, meta, dataset, pixelData]);
}

function buildEncapsulatedDicom(opts: {
  rows: number;
  cols: number;
  frameJpegBytes: Uint8Array[];
  populateBot: boolean;
}): Uint8Array {
  const { rows, cols, frameJpegBytes, populateBot } = opts;
  const preamble = new Uint8Array(128);
  const dicm = ascii('DICM');
  const meta = fileMeta(TS_JPEG_BASELINE);
  const dataset = COMMON_TAGS(frameJpegBytes.length, rows, cols);

  // Build the encapsulated PixelData: undefined length (0xFFFFFFFF), BOT item,
  // one fragment item per frame, sequence delimitation item.
  const fragmentItems = frameJpegBytes.map((bytes) => {
    const padded = evenPad(bytes);
    const header = new Uint8Array(8);
    const dv = new DataView(header.buffer);
    dv.setUint16(0, 0xfffe, true);
    dv.setUint16(2, 0xe000, true);
    dv.setUint32(4, padded.byteLength, true);
    return concat([header, padded]);
  });

  const botEntries = new Uint8Array(
    populateBot ? frameJpegBytes.length * 4 : 0
  );
  if (populateBot) {
    const dv = new DataView(botEntries.buffer);
    let relOffset = 0;
    frameJpegBytes.forEach((bytes, i) => {
      dv.setUint32(i * 4, relOffset, true);
      relOffset += 8 + evenPad(bytes).byteLength;
    });
  }
  const botHeader = new Uint8Array(8);
  const botDv = new DataView(botHeader.buffer);
  botDv.setUint16(0, 0xfffe, true);
  botDv.setUint16(2, 0xe000, true);
  botDv.setUint32(4, botEntries.byteLength, true);
  const botItem = concat([botHeader, botEntries]);

  const seqDelim = new Uint8Array(8);
  const sdv = new DataView(seqDelim.buffer);
  sdv.setUint16(0, 0xfffe, true);
  sdv.setUint16(2, 0xe0dd, true);
  sdv.setUint32(4, 0, true);

  const pdHeader = new Uint8Array(12);
  const pdDv = new DataView(pdHeader.buffer);
  pdDv.setUint16(0, 0x7fe0, true);
  pdDv.setUint16(2, 0x0010, true);
  pdHeader[4] = 'O'.charCodeAt(0);
  pdHeader[5] = 'B'.charCodeAt(0);
  pdDv.setUint32(8, 0xffffffff, true);

  const pdBody = concat([botItem, ...fragmentItems, seqDelim]);
  return concat([preamble, dicm, meta, dataset, pdHeader, pdBody]);
}

// Marker bytes that look like a JPEG SOI/EOI. The parser doesn't actually
// decode them, so any payload with the right framing works.
const fakeJpegFrame = (n: number): Uint8Array =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, n & 0xff, 0xff, 0xd9]);

// =================================================================
// In-test (synthetic) fixtures — run everywhere
// =================================================================

describe('parseCineDicom on synthetic fixtures', () => {
  it('parses Explicit VR LE native multi-frame', () => {
    const bytes = buildNativeDicom({
      numberOfFrames: 5,
      rows: 4,
      cols: 3,
      fillByte: 0x7f,
    });
    const { header, frames, encapsulated } = parseCineDicom(bytes);
    expect(encapsulated).toBe(false);
    expect(header.numberOfFrames).toBe(5);
    expect(header.rows).toBe(4);
    expect(header.cols).toBe(3);
    expect(header.transferSyntaxUID).toBe(TS_EXPLICIT_VR_LE);
    expect(header.photometricInterpretation).toBe('MONOCHROME2');
    expect(frames.length).toBe(5);
    expect(frames[0].byteLength).toBe(4 * 3);
    expect(frames[0][0]).toBe(0x7f);
  });

  it('parses native RGB planar-configuration metadata', () => {
    const bytes = buildNativeDicom({
      numberOfFrames: 2,
      rows: 1,
      cols: 2,
      samplesPerPixel: 3,
      photometricInterpretation: 'RGB',
      planarConfiguration: 1,
    });
    const { header, frames } = parseCineDicom(bytes);

    expect(header.samplesPerPixel).toBe(3);
    expect(header.photometricInterpretation).toBe('RGB');
    expect(header.planarConfiguration).toBe(1);
    expect(frames[0].byteLength).toBe(1 * 2 * 3);
  });

  it('parses encapsulated PixelData with a populated BOT', () => {
    const frameBytes = [fakeJpegFrame(1), fakeJpegFrame(2), fakeJpegFrame(3)];
    const bytes = buildEncapsulatedDicom({
      rows: 2,
      cols: 2,
      frameJpegBytes: frameBytes,
      populateBot: true,
    });
    const { header, frames, encapsulated } = parseCineDicom(bytes);
    expect(encapsulated).toBe(true);
    expect(header.numberOfFrames).toBe(3);
    expect(frames.length).toBe(3);
    expect(frames[0][0]).toBe(0xff);
    expect(frames[0][1]).toBe(0xd8);
    expect(frames[2][4]).toBe(3); // payload byte from fakeJpegFrame(3)
  });

  it('parses encapsulated PixelData with an empty BOT (1-fragment-per-frame)', () => {
    const frameBytes = [fakeJpegFrame(10), fakeJpegFrame(20)];
    const bytes = buildEncapsulatedDicom({
      rows: 2,
      cols: 2,
      frameJpegBytes: frameBytes,
      populateBot: false,
    });
    const { header, frames } = parseCineDicom(bytes);
    expect(header.numberOfFrames).toBe(2);
    expect(frames.length).toBe(2);
    expect(frames[1][4]).toBe(20);
  });
});
