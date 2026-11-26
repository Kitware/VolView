import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import volumeCorpus from '../dicomVolumeCorpus.json';
import { GENERATED_CORPUS } from '../fixtures/dicom-pages/generatedCorpus';
import {
  CINE_US_DATASET,
  COLOR3D_JPEG_BASELINE_DICOM,
  MINIMAL_DICOM,
  MRA_HEAD_NECK_DATASET,
  ONE_CT_SLICE_DICOM,
  PROSTATEX_DATASET,
  RETINAL_OCT_DICOM,
  US_MULTIFRAME_DICOM,
} from '../datasets';
import { DATASET_CACHE } from '../downloadDatasets';
import { openDicomPage } from '../dicomPages';
import { startDicomPages } from '../fixtures/dicom-pages/server.mjs';
import {
  EXPLICIT_BE,
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
  WordSC: '1.2.840.10008.5.1.4.1.1.7.3',
};

const corpus: Array<{ id: string; name: string; generator?: string }> =
  volumeCorpus.datasets;

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
// The flag says whether the capability predicate must decode natively; the rest go to GDCM.
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
  ['monochrome1', true, { photometric: 'MONOCHROME1', bitsStored: 12 }],
  ['monochrome1-s16-bs12', true, { photometric: 'MONOCHROME1', bitsStored: 12, pixelRepresentation: 1 }],
  ['monochrome1-u8', true, { photometric: 'MONOCHROME1', bitsAllocated: 8 }],
  ['monochrome1-rescaled', true, { photometric: 'MONOCHROME1', bitsStored: 10, rescale: [2, -50] }],
  ['monochrome1-s16-ct', true, { photometric: 'MONOCHROME1', pixelRepresentation: 1, rescale: [1, -1024] }],
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
  ['dsc-large-slope', true, { rescale: [112067.85375182, 0] }],
  ['enhanced-ct-uniform', true, { sopClassUid: SOP_CLASSES.EnhancedCT, frames: 3, frameRescales: [[2, -1], [2, -1], [2, -1]] }],
  ['enhanced-mr-fractional', true, { sopClassUid: SOP_CLASSES.EnhancedMR, modality: 'MR', frames: 2, frameRescales: [[0.3, 1], [0.3, 1]] }],
  ['word-sc-functional-group-rescale', true, { sopClassUid: SOP_CLASSES.WordSC, frames: 2, rescale: [2, -1000], frameRescales: [[3, -500], [3, -500]] }],
  ['oct-differing-functional-group-rescale', true, { sopClassUid: SOP_CLASSES.OCT, frames: 2, frameRescales: [[1, 0], [2, 0]] }],
  ...Object.entries(SOP_CLASSES).flatMap(
    ([name, sopClassUid]): Array<[string, boolean, NativePixelOptions]> => [
      [`${name}-integer-rescale`, true, { sopClassUid, bitsStored: 12, rescale: [3, -7] }],
      [`${name}-fractional-rescale`, true, { sopClassUid, pixelRepresentation: 1, rescale: [0.7, 2.5] }],
    ]
  ),
];

/** One slice of an archive whose slices all share a pixel format. */
const firstSlice = async (zip: string) => {
  const archive = await JSZip.loadAsync(
    readFileSync(resolve(DATASET_CACHE, zip))
  );
  const [file] = Object.values(archive.files).filter((entry) => !entry.dir);
  return [`${zip}/${file.name}`, await file.async('uint8array')] as const;
};

// The public singles decode natively except the two compressed ultrasounds.
const publicPlan = (name: string) =>
  /US_multiframe|jpeg_baseline/.test(name) ? 'GDCM' : 'frames';

// Corpus files a codec decodes in place of GDCM, by the decoder that takes each.
const codecFiles = Object.entries({
  RLE: [
    'pydicom-MR_small_RLE',
    'pydicom-emri_small_RLE',
    'generated-rle-signed-frames',
    'generated-rle-rgb-frames',
    'generated-rle-32-bit',
  ],
  Deflated: ['pydicom-image_dfl'],
}).flatMap(([decoder, ids]) =>
  ids.map((id) => {
    const entry = corpus.find((dataset) => dataset.id === id);
    if (!entry) throw new Error(`No corpus entry ${id}`);
    return { decoder, ...entry };
  })
);

/** Pages small enough to finish quickly under load. */
const PAGES = 4;

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

describe('Decoding parity with GDCM', () => {
  let fixture: Awaited<ReturnType<typeof startDicomPages>>;
  const expectedPlan = new Map<string, string>();
  let cases: string[] = [];
  before(async () => {
    const publicFiles = [
      ...[
        ONE_CT_SLICE_DICOM,
        MINIMAL_DICOM,
        RETINAL_OCT_DICOM,
        CINE_US_DATASET,
        US_MULTIFRAME_DICOM,
        COLOR3D_JPEG_BASELINE_DICOM,
      ].map(
        ({ name }) =>
          [name, readFileSync(resolve(DATASET_CACHE, name))] as const
      ),
      await firstSlice(PROSTATEX_DATASET.name),
      await firstSlice(MRA_HEAD_NECK_DATASET.name),
    ];
    const codecCases = await Promise.all(
      codecFiles.map(
        async ({ name, generator }) =>
          [
            name,
            generator
              ? await GENERATED_CORPUS[generator]()
              : readFileSync(resolve(DATASET_CACHE, name)),
          ] as const
      )
    );
    const files = [
      ...synthetic.map(
        ([name, , options], index) =>
          [name, nativePixelDicom({ ...options, instance: index + 1 })] as const
      ),
      ...publicFiles,
      ...codecCases,
    ];
    cases = files.map(([name]) => name);
    synthetic.forEach(([name, native]) =>
      expectedPlan.set(name, native ? 'frames' : 'GDCM')
    );
    publicFiles.forEach(([name]) => expectedPlan.set(name, publicPlan(name)));
    codecFiles.forEach(({ name, decoder }) => expectedPlan.set(name, decoder));
    fixture = await startDicomPages({
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

  for (let page = 0; page < PAGES; page += 1)
    it(`writes the volume as GDCM does, page ${page + 1}`, async () => {
      const wanted = pageOf(page);
      const from = page * pageSize();
      await openDicomPage(
        `${fixture.urls.parity}?from=${from}&to=${from + wanted.length}`
      );
      const results: ParityResult[] = JSON.parse(await $('#report').getText());
      const unexpected = results.filter(
        (result) =>
          result.error ||
          result.mismatch ||
          result.rawMismatch ||
          result.plan !== expectedPlan.get(result.name) ||
          (result.plan !== 'GDCM' && result.native !== result.volume)
      );
      expect(unexpected).toEqual([]);
      expect(results.map(({ name }) => name)).toEqual(wanted);
    });
});
