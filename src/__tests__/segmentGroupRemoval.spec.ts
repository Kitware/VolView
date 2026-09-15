import { describe, expect, it } from 'vitest';

import { exists, hits, isTest, read, sourceFiles } from './sourceAudit';

// Source-level checks keep deleted group infrastructure from returning.

const SCALAR_PROBE = 'src/components/tools/ScalarProbe.vue';
const SEGMENTATION_REPRESENTATION =
  'src/components/vtk/VtkSegmentationSliceRepresentation.vue';

const DELETED = [
  'src/store/segmentGroups.ts',
  'src/store/view-configs/segmentGroups.ts',
  'src/components/SegmentGroupControls.vue',
  'src/components/SegmentGroupOpacity.vue',
];

/** Production source: a member kept alive only by its own spec is still dead. */
const production = sourceFiles(import.meta.url, 'src').filter(
  (rel) => !isTest(rel)
);

describe('the group layer is deleted', () => {
  it.each(DELETED)('has no %s', (rel) => {
    expect(exists(rel)).toBe(false);
  });

  it('has no production reference to the group store', () => {
    expect(hits(production, /useSegmentGroupStore/)).toEqual([]);
    expect(hits(production, /store\/segmentGroups'/)).toEqual([]);
  });

  it('has no production reference to the per-view group config', () => {
    expect(
      hits(production, /useSegmentGroupConfigStore|useGlobalSegmentGroupConfig/)
    ).toEqual([]);
    expect(hits(production, /view-configs\/segmentGroups'/)).toEqual([]);
  });

  it('has no per-parent artifact order left to keep in step', () => {
    expect(hits(production, /artifactOrderByParent|artifactsForImage/)).toEqual(
      []
    );
  });

  it('leaves no spec asserting against the deleted module', () => {
    const specs = sourceFiles(import.meta.url, 'src').filter(isTest);
    expect(hits(specs, /store\/segmentGroups'|useSegmentGroupStore/)).toEqual(
      []
    );
  });
});

describe('the value-keyed projection has one publisher', () => {
  it('reads segment names from the store projection in the probe', () => {
    const source = read(SCALAR_PROBE);
    expect(source).toContain('labelmapDescriptorByMask');
    // A computed label-value key would duplicate the store projection.
    expect(source).not.toMatch(/\[[^\]]*labelValue[^\]]*\]\s*:/);
  });

  it('declares the outline settings once, on the segment model', () => {
    // The segment model is the sole owner of outline settings.
    expect(hits(production, /SegmentGroupConfig/)).toEqual([]);
    expect(read(SEGMENTATION_REPRESENTATION)).toMatch(/outlineThickness/);
  });
});
