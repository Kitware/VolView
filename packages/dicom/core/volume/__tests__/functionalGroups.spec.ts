import { describe, expect, it } from 'vitest';
import type { DicomDataset } from '../../metadata/dicomDataset';
import {
  readGeometryFacts,
  readInstanceFacts,
} from '../../collections/instanceFacts';
import {
  planDicomCollections,
  IRREGULAR_VOLUME_WARNING,
  REPEATED_POSITIONS_WARNING,
  UNREADABLE_FRAME_GEOMETRY_WARNING,
  type DicomCollection,
} from '../../collections/planDicomCollections';
import type { Reconstruction } from '../../collections/reconstructVolume';
import { getFrameTag } from '../../metadata/functionalGroups';
import { instanceFor } from '@/tests/dicomDataset';
import { createDicomRuntime } from '../../runtime/createDicomRuntime';
import { fromBlob } from '../../source/byteSource';
import { allocateVolume, type Volume } from '../allocateVolume';
import { loadVolume } from '../loadVolume';
import { decodingWith, plannedUpdate } from '@/tests/dicomVolumeFixtures';
import type { IrregularGeometryPolicy } from '../volumeLayout';
import { datasetFromTags } from '../../../../../tests/dicomDataset';

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

const ONE_SLOT: Reconstruction = {
  kind: 'regular',
  sliceSpacing: null,
  slots: [0],
};

/** Allocates one instance against a supplied plan, as a planner would hand it. */
const allocate = (
  metadata: DicomDataset,
  policy: IrregularGeometryPolicy = 'preserve-order',
  { orientation = null, reconstruction = ONE_SLOT } = {} as Partial<
    Pick<DicomCollection, 'orientation' | 'reconstruction'>
  >
) =>
  allocateVolume(
    {
      kind: 'image',
      id: 'frames',
      collection: { orientation, reconstruction } as DicomCollection,
      members: [instanceFor(metadata)],
    },
    { irregularGeometry: policy }
  );

const indexToWorld = (volume: Volume, index: number[]) =>
  [0, 1, 2].map(
    (component) =>
      volume.origin[component] +
      index.reduce(
        (sum, step, axis) =>
          sum +
          step * volume.spacing[axis] * volume.direction[axis * 3 + component],
        0
      )
  );

const ctShared = () =>
  groups([
    sequence('00289110', [tags({ '00280030': '.388672\\.388672' })]),
    sequence('00209116', [tags({ '00200037': '-1\\0\\0\\0\\1\\0' })]),
    sequence('00289145', [tags({ '00281052': '-1024', '00281053': '1' })]),
  ]);

describe('enhanced volume Functional Groups', () => {
  it('places stored enhanced CT frames at their patient positions and preserves negative values', () => {
    const metadata = enhanced(ctShared(), [
      positioned('99.5\\-301.5\\-159'),
      positioned('99.5\\-301.5\\-149'),
    ]);
    const volume = allocate(metadata, 'reject');
    expect(volume.spacing).toEqual([0.388672, 0.388672, 10]);
    expect(indexToWorld(volume, [0, 0, 0])).toEqual([99.5, -301.5, -159]);
    expect(indexToWorld(volume, [0, 0, 1])).toEqual([99.5, -301.5, -149]);
    const buffer = volume.data;
    buffer[0] = -1024;
    buffer[4] = 172;
    expect([buffer[0], buffer[4]]).toEqual([-1024, 172]);
    expect(buffer).toBeInstanceOf(Float32Array);
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
    const volume = allocate(metadata, 'reject');
    expect(volume.spacing[2]).toBeCloseTo(1.33, 8);
    expect(indexToWorld(volume, [0, 0, 1])[0]).toBeCloseTo(-81.8877146, 7);
    expect(volume.direction[1]).toBeCloseTo(0.9762960207, 8);
    expect(volume.direction[5]).toBeCloseTo(-0.9762960207, 8);
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
    const decoded = new Float64Array([
      -1024, -1023, -1022, -1021, -499.5, -499, -498.5, -498,
    ]);
    let suppliedMetadata: DicomDataset | undefined;
    const runtime = createDicomRuntime({
      decodeConcurrency: 1,
      ...decodingWith(async ({ instance }) => {
        suppliedMetadata = instance.dataset;
        return { size: [2, 2, 2], components: 1, data: decoded };
      }),
    });
    const instance = instanceFor(metadata, fromBlob(new Blob(['pixels'])));
    const volume = allocateVolume(plannedUpdate([instance]));
    for await (const loaded of loadVolume(volume, {
      runtime,
      signal: new AbortController().signal,
    }))
      expect(loaded).not.toHaveProperty('error');
    runtime.dispose();
    expect(suppliedMetadata).toBe(metadata);
    expect(Array.from(volume.data)).toEqual(Array.from(decoded));
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
    const { data } = allocate(metadata);
    expect(data).toBeInstanceOf(Float32Array);
    data[0] = -1023.5;
    expect(data[0]).toBe(-1023.5);
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
      expect(allocate(metadata).dimensions).toEqual([2, 2, 3]);
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
    expect(allocate(metadata).spacing).toEqual([0.01174168, 0.001955034, 1]);
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

  it.each([1, -1])(
    'preserves stored frame direction %s through registration and image allocation',
    (direction) => {
      const positions = [0, 1, 2].map((index) => 10 + direction * index * 3);
      const instance = instanceFor(
        enhanced(
          ctShared(),
          positions.map((z) => positioned(`1\\2\\${z}`))
        )
      );
      const volume = allocateVolume(plannedUpdate([instance]));
      expect(volume.spacing[2]).toBe(3);
      positions.forEach((z, index) =>
        expect(indexToWorld(volume, [0, 0, index])).toEqual([1, 2, z])
      );
    }
  );

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
    expect(() => allocate(metadata, 'reject', collection)).toThrow(
      'irregular DICOM geometry'
    );
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
    (positions, reason, warning) => {
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
      const volume = allocate(metadata, 'preserve-order', {
        orientation: collection.orientation,
      });
      expect(volume.reconstruction).toEqual(collection.reconstruction);
      expect(volume.dimensions).toEqual([2, 2, 3]);
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
  it.each(['00200032', '00200037', '00280030', '00180088'])(
    'displays NM frames when Type 2 geometry %s is empty',
    (tag) => {
      const metadata = nmMetadata();
      const detector = metadata.elements.find(
        (element) => element.tag === '00540022'
      )!.values;
      const source =
        (tag === '00200032' || tag === '00200037') &&
        detector.kind === 'sequence'
          ? detector.items[0]
          : metadata;
      source.elements = source.elements.map((element) =>
        element.tag === tag ? tags({ [tag]: '' }).elements[0] : element
      );
      const volume = allocate(metadata);
      const { spatialMetadata } = volume;
      expect(volume.dimensions).toEqual([2, 2, 3]);
      if (tag === '00200032') {
        expect(volume.origin).toEqual([0, 0, 0]);
        expect(spatialMetadata.notes.join(' ')).toContain('zero origin');
      } else if (tag === '00200037') {
        expect(volume.direction).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        expect(spatialMetadata.notes.join(' ')).toContain('default axes');
      } else {
        const axis = tag === '00280030' ? 0 : 2;
        expect(volume.spacing[axis]).toBe(1);
        expect(spatialMetadata.axes[axis].status).toBe('fallback');
      }
      if (tag !== '00180088') expect(volume.spacing[2]).toBe(4.7951998710632);
    }
  );

  it.each([-1, 1])(
    'uses the detector plane and signed NM slice progression %s',
    (sign) => {
      const volume = allocate(
        nmMetadata({ '00180088': String(sign * 4.7951998710632) }),
        'reject'
      );
      expect(volume.spacing).toEqual([
        4.7951998710632, 4.7951998710632, 4.7951998710632,
      ]);
      expect(volume.origin).toEqual([4, 5, 6]);
      expect(indexToWorld(volume, [0, 0, 2])[2]).toBeCloseTo(
        6 + sign * 2 * 4.7951998710632,
        10
      );
    }
  );

  it('retains one NM detector plane when Type 2 slice spacing is unknown', () => {
    const metadata = nmMetadata({
      '00280008': '1',
      '00540081': '1',
      '00540080': '1',
      '00180088': '',
    });
    const volume = allocate(metadata, 'reject');
    expect(volume.origin).toEqual([4, 5, 6]);
    expect(volume.spacing).toEqual([4.7951998710632, 4.7951998710632, 1]);
    expect(volume.direction).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
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
