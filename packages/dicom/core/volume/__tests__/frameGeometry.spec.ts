import { describe, expect, it } from 'vitest';
import type { DicomDataset } from '../../metadata/dicomDataset';
import { readGeometryFacts } from '../../collections/instanceFacts';
import { instanceFor } from '@/tests/dicomDataset';
import { createDicomRuntime } from '../../runtime/createDicomRuntime';
import { fromBlob } from '../../source/byteSource';
import { allocateVolume, type Volume } from '../allocateVolume';
import { loadVolume } from '../loadVolume';
import { decodingWith, plannedUpdate } from '@/tests/dicomVolumeFixtures';
import {
  ctShared,
  enhanced,
  groups,
  positioned,
  sequence,
  sharedPlaneTemporal,
  tags,
} from './enhancedFixture';

/** Plans one instance and allocates the volume it fills. */
const allocate = (metadata: DicomDataset) =>
  allocateVolume(plannedUpdate([instanceFor(metadata)]));

/** The planned reconstruction's kind and, when irregular, its reason. */
const reconstructionOf = (metadata: DicomDataset) => {
  const planned = plannedUpdate([instanceFor(metadata)]).collection
    .reconstruction;
  return planned.kind === 'irregular'
    ? { kind: planned.kind, reason: planned.reason }
    : { kind: planned.kind };
};

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

describe('enhanced volume Functional Groups', () => {
  it('places stored enhanced CT frames at their patient positions in a buffer that holds negative values', () => {
    const metadata = enhanced(ctShared(), [
      positioned('99.5\\-301.5\\-159'),
      positioned('99.5\\-301.5\\-149'),
    ]);
    const volume = allocate(metadata);
    expect(reconstructionOf(metadata)).toEqual({ kind: 'regular' });
    expect(volume.spacing).toEqual([0.388672, 0.388672, 10]);
    expect(indexToWorld(volume, [0, 0, 0])).toEqual([99.5, -301.5, -159]);
    expect(indexToWorld(volume, [0, 0, 1])).toEqual([99.5, -301.5, -149]);
    expect(volume.data).toBeInstanceOf(Float32Array);
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
    const volume = allocate(metadata);
    expect(reconstructionOf(metadata)).toEqual({ kind: 'regular' });
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
    expect(allocate(metadata).data).toBeInstanceOf(Float32Array);
  });

  it.each([
    ['repeated-position', [0, 0, 2]],
    ['uneven-slice-spacing', [0, 1, 3]],
  ])(
    'keeps %s frames in stored order and reports the reason',
    (reason, positions) => {
      const metadata = enhanced(
        ctShared(),
        positions.map((z) => positioned(`0\\0\\${z}`))
      );
      const volume = allocate(metadata);
      expect(reconstructionOf(metadata)).toEqual({
        kind: 'irregular',
        reason,
      });
      expect(volume.dimensions).toEqual([2, 2, 3]);
    }
  );

  it('reports changing frame orientation as unreadable instead of claiming a regular lattice', () => {
    const second = positioned('0\\0\\1');
    second.elements.push(
      sequence('00209116', [tags({ '00200037': '0\\1\\0\\1\\0\\0' })])
    );
    expect(
      reconstructionOf(enhanced(ctShared(), [positioned('0\\0\\0'), second]))
    ).toEqual({ kind: 'irregular', reason: 'unreadable-geometry' });
  });

  it('reports changing pixel spacing and temporal frames as irregular', () => {
    const changedSpacing = positioned('0\\0\\1');
    changedSpacing.elements.push(
      sequence('00289110', [tags({ '00280030': '2\\2' })])
    );
    expect(
      reconstructionOf(
        enhanced(ctShared(), [positioned('0\\0\\0'), changedSpacing])
      )
    ).toEqual({ kind: 'irregular', reason: 'mixed-pixel-spacing' });
    const temporal = [0, 1].map((index) => {
      const frame = positioned(`0\\0\\${index}`);
      frame.elements.push(
        sequence('00209111', [tags({ '00209128': String(index + 1) })])
      );
      return frame;
    });
    expect(reconstructionOf(enhanced(ctShared(), temporal))).toEqual({
      kind: 'irregular',
      reason: 'unreadable-geometry',
    });
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

  it('reports shared-plane temporal frames as irregular', () => {
    const metadata = sharedPlaneTemporal();
    expect(reconstructionOf(metadata).kind).toBe('irregular');
  });

  it.each([1, -1])(
    'preserves stored frame direction %s through registration and image allocation',
    (direction) => {
      const positions = [0, 1, 2].map((index) => 10 + direction * index * 3);
      const volume = allocate(
        enhanced(
          ctShared(),
          positions.map((z) => positioned(`1\\2\\${z}`))
        )
      );
      expect(volume.spacing[2]).toBe(3);
      positions.forEach((z, index) =>
        expect(indexToWorld(volume, [0, 0, index])).toEqual([1, 2, z])
      );
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
      expect(volume.dimensions).toEqual([2, 2, 3]);
      if (tag === '00200032') expect(volume.origin).toEqual([0, 0, 0]);
      else if (tag === '00200037')
        expect(volume.direction).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      else expect(volume.spacing[tag === '00280030' ? 0 : 2]).toBe(1);
      if (tag !== '00180088') expect(volume.spacing[2]).toBe(4.7951998710632);
    }
  );

  it.each([-1, 1])(
    'uses the detector plane and signed NM slice progression %s',
    (sign) => {
      const volume = allocate(
        nmMetadata({ '00180088': String(sign * 4.7951998710632) })
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
    const volume = allocate(metadata);
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

it('reports a missing NM NumberOfSlices without claiming temporal dimensions', () => {
  const metadata = nmMetadata();
  metadata.elements = metadata.elements.filter((el) => el.tag !== '00540081');
  expect(() => allocate(metadata)).toThrow('without NumberOfSlices');
});
