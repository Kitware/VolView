import { describe, expect, it } from 'vitest';

import { hits, isTest, sourceFiles } from './sourceAudit';

// Guards the voxel accessor seam: production code reaches labelmap storage
// only through it. Tests keep their direct access on purpose: they assert on
// real vtkLabelMap state.

const SEGMENTATIONS_MODULE = 'src/store/segmentations.ts';
const PAINT_PROCESS_MODULE = 'src/store/tools/paintProcess.ts';
const RASTERIZE_TARGET_MODULE =
  'src/components/tools/polygon/rasterizeTarget.ts';

// The scalar reads left in the tool layer after routing, and why each one is
// not a read of stored labelmap voxels.
const ALLOWED_TOOL_SCALAR_READS = {
  // The parent image's intensities, for the paint threshold predicate.
  'src/store/tools/paint.ts': 1,
  // The ITK interpolation output, before it is handed back as a result.
  'src/store/tools/fillBetween.ts': 1,
  // A generic picker readout over whichever layer was sampled.
  'src/components/tools/ScalarProbe.vue': 1,
};

const countByFile = (found: string[]) =>
  found.reduce<Record<string, number>>((counts, hit) => {
    const rel = hit.slice(0, hit.lastIndexOf(':'));
    return { ...counts, [rel]: (counts[rel] ?? 0) + 1 };
  }, {});

describe('labelmap access audit', () => {
  const production = sourceFiles(import.meta.url, 'src').filter(
    (rel) => !isTest(rel)
  );

  it('keeps artifactIndex private to the segmentation store', () => {
    const consumers = production.filter((rel) => rel !== SEGMENTATIONS_MODULE);

    expect(hits(consumers, /\bartifactIndex\b/)).toEqual([]);
  });

  it('limits tool-layer scalar reads to the three non-labelmap ones', () => {
    const toolLayer = sourceFiles(
      import.meta.url,
      'src/store/tools',
      'src/components/tools'
    ).filter((rel) => !isTest(rel));

    expect(countByFile(hits(toolLayer, /getScalars\(\)/))).toEqual(
      ALLOWED_TOOL_SCALAR_READS
    );
  });

  it('hands no process a dummy label value', () => {
    expect(hits([PAINT_PROCESS_MODULE], /labelValue:\s*0\b/)).toEqual([]);
  });

  it('infers no artifact from a labelmap instance', () => {
    expect(hits(production, /findArtifactIdForLabelmap/)).toEqual([]);
  });

  it('rasterizes through the single edit entry point', () => {
    expect(hits([RASTERIZE_TARGET_MODULE], /resolveEditTarget/)).not.toEqual(
      []
    );
  });
});
