import { describe, expect, it } from 'vitest';

import { exists, hits, isTest, read, sourceFiles } from './sourceAudit';

// ---------------------------------------------------------------------------
// The residual group infrastructure is GONE, not merely unreferenced.
//
// C2-C4 moved every consumer onto the segment model, so what is left of the
// group layer is a shell: a store keyed by group, a per-view group config that
// nothing writes and that the segment model already serializes, and the two
// components that drove them. Deleting a module is only real when nothing
// imports it, so these assertions are the exit greps, run by the suite instead
// of by hand.
//
// The identity audit is folded in here: it is a hand-rolled analyzer over the
// module this checkpoint deletes, so it cannot be left asserting against a file
// that is gone. Replacing it with `knip` or `ts-prune` in CI is out of scope for
// this phase and stays a tracked follow-up.
// ---------------------------------------------------------------------------

const IDENTITY_AUDIT = 'src/__tests__/segmentIdentityAudit.spec.ts';
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
    // Retired or re-pointed, but never left analyzing a file that is gone.
    const specs = sourceFiles(import.meta.url, 'src').filter(isTest);
    expect(hits(specs, /store\/segmentGroups'|useSegmentGroupStore/)).toEqual(
      []
    );
    expect(
      exists(IDENTITY_AUDIT) ? hits([IDENTITY_AUDIT], /segmentGroups/) : []
    ).toEqual([]);
  });
});

describe('the value-keyed projection has one publisher', () => {
  it('reads segment names from the store projection in the probe', () => {
    const source = read(SCALAR_PROBE);
    expect(source).toContain('labelmapSegmentsByArtifact');
    // No second map from label value to a segment's display fields: a computed
    // key on a label value is the signature of rebuilding what the store
    // already publishes.
    expect(source).not.toMatch(/\[[^\]]*labelValue[^\]]*\]\s*:/);
  });

  it('declares the outline settings once, on the segment model', () => {
    // The per-view group config and the segmentation's own outline fields were
    // two copies of the same setting; the model is the one that round trips, so
    // the view-config shape goes with the store that held it.
    expect(hits(production, /SegmentGroupConfig/)).toEqual([]);
    // The renderer still applies an outline; it just reads the surviving copy.
    expect(read(SEGMENTATION_REPRESENTATION)).toMatch(/outlineThickness/);
  });
});
