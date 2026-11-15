import { describe, expect, it } from 'vitest';
import type { DicomDataset } from '../../metadata/dicomDataset';
import { getFrameTag } from '../../metadata/functionalGroups';
import { readGeometryFacts, readInstanceDetails } from '../instanceFacts';
import {
  planDicomCollections,
  IRREGULAR_VOLUME_WARNING,
  REPEATED_POSITIONS_WARNING,
  UNREADABLE_FRAME_GEOMETRY_WARNING,
} from '../planDicomCollections';
import {
  ctShared,
  enhanced,
  groups,
  positioned,
  sequence,
  sharedPlaneTemporal,
  tags,
} from '../../volume/__tests__/enhancedFixture';

const collectionOf = (metadata: DicomDataset) =>
  planDicomCollections({
    seriesKey: 'frames',
    instances: [readInstanceDetails(metadata).facts],
  })[0];

describe('multiframe geometry', () => {
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

  it('plans shared-plane temporal frames as irregular, with a warning', () => {
    const metadata = sharedPlaneTemporal();
    const collection = collectionOf(metadata);
    expect(collection.reconstruction.kind).toBe('irregular');
    expect(collection.warnings).toContain(UNREADABLE_FRAME_GEOMETRY_WARNING);
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
    });
    expect(collection.warnings).toContain(UNREADABLE_FRAME_GEOMETRY_WARNING);
  });

  it.each([
    [[0, 1, 3], 'uneven-slice-spacing', IRREGULAR_VOLUME_WARNING],
    [[0, 0, 2], 'repeated-position', REPEATED_POSITIONS_WARNING],
  ] as const)(
    'reports intra-instance geometry %s',
    (positions, reason, warning) => {
      const metadata = enhanced(
        ctShared(),
        positions.map((z) => positioned(`0\\0\\${z}`))
      );
      const collection = collectionOf(metadata);
      expect(collection.reconstruction).toMatchObject({
        kind: 'irregular',
        reason,
      });
      expect(collection.warnings).toContain(warning);
    }
  );

  it('does not report normal segment-major SEG frames as an irregular volume', () => {
    const metadata = enhanced(
      ctShared(),
      [0, 1, 0, 1].map((z) => positioned(`0\\0\\${z}`)),
      { '00080060': 'SEG' }
    );
    expect(collectionOf(metadata).warnings).toEqual([]);
  });
});
