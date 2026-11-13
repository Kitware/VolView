import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import corpus from '../dicomVolumeCorpus.json';
import composition from '../dicomCompositionCorpus.json';
import { DATASET_CACHE } from '../downloadDatasets';
import { openDicomConsumer } from '../dicomConsumer';
import { fixtureBytes } from '../fixtures/dicom-consumer/fixtureData';
import { startDicomConsumerFixtures } from '../fixtures/dicom-consumer/server.mjs';
import {
  EXPLICIT_BE,
  EXPLICIT_LE,
  IMPLICIT_LE,
  nativePixelDicom,
  type DataElement,
  type NativePixelOptions,
} from '../nativePixelDicom';

const SOP_CLASSES = {
  CT: '1.2.840.10008.5.1.4.1.1.2',
  MR: '1.2.840.10008.5.1.4.1.1.4',
  PT: '1.2.840.10008.5.1.4.1.1.128',
  SC: '1.2.840.10008.5.1.4.1.1.7',
  US: '1.2.840.10008.5.1.4.1.1.6.1',
  USMultiframe: '1.2.840.10008.5.1.4.1.1.3.1',
  XA: '1.2.840.10008.5.1.4.1.1.12.1',
  NM: '1.2.840.10008.5.1.4.1.1.20',
  DX: '1.2.840.10008.5.1.4.1.1.1.1',
  CR: '1.2.840.10008.5.1.4.1.1.1',
  EnhancedCT: '1.2.840.10008.5.1.4.1.1.2.1',
  EnhancedMR: '1.2.840.10008.5.1.4.1.1.4.1',
  OCT: '1.2.840.10008.5.1.4.1.1.77.1.5.4',
};

const us = (tag: number, value: number): DataElement => ({
  tag,
  vr: 'US',
  value: [value],
});

const overlay = [
  us(0x60000010, 5),
  us(0x60000011, 3),
  us(0x60000100, 16),
  us(0x60000102, 12),
];

// Stored words span every bit pattern, high bits above Bits Stored included.
// The flag says whether the capability predicate must decode natively.
// prettier-ignore
const synthetic: Array<[string, boolean, NativePixelOptions]> = [
  ['u8', true, { bitsAllocated: 8 }],
  ['s8', true, { bitsAllocated: 8, pixelRepresentation: 1 }],
  ['u8-bs6', false, { bitsAllocated: 8, bitsStored: 6 }],
  ['u16', true, {}],
  ['s16', true, { pixelRepresentation: 1 }],
  ['u16-bs12', true, { bitsStored: 12 }],
  ['s16-bs12', true, { bitsStored: 12, pixelRepresentation: 1 }],
  ['u16-bs1', true, { bitsStored: 1 }],
  ['u32', true, { bitsAllocated: 32 }],
  ['s32', true, { bitsAllocated: 32, pixelRepresentation: 1 }],
  ['u32-bs24', false, { bitsAllocated: 32, bitsStored: 24 }],
  ['implicit-u16-bs12', true, { transferSyntaxUid: IMPLICIT_LE, bitsStored: 12 }],
  ['implicit-s16', true, { transferSyntaxUid: IMPLICIT_LE, pixelRepresentation: 1 }],
  ['implicit-u8', true, { transferSyntaxUid: IMPLICIT_LE, bitsAllocated: 8 }],
  ['be-u16-bs12', true, { transferSyntaxUid: EXPLICIT_BE, bitsStored: 12 }],
  ['be-s16', true, { transferSyntaxUid: EXPLICIT_BE, pixelRepresentation: 1 }],
  ['be-s16-bs12-frames', true, { transferSyntaxUid: EXPLICIT_BE, bitsStored: 12, pixelRepresentation: 1, frames: 3 }],
  ['be-u8', false, { transferSyntaxUid: EXPLICIT_BE, bitsAllocated: 8 }],
  ['be-u32', false, { transferSyntaxUid: EXPLICIT_BE, bitsAllocated: 32 }],
  ['rgb', true, { samplesPerPixel: 3, bitsAllocated: 8, planarConfiguration: 0 }],
  ['rgb-planar', true, { samplesPerPixel: 3, bitsAllocated: 8, planarConfiguration: 1 }],
  ['rgb-planar-frames', true, { samplesPerPixel: 3, bitsAllocated: 8, planarConfiguration: 1, frames: 3 }],
  ['implicit-rgb', true, { transferSyntaxUid: IMPLICIT_LE, samplesPerPixel: 3, bitsAllocated: 8 }],
  ['rgb16', false, { samplesPerPixel: 3, bitsAllocated: 16 }],
  ['ybr-full', false, { samplesPerPixel: 3, bitsAllocated: 8, photometric: 'YBR_FULL' }],
  ['palette', false, { bitsAllocated: 8, photometric: 'PALETTE COLOR' }],
  ['monochrome1', false, { photometric: 'MONOCHROME1', bitsStored: 12 }],
  ['frames-u16', true, { frames: 4, bitsStored: 12, rescale: [1, -1024] }],
  ['frames-u8', true, { frames: 5, bitsAllocated: 8 }],
  ['high-bit-shifted', false, { bitsStored: 12, highBit: 14 }],
  ['overlay', false, { bitsStored: 12, extra: overlay }],
  ['padding', true, { bitsStored: 12, pixelRepresentation: 1, extra: [{ tag: 0x00280120, vr: 'SS', value: [-2000] }] }],
  ['s16-ct-float32', true, { pixelRepresentation: 1, rescale: [1, -1024] }],
  ['s32-fractional-float64', true, { bitsAllocated: 32, pixelRepresentation: 1, rescale: [0.5, 0.25] }],
  ['ct-fractional', true, { bitsStored: 12, rescale: [0.5, -0.25] }],
  ['ct-irrational', true, { pixelRepresentation: 1, rescale: [1.9413152, 0.1] }],
  ['ct-zero-slope', true, { pixelRepresentation: 1, rescale: [0, 7] }],
  ['enhanced-ct-uniform', true, { sopClassUid: SOP_CLASSES.EnhancedCT, frames: 3, frameRescales: [[2, -1], [2, -1], [2, -1]] }],
  ['enhanced-mr-fractional', true, { sopClassUid: SOP_CLASSES.EnhancedMR, modality: 'MR', frames: 2, frameRescales: [[0.3, 1], [0.3, 1]] }],
  ['enhanced-ct-differing', false, { sopClassUid: SOP_CLASSES.EnhancedCT, frames: 2, frameRescales: [[1, 0], [2, 0]] }],
  ...Object.entries(SOP_CLASSES).flatMap(
    ([name, sopClassUid]): Array<[string, boolean, NativePixelOptions]> => [
      [`${name}-integer-rescale`, true, { sopClassUid, bitsStored: 12, rescale: [3, -7] }],
      [`${name}-fractional-rescale`, true, { sopClassUid, pixelRepresentation: 1, rescale: [0.7, 2.5] }],
    ]
  ),
];

const NATIVE_SYNTAXES = new Set([IMPLICIT_LE, EXPLICIT_LE, EXPLICIT_BE]);

// Uncompressed public files decode natively, except the enhanced CT whose
// supplemental palette GDCM applies.
const corpusNative = (name: string, syntax: string) =>
  NATIVE_SYNTAXES.has(syntax) && !name.includes('eCT_Supplemental');

const cached = (names: string[]) =>
  names.map(
    (name) => [name, readFileSync(resolve(DATASET_CACHE, name))] as const
  );

const zipped = async (zip: string) => {
  const archive = await JSZip.loadAsync(
    readFileSync(resolve(DATASET_CACHE, zip))
  );
  const files = Object.values(archive.files).filter((file) => !file.dir);
  return Promise.all(
    files.map(
      async (file) =>
        [`${zip}/${file.name}`, await file.async('uint8array')] as const
    )
  );
};

/** Pages per source, each small enough to finish quickly under load. */
const PAGES = 16;

type ParityResult = {
  name: string;
  plan?: string;
  volume?: string;
  gdcm?: string;
  native?: string;
  mismatch?: string | null;
  rawMismatch?: string | null;
  error?: string;
};

describe('Native frame decoding parity with GDCM', () => {
  let fixture: Awaited<ReturnType<typeof startDicomConsumerFixtures>>;
  const expectedNative = new Map<string, boolean>();
  let cases: string[] = [];
  before(async () => {
    const files = [
      ...synthetic.map(
        ([name, , options], index) =>
          [name, nativePixelDicom({ ...options, instance: index + 1 })] as const
      ),
      ...cached(corpus.map(({ name }) => name)),
      ...cached(composition.datasets.map(({ name }) => name)),
      ...cached(['CT000085.dcm', 'minimal.dcm', 'retinal-oct.dcm']),
      ...cached(['US-MONO2-8-8x-echo.dcm', 'US_multiframe_30frames.dcm']),
      ...cached(['color3d_jpeg_baseline.dcm']),
      ...(await zipped('prostate.zip')),
      ...(await zipped('MRA-Head_and_Neck.zip')),
    ];
    cases = files.map(([name]) => name);
    synthetic.forEach(([name, native]) => expectedNative.set(name, native));
    corpus.forEach(({ name, transferSyntaxUID }) =>
      expectedNative.set(name, corpusNative(name, transferSyntaxUID))
    );
    // The two MR acquisitions are JPEG Lossless; the PET/CT files are not.
    composition.datasets.forEach(({ name }) =>
      expectedNative.set(name, name.startsWith('PET-CT-'))
    );
    files.forEach(([name]) => {
      if (!expectedNative.has(name))
        expectedNative.set(name, !/US_multiframe|jpeg_baseline/.test(name));
    });
    fixture = await startDicomConsumerFixtures(fixtureBytes(), {
      kinds: ['parity'],
      fixtures: {
        ...Object.fromEntries(files),
        'parity-cases.json': Buffer.from(JSON.stringify(cases)),
      },
    });
  });
  after(async () => fixture?.close());

  const pageSize = () => Math.ceil(cases.length / PAGES);
  const pageOf = (page: number) =>
    cases.slice(page * pageSize(), (page + 1) * pageSize());

  for (const source of ['file', 'http'])
    for (let page = 0; page < PAGES; page += 1)
      it(`writes the volume natively as GDCM does from ${source}, page ${page + 1}`, async () => {
        const wanted = pageOf(page);
        const from = page * pageSize();
        await openDicomConsumer(
          `${fixture.urls.parity}?source=${source}&from=${from}&to=${from + wanted.length}`
        );
        const results: ParityResult[] = JSON.parse(
          await $('#report').getText()
        );
        const unexpected = results.filter(
          (result) =>
            result.error ||
            result.mismatch ||
            result.rawMismatch ||
            (result.plan === 'frames') !== expectedNative.get(result.name) ||
            (result.plan === 'frames' && result.native !== result.volume)
        );
        expect(unexpected).toEqual([]);
        expect(results.map(({ name }) => name)).toEqual(wanted);
      });
});
