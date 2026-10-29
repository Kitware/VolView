import reference from './reference.json';
import { elemShort, elemLong } from '../../specs/syntheticDicom';

const concat = (chunks: Uint8Array[]) => Buffer.concat(chunks);

export function element(tag: string, vr: string, value: string | Uint8Array) {
  let payload = typeof value === 'string' ? Buffer.from(value) : value;
  if (payload.length % 2)
    payload = concat([payload, Uint8Array.of(vr === 'UI' ? 0 : 32)]);
  const encode = ['SQ', 'OW', 'OB'].includes(vr) ? elemLong : elemShort;
  return encode(
    parseInt(tag.slice(0, 4), 16),
    parseInt(tag.slice(4), 16),
    vr,
    payload
  );
}

export function sequence(tag: string, datasets: Uint8Array[]) {
  return element(
    tag,
    'SQ',
    concat(
      datasets.map((dataset) => {
        const header = Buffer.alloc(8);
        header.writeUInt16LE(0xfffe);
        header.writeUInt16LE(0xe000, 2);
        header.writeUInt32LE(dataset.length, 4);
        return concat([header, dataset]);
      })
    )
  );
}

type Frame = {
  position?: string;
  spacing?: string;
  orientation?: string;
  slowSpacing?: string;
};
const positionSequence = (position: string) =>
  sequence('00209113', [element('00200032', 'DS', position)]);
const measureSequence = (spacing: string) =>
  sequence('00289110', [element('00280030', 'DS', spacing)]);
const orientationSequence = (orientation: string) =>
  sequence('00209116', [element('00200037', 'DS', orientation)]);

export function enhancedFile(
  frames: Frame[],
  extraHeader: Uint8Array[] = [],
  extraShared: Uint8Array[] = []
) {
  return new Blob([
    concat([
      Buffer.alloc(128),
      Buffer.from('DICM'),
      element('00020010', 'UI', '1.2.840.10008.1.2.1'),
      element('00080016', 'UI', '1.2.840.10008.5.1.4.1.1.77.1.5.4'),
      element('00280008', 'IS', String(frames.length)),
      ...extraHeader,
      sequence('52009229', [
        concat([
          measureSequence('0.01\\0.02'),
          orientationSequence('1\\0\\0\\0\\1\\0'),
          ...extraShared,
        ]),
      ]),
      sequence(
        '52009230',
        frames.map((frame) =>
          concat([
            ...(frame.position ? [positionSequence(frame.position)] : []),
            ...(frame.spacing ? [measureSequence(frame.spacing)] : []),
            ...(frame.slowSpacing
              ? [
                  sequence('00289110', [
                    element('00180088', 'DS', frame.slowSpacing),
                  ]),
                ]
              : []),
            ...(frame.orientation
              ? [orientationSequence(frame.orientation)]
              : []),
          ])
        )
      ),
    ]),
  ]);
}

export function syntheticScalars() {
  const [width, depth, frames] = reference.size;
  return Uint16Array.from({ length: width * depth * frames }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width) % depth;
    const z = Math.floor(index / (width * depth));
    return x + 2 * y + 3 * z;
  });
}

/** A regular raster with the intensity x + 2y + 3z and no clinical pixels. */
export function createSyntheticOCT() {
  const [width, depth, frames] = reference.size;
  const [sx, sy, sz] = reference.spacing;
  const uid = '1.2.826.0.1.3680043.10.999.1';
  const us = (tag: string, value: number) => {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(value);
    return element(tag, 'US', bytes);
  };
  const sop = '1.2.840.10008.5.1.4.1.1.77.1.5.4';
  const fileMeta = concat([
    element('00020001', 'OB', Uint8Array.of(0, 1)),
    element('00020002', 'UI', sop),
    element('00020003', 'UI', `${uid}.3`),
    element('00020010', 'UI', '1.2.840.10008.1.2.1'),
    element('00020012', 'UI', `${uid}.99`),
  ]);
  const groupLength = Buffer.alloc(4);
  groupLength.writeUInt32LE(fileMeta.length);
  const orientation = '1.0\\0.0\\0.0\\0.0\\1.0\\0.0';
  const measures = sequence('00289110', [
    concat([
      element('00180050', 'DS', String(sz)),
      element('00180088', 'DS', String(sz)),
      element('00280030', 'DS', `${sy}\\${sx}`),
    ]),
  ]);
  const pixels = Buffer.alloc(width * depth * frames * 2);
  syntheticScalars().forEach((value, index) =>
    pixels.writeUInt16LE(value, index * 2)
  );
  return concat([
    Buffer.alloc(128),
    Buffer.from('DICM'),
    element('00020000', 'UL', groupLength),
    fileMeta,
    element('00080008', 'CS', 'DERIVED\\PRIMARY'),
    element('00080016', 'UI', sop),
    element('00080018', 'UI', `${uid}.3`),
    element('00080020', 'DA', '20260101'),
    element('00080030', 'TM', '000000'),
    element('00080060', 'CS', 'OPT'),
    element('0008103e', 'LO', 'Synthetic OCT raster'),
    element('00100010', 'PN', 'SYNTHETIC'),
    element('00100020', 'LO', 'SYNTHETIC'),
    element('00180050', 'DS', String(sz)),
    element('00180088', 'DS', String(sz)),
    element('0020000d', 'UI', `${uid}.1`),
    element('0020000e', 'UI', `${uid}.2`),
    element('00200011', 'IS', '1'),
    element('00200013', 'IS', '1'),
    element('00200032', 'DS', '0\\0\\0'),
    element('00200037', 'DS', orientation),
    element('00200052', 'UI', `${uid}.4`),
    sequence('00221618', [element('00080100', 'SH', '128280')]),
    element('00221622', 'CS', 'YES'),
    us('00280002', 1),
    element('00280004', 'CS', 'MONOCHROME2'),
    element('00280008', 'IS', String(frames)),
    us('00280010', depth),
    us('00280011', width),
    element('00280030', 'DS', `${sy}\\${sx}`),
    us('00280100', 16),
    us('00280101', 16),
    us('00280102', 15),
    us('00280103', 0),
    sequence('52009229', [
      concat([measures, orientationSequence(orientation)]),
    ]),
    sequence(
      '52009230',
      Array.from({ length: frames }, (_, z) =>
        positionSequence(`0.0\\0.0\\${(z * sz).toFixed(4)}`)
      )
    ),
    element('7fe00010', 'OW', pixels),
  ]);
}
