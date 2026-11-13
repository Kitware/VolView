import { deflateRawSync } from 'node:zlib';
import reference from './reference.json';
import { elemShort, elemLong, LONG_FORM_VRS } from '../../specs/syntheticDicom';

const concat = (chunks: Uint8Array[]) => Buffer.concat(chunks);

export function element(tag: string, vr: string, value: string | Uint8Array) {
  let payload = typeof value === 'string' ? Buffer.from(value) : value;
  if (payload.length % 2)
    payload = concat([payload, Uint8Array.of(vr === 'UI' ? 0 : 32)]);
  const encode = LONG_FORM_VRS.has(vr) ? elemLong : elemShort;
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

/** An element to encode, an SQ holding its items; bytes pass through as encoded. */
type Node =
  | Readonly<{ tag: string; vr: string; value: string | Uint8Array }>
  | Readonly<{ tag: string; vr: 'SQ'; items: Node[][] }>
  | Uint8Array;

const leaf = (tag: string, vr: string, value: string | Uint8Array): Node => ({
  tag,
  vr,
  value,
});
const sq = (tag: string, items: Node[][]): Node => ({ tag, vr: 'SQ', items });

const encode = (nodes: Node[]): Buffer =>
  concat(
    nodes.map((node) => {
      if (node instanceof Uint8Array) return node;
      if ('items' in node) return sequence(node.tag, node.items.map(encode));
      return element(node.tag, node.vr, node.value);
    })
  );

/**
 * Paths name a tag and descend through `tag[item]` steps, item 0 by default
 * and negative from the end: `52009230[-1].00209113.00200032`.
 */
export type DatasetEdits = {
  set?: Record<string, string>;
  omit?: string[];
};

export type Part10Options = DatasetEdits & {
  /** Deflated Explicit VR Little Endian, through `deflateRawSync` or the given function. */
  deflate?: boolean | ((dataset: Uint8Array) => Uint8Array);
};

const DEFLATED_EXPLICIT_VR = '1.2.840.10008.1.2.1.99';

function edit(
  nodes: Node[],
  [step, ...rest]: string[],
  change: (node: Node) => Node | null
): Node[] {
  const [, tag, item = '0'] = step.match(/^([0-9a-f]{8})(?:\[(-?\d+)\])?$/i)!;
  const index = nodes.findIndex(
    (node) => !(node instanceof Uint8Array) && node.tag === tag
  );
  if (index < 0) throw new Error(`No element ${tag} to edit`);
  const node = nodes[index];
  const next =
    rest.length === 0
      ? change(node)
      : sq(
          tag,
          (node as { items: Node[][] }).items.map((items, at, all) =>
            at === (Number(item) + all.length) % all.length
              ? edit(items, rest, change)
              : items
          )
        );
  return nodes.flatMap((each, at) =>
    at !== index ? [each] : next ? [next] : []
  );
}

const applyEdits = (nodes: Node[], { set = {}, omit = [] }: DatasetEdits) =>
  [
    ...Object.entries(set).map(
      ([path, value]) =>
        (all: Node[]) =>
          edit(all, path.split('.'), (node) =>
            leaf(
              (node as { tag: string }).tag,
              (node as { vr: string }).vr,
              value
            )
          )
    ),
    ...omit.map(
      (path) => (all: Node[]) => edit(all, path.split('.'), () => null)
    ),
  ].reduce((all, apply) => apply(all), nodes);

const isFileMeta = (node: Node) =>
  !(node instanceof Uint8Array) && node.tag.startsWith('0002');

/** A Part 10 file; File Meta Group Length is written when `groupLength` or deflating. */
function part10(
  nodes: Node[],
  { deflate, ...edits }: Part10Options,
  groupLength: boolean
) {
  const edited = applyEdits(nodes, edits);
  const meta = edited
    .filter(isFileMeta)
    .map((node) =>
      deflate && !(node instanceof Uint8Array) && node.tag === '00020010'
        ? leaf(node.tag, 'UI', DEFLATED_EXPLICIT_VR)
        : node
    );
  const metaBytes = encode(meta);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(metaBytes.length);
  const dataset = encode(edited.filter((node) => !isFileMeta(node)));
  const deflateWith = deflate === true ? deflateRawSync : deflate;
  const body = deflateWith ? deflateWith(dataset) : dataset;
  return concat([
    Buffer.alloc(128),
    Buffer.from('DICM'),
    ...(groupLength || deflate ? [element('00020000', 'UL', length)] : []),
    metaBytes,
    body,
    // DICOM requires an even-length deflated stream with a trailing NULL if needed.
    Buffer.alloc(deflateWith ? body.length % 2 : 0),
  ]);
}

type Frame = {
  position?: string;
  spacing?: string;
  orientation?: string;
  slowSpacing?: string;
};
const positionSequence = (position: string) =>
  sq('00209113', [[leaf('00200032', 'DS', position)]]);
const measureSequence = (spacing: string) =>
  sq('00289110', [[leaf('00280030', 'DS', spacing)]]);
const orientationSequence = (orientation: string) =>
  sq('00209116', [[leaf('00200037', 'DS', orientation)]]);

export function enhancedFile(
  frames: Frame[],
  extraHeader: Uint8Array[] = [],
  {
    orientation = '1\\0\\0\\0\\1\\0',
    ...options
  }: Part10Options & { orientation?: string } = {}
) {
  return new Blob([
    part10(
      [
        leaf('00020010', 'UI', '1.2.840.10008.1.2.1'),
        leaf('00080016', 'UI', '1.2.840.10008.5.1.4.1.1.77.1.5.4'),
        leaf('00280008', 'IS', String(frames.length)),
        ...extraHeader,
        sq('52009229', [
          [measureSequence('0.01\\0.02'), orientationSequence(orientation)],
        ]),
        sq(
          '52009230',
          frames.map((frame) => [
            ...(frame.position ? [positionSequence(frame.position)] : []),
            ...(frame.spacing ? [measureSequence(frame.spacing)] : []),
            ...(frame.slowSpacing
              ? [sq('00289110', [[leaf('00180088', 'DS', frame.slowSpacing)]])]
              : []),
            ...(frame.orientation
              ? [orientationSequence(frame.orientation)]
              : []),
          ])
        ),
      ],
      options,
      false
    ),
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

type SyntheticOCTOptions = Part10Options & {
  scanPattern?: string;
  scalars?: Uint16Array;
  /** Declares (0028,0120) Pixel Padding Value. */
  pixelPaddingValue?: number;
};

/** A regular raster with the intensity x + 2y + 3z and no clinical pixels. */
export function createSyntheticOCT({
  scanPattern = '128280',
  scalars = syntheticScalars(),
  pixelPaddingValue,
  ...options
}: SyntheticOCTOptions = {}) {
  const [width, depth, frames] = reference.size;
  const [sx, sy, sz] = reference.spacing;
  const uid = '1.2.826.0.1.3680043.10.999.1';
  const us = (tag: string, value: number) => {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(value);
    return leaf(tag, 'US', bytes);
  };
  const sop = '1.2.840.10008.5.1.4.1.1.77.1.5.4';
  const orientation = '1.0\\0.0\\0.0\\0.0\\1.0\\0.0';
  const measures = sq('00289110', [
    [
      leaf('00180050', 'DS', String(sz)),
      leaf('00180088', 'DS', String(sz)),
      leaf('00280030', 'DS', `${sy}\\${sx}`),
    ],
  ]);
  const pixels = Buffer.alloc(scalars.length * 2);
  scalars.forEach((value, index) => pixels.writeUInt16LE(value, index * 2));
  return part10(
    [
      leaf('00020001', 'OB', Uint8Array.of(0, 1)),
      leaf('00020002', 'UI', sop),
      leaf('00020003', 'UI', `${uid}.3`),
      leaf('00020010', 'UI', '1.2.840.10008.1.2.1'),
      leaf('00020012', 'UI', `${uid}.99`),
      leaf('00080008', 'CS', 'DERIVED\\PRIMARY'),
      leaf('00080016', 'UI', sop),
      leaf('00080018', 'UI', `${uid}.3`),
      leaf('00080020', 'DA', '20260101'),
      leaf('00080030', 'TM', '000000'),
      leaf('00080060', 'CS', 'OPT'),
      leaf('0008103e', 'LO', 'Synthetic OCT raster'),
      leaf('00100010', 'PN', 'SYNTHETIC'),
      leaf('00100020', 'LO', 'SYNTHETIC'),
      leaf('00180050', 'DS', String(sz)),
      leaf('00180088', 'DS', String(sz)),
      leaf('0020000d', 'UI', `${uid}.1`),
      leaf('0020000e', 'UI', `${uid}.2`),
      leaf('00200011', 'IS', '1'),
      leaf('00200013', 'IS', '1'),
      leaf('00200032', 'DS', '0\\0\\0'),
      leaf('00200037', 'DS', orientation),
      leaf('00200052', 'UI', `${uid}.4`),
      sq('00221618', [[leaf('00080100', 'SH', scanPattern)]]),
      leaf('00221622', 'CS', 'YES'),
      us('00280002', 1),
      leaf('00280004', 'CS', 'MONOCHROME2'),
      leaf('00280008', 'IS', String(frames)),
      us('00280010', depth),
      us('00280011', width),
      leaf('00280030', 'DS', `${sy}\\${sx}`),
      us('00280100', 16),
      us('00280101', 16),
      us('00280102', 15),
      us('00280103', 0),
      ...(pixelPaddingValue === undefined
        ? []
        : [us('00280120', pixelPaddingValue)]),
      sq('52009229', [[measures, orientationSequence(orientation)]]),
      sq(
        '52009230',
        Array.from({ length: frames }, (_, z) => [
          positionSequence(`0.0\\0.0\\${(z * sz).toFixed(4)}`),
        ])
      ),
      leaf('7fe00010', 'OW', pixels),
    ],
    options,
    true
  );
}
