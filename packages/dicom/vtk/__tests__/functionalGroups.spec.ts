import { describe, expect, it } from 'vitest';
import type { DicomDataset } from '../../core';
import {
  Chunk,
  readGeometryFacts,
  readInstanceFacts,
  planDicomCollections,
  IRREGULAR_VOLUME_WARNING,
  REPEATED_POSITIONS_WARNING,
  UNREADABLE_FRAME_GEOMETRY_WARNING,
} from '../../core';
import { VtkDicomImage } from '../VtkDicomImage';
import { getFrameTag } from '../../core/metadata/functionalGroups';
import { allocateImageFromChunks } from '../allocateImageFromChunks';
import { datasetFromTags } from '../../../../tests/dicomDataset';

const tags = (values: Record<string, string>) =>
  datasetFromTags(Object.entries(values));

function sequence(tag: string, items: DicomDataset[]) {
  return {
    tag,
    group: parseInt(tag.slice(0, 4), 16),
    element: parseInt(tag.slice(4), 16),
    vr: 'SQ',
    values: { kind: 'sequence' as const, items },
  };
}

const groups = (items: Array<ReturnType<typeof sequence>>): DicomDataset => ({
  specificCharacterSet: null,
  elements: items,
});

function enhanced(
  shared: DicomDataset,
  frames: DicomDataset[],
  root: Record<string, string> = {}
): DicomDataset {
  const header = tags({
    '00280010': '2',
    '00280011': '2',
    '00280008': String(frames.length),
    '00280101': '16',
    ...root,
  });
  return {
    ...header,
    elements: [
      ...header.elements,
      sequence('52009229', [shared]),
      sequence('52009230', frames),
    ],
  };
}

const positioned = (position: string) =>
  groups([sequence('00209113', [tags({ '00200032': position })])]);

const allocate = (
  metadata: DicomDataset,
  policy: 'reject' | 'preserve-order' = 'preserve-order'
) =>
  allocateImageFromChunks(
    [{ metadata } as Chunk],
    null,
    { kind: 'regular', sliceSpacing: null, slots: [0] },
    policy
  ).image;

const ctShared = () =>
  groups([
    sequence('00289110', [tags({ '00280030': '.388672\\.388672' })]),
    sequence('00209116', [tags({ '00200037': '-1\\0\\0\\0\\1\\0' })]),
    sequence('00289145', [tags({ '00281052': '-1024', '00281053': '1' })]),
  ]);

async function loadedMetadata(metadata: DicomDataset) {
  const chunk = new Chunk({
    metaLoader: { meta: metadata, load() {}, stop() {} },
    dataLoader: { data: new Blob(['pixels']), load() {}, stop() {} },
  });
  await chunk.loadMeta();
  await chunk.loadData();
  return chunk;
}

const completed = (volume: VtkDicomImage) =>
  new Promise<void>((resolve) => {
    const listener = (status: string) => {
      if (status !== 'complete') return;
      volume.removeEventListener('status', listener);
      resolve();
    };
    volume.addEventListener('status', listener);
  });

describe('enhanced volume Functional Groups', () => {
  it('places stored enhanced CT frames at their patient positions and preserves negative values', () => {
    const metadata = enhanced(ctShared(), [
      positioned('99.5\\-301.5\\-159'),
      positioned('99.5\\-301.5\\-149'),
    ]);
    const image = allocate(metadata, 'reject');
    expect(image.getSpacing()).toEqual([0.388672, 0.388672, 10]);
    expect(image.indexToWorld([0, 0, 0])).toEqual([99.5, -301.5, -159]);
    expect(image.indexToWorld([0, 0, 1])).toEqual([99.5, -301.5, -149]);
    const buffer = image.getPointData().getScalars().getData();
    buffer[0] = -1024;
    buffer[4] = 172;
    expect([buffer[0], buffer[4]]).toEqual([-1024, 172]);
    expect(buffer).toBeInstanceOf(Int32Array);
    image.delete();
  });

  it('uses the storage direction for an oblique enhanced MR stack', () => {
    const metadata = enhanced(
      groups([
        sequence('00289110', [tags({ '00280030': '1\\1' })]),
        sequence('00209116', [
          tags({
            '00200037':
              '0\\0.9762960207\\-0.2164395526\\0\\-0.2164395526\\-0.9762960207',
          }),
        ]),
      ]),
      [
        positioned('-83.2177146\\-123.869376\\159.934076'),
        positioned('-81.8877146\\-123.869376\\159.934076'),
      ]
    );
    const image = allocate(metadata, 'reject');
    expect(image.getSpacing()[2]).toBeCloseTo(1.33, 8);
    expect(image.indexToWorld([0, 0, 1])[0]).toBeCloseTo(-81.8877146, 7);
    expect(image.getDirection()[1]).toBeCloseTo(0.9762960207, 8);
    expect(image.getDirection()[5]).toBeCloseTo(-0.9762960207, 8);
    image.delete();
  });

  it('unions per-frame calibration and lets capable custom decoders preserve it', async () => {
    const frames = [
      groups([
        sequence('00289145', [tags({ '00281053': '1', '00281052': '-1024' })]),
      ]),
      groups([
        sequence('00289145', [tags({ '00281053': '.5', '00281052': '-500' })]),
      ]),
    ];
    const metadata = enhanced(groups([]), frames);
    const chunk = await loadedMetadata(metadata);
    let suppliedMetadata: DicomDataset | undefined;
    const volume = new VtkDicomImage({
      readDicomImage: async (_file, header) => {
        suppliedMetadata = header;
        return {
          image: {
            size: [2, 2, 2],
            imageType: { components: 1 },
            data: new Float64Array([
              -1024, -1023, -1022, -1021, -499.5, -499, -498.5, -498,
            ]),
          },
        };
      },
    });
    const done = completed(volume);
    await volume.setChunks([chunk], null);
    await done;
    expect(suppliedMetadata).toBe(metadata);
    expect(
      volume.getVtkImageData().getPointData().getScalars().getData()
    ).toEqual(
      new Float64Array([-1024, -1023, -1022, -1021, -499.5, -499, -498.5, -498])
    );
    volume.dispose();
  });

  it('accepts shared and per-frame calibration with equal numeric values', () => {
    const metadata = enhanced(
      groups([
        sequence('00289145', [tags({ '00281053': '.5', '00281052': '-1024' })]),
      ]),
      [
        groups([]),
        groups([
          sequence('00289145', [
            tags({
              '00281053': '0.500\u0000',
              '00281052': '-1024.0\u0000',
            }),
          ]),
        ]),
      ]
    );
    const image = allocate(metadata);
    const buffer = image.getPointData().getScalars().getData();
    expect(buffer).toBeInstanceOf(Float64Array);
    buffer[0] = -1023.5;
    expect(buffer[0]).toBe(-1023.5);
    image.delete();
  });

  it.each([
    ['repeated-position', [0, 0, 2]],
    ['uneven-slice-spacing', [0, 1, 3]],
  ])(
    'honors the irregular geometry policy for %s frames',
    (reason, positions) => {
      const metadata = enhanced(
        ctShared(),
        positions.map((z) => positioned(`0\\0\\${z}`))
      );
      expect(() => allocate(metadata, 'reject')).toThrow(reason);
      const image = allocate(metadata);
      expect(image.getDimensions()).toEqual([2, 2, 3]);
      image.delete();
    }
  );

  it('rejects changing frame orientation instead of claiming a regular lattice', () => {
    const second = positioned('0\\0\\1');
    second.elements.push(
      sequence('00209116', [tags({ '00200037': '0\\1\\0\\1\\0\\0' })])
    );
    expect(() =>
      allocate(enhanced(ctShared(), [positioned('0\\0\\0'), second]), 'reject')
    ).toThrow('unreadable-geometry');
  });

  it('rejects changing pixel spacing and temporal frames under the regular geometry policy', () => {
    const changedSpacing = positioned('0\\0\\1');
    changedSpacing.elements.push(
      sequence('00289110', [tags({ '00280030': '2\\2' })])
    );
    expect(() =>
      allocate(
        enhanced(ctShared(), [positioned('0\\0\\0'), changedSpacing]),
        'reject'
      )
    ).toThrow('mixed-pixel-spacing');
    const temporal = [0, 1].map((index) => {
      const frame = positioned(`0\\0\\${index}`);
      frame.elements.push(
        sequence('00209111', [tags({ '00209128': String(index + 1) })])
      );
      return frame;
    });
    expect(() => allocate(enhanced(ctShared(), temporal), 'reject')).toThrow(
      'unreadable-geometry'
    );
  });

  it('reads OCT in-plane calibration without using optical depth of field as frame separation', () => {
    const metadata = enhanced(
      groups([
        sequence('00289110', [
          tags({
            '00280030': '.001955034\\.01174168\u0000',
            '00180050': '.002',
          }),
        ]),
      ]),
      [groups([]), groups([])]
    );
    const image = allocate(metadata);
    expect(image.getSpacing()).toEqual([0.01174168, 0.001955034, 1]);
    image.delete();
  });

  it('reads exact macro paths without changing raw tags or importing referenced-image geometry', () => {
    const metadata = enhanced(ctShared(), [positioned('1\\2\\3')], {
      '00280030': '9\\9',
    });
    metadata.elements.push(
      sequence('00081140', [tags({ '00200037': '0\\1\\0\\0\\0\\1' })])
    );
    const before = JSON.stringify(metadata);
    expect(readGeometryFacts(metadata)).toEqual({
      orientation: [-1, 0, 0, 0, 1, 0],
      position: [1, 2, 3],
      pixelSpacing: [0.388672, 0.388672],
    });
    expect(getFrameTag(metadata, '00280030')).toBe('.388672\\.388672');
    expect(JSON.stringify(metadata)).toBe(before);
    const rootOnly = tags({ '00280030': '2\\3' });
    rootOnly.elements.push(
      sequence('00081140', [tags({ '00200037': '0\\1\\0\\0\\0\\1' })])
    );
    expect(readGeometryFacts(rootOnly).orientation).toBeNull();
  });
});

describe('intra-instance frame planning', () => {
  const collectionOf = (metadata: DicomDataset) =>
    planDicomCollections({
      seriesKey: 'frames',
      instances: [readInstanceFacts(metadata)],
    }).collections[0];

  it('rejects shared-plane temporal frames under strict geometry validation', () => {
    const shared = ctShared();
    shared.elements.push(
      sequence('00209113', [tags({ '00200032': '10\\20\\30' })])
    );
    const metadata = enhanced(
      shared,
      [1, 2].map((time) =>
        groups([sequence('00209111', [tags({ '00209128': String(time) })])])
      )
    );
    const collection = collectionOf(metadata);
    expect(collection.reconstruction).toMatchObject({
      kind: 'irregular',
      slots: [0],
    });
    expect(collection.warnings).toContain(UNREADABLE_FRAME_GEOMETRY_WARNING);
    expect(() =>
      allocateImageFromChunks(
        [{ metadata } as Chunk],
        collection.orientation,
        collection.reconstruction,
        'reject'
      )
    ).toThrow('irregular DICOM geometry');
  });

  it('keeps an unreadable frame geometry warning for a lone multiframe source', () => {
    const metadata = enhanced(
      ctShared(),
      [1, 2].map((index) =>
        groups([sequence('00209111', [tags({ '00209057': String(index) })])])
      )
    );
    const collection = collectionOf(metadata);
    expect(collection.reconstruction).toMatchObject({
      kind: 'irregular',
      reason: 'unreadable-geometry',
      slots: [0],
    });
    expect(collection.warnings).toContain(UNREADABLE_FRAME_GEOMETRY_WARNING);
  });

  it.each([
    [[0, 1, 3], 'uneven-slice-spacing', IRREGULAR_VOLUME_WARNING],
    [[0, 0, 2], 'repeated-position', REPEATED_POSITIONS_WARNING],
  ] as const)(
    'reports intra-instance geometry %s while retaining one source slot',
    async (positions, reason, warning) => {
      const metadata = enhanced(
        ctShared(),
        positions.map((z) => positioned(`0\\0\\${z}`))
      );
      const collection = collectionOf(metadata);
      expect(collection.reconstruction).toMatchObject({
        kind: 'irregular',
        reason,
        slots: [0],
      });
      expect(collection.warnings).toContain(warning);
      const volume = new VtkDicomImage({
        readDicomImage: async () => ({
          image: {
            size: [2, 2, 3],
            data: new Int32Array(12),
            imageType: { components: 1 },
          },
        }),
      });
      const done = completed(volume);
      await volume.setChunks(
        [await loadedMetadata(metadata)],
        collection.orientation,
        {
          kind: 'regular',
          sliceSpacing: null,
          slots: [0],
        }
      );
      await done;
      expect(volume.getReconstruction()).toEqual(collection.reconstruction);
      expect(volume.getVtkImageData().getDimensions()).toEqual([2, 2, 3]);
      volume.dispose();
    }
  );
});

function nmMetadata(overrides: Record<string, string> = {}) {
  const metadata = tags({
    '00080016': '1.2.840.10008.5.1.4.1.1.20',
    '00080008': 'ORIGINAL\\PRIMARY\\RECON TOMO\\EMISSION',
    '00280010': '2',
    '00280011': '2',
    '00280008': '3',
    '00280101': '16',
    '00280030': '4.7951998710632\\4.7951998710632',
    '00180088': '-4.7951998710632',
    '00540021': '1',
    '00540081': '3',
    '00540080': '1\\2\\3',
    ...overrides,
  });
  metadata.elements.push(
    sequence('00540022', [
      tags({
        '00200032': '4\\5\\6',
        '00200037': '1\\0\\0\\0\\1\\0',
      }),
    ])
  );
  metadata.elements.push({
    tag: '00280009',
    group: 0x0028,
    element: 0x0009,
    vr: 'AT',
    values: {
      kind: 'attributeTag',
      values: [{ group: 0x0054, element: 0x0080 }],
    },
  });
  return metadata;
}

describe('reconstructed NM spatial volumes', () => {
  it.each([-1, 1])(
    'uses the detector plane and signed NM slice progression %s',
    (sign) => {
      const image = allocate(
        nmMetadata({ '00180088': String(sign * 4.7951998710632) }),
        'reject'
      );
      expect(image.getSpacing()).toEqual([
        4.7951998710632, 4.7951998710632, 4.7951998710632,
      ]);
      expect(image.getOrigin()).toEqual([4, 5, 6]);
      expect(image.indexToWorld([0, 0, 2])[2]).toBeCloseTo(
        6 + sign * 2 * 4.7951998710632,
        10
      );
      image.delete();
    }
  );

  it('retains one NM detector plane when Type 2 slice spacing is unknown', () => {
    const metadata = nmMetadata({
      '00280008': '1',
      '00540081': '1',
      '00540080': '1',
      '00180088': '',
    });
    const image = allocate(metadata, 'reject');
    expect(image.getOrigin()).toEqual([4, 5, 6]);
    expect(image.getSpacing()).toEqual([4.7951998710632, 4.7951998710632, 1]);
    expect(image.getDirection()).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    image.delete();
  });

  it('rejects a gated acquisition instead of treating time slots as additional slices', () => {
    const metadata = nmMetadata({
      '00080008': 'ORIGINAL\\PRIMARY\\RECON GATED TOMO\\EMISSION',
      '00280008': '264',
      '00540081': '33',
      '00540071': '8',
    });
    expect(() => allocate(metadata)).toThrow(
      'Unsupported NM volume with multiple spatial/time dimensions'
    );
  });

  it.each(['1\\3\\2', '1\\2\\2', '1\\2'])(
    'rejects nonsequential NM frame ordering %s',
    (indices) => {
      expect(() => allocate(nmMetadata({ '00540080': indices }))).toThrow(
        'slice indices'
      );
    }
  );

  it('rejects hidden nonspatial indices even when the frame count matches the slice count', () => {
    expect(() => allocate(nmMetadata({ '00540070': '1\\1\\2' }))).toThrow(
      'multiple spatial/time dimensions'
    );
  });

  it('does not infer a spatial volume from multiple detectors or unrelated nested coordinates', () => {
    expect(() => allocate(nmMetadata({ '00540021': '2' }))).toThrow(
      'detectors'
    );
    const metadata = nmMetadata();
    metadata.elements = metadata.elements.filter(
      (element) => element.tag !== '00540022'
    );
    metadata.elements.push(
      sequence('00081140', [
        tags({
          '00200032': '1\\2\\3',
          '00200037': '1\\0\\0\\0\\1\\0',
        }),
      ])
    );
    expect(readGeometryFacts(metadata).position).toBeNull();
    expect(() => allocate(metadata)).toThrow('detectors');
  });
});

it('does not report normal segment-major SEG frames as an irregular volume', () => {
  const metadata = enhanced(
    ctShared(),
    [0, 1, 0, 1].map((z) => positioned('0\\0\\' + z)),
    { '00080060': 'SEG' }
  );
  const plan = planDicomCollections({
    seriesKey: 'seg',
    instances: [readInstanceFacts(metadata)],
  });
  expect(plan.collections[0].warnings).toEqual([]);
});

it('reports a missing NM NumberOfSlices without claiming temporal dimensions', () => {
  const metadata = nmMetadata();
  metadata.elements = metadata.elements.filter((el) => el.tag !== '00540081');
  expect(() => allocate(metadata)).toThrow('without NumberOfSlices');
});
