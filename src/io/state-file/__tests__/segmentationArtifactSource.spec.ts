import { describe, expect, it } from 'vitest';

import {
  Segment,
  ManifestSchema,
  Segmentation,
  SegmentationArtifact,
} from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

// Ported from segmentGroupSource.spec.ts. Provenance now rides on the artifact
// record, which is where persistent labelmap identity lives in the 7.0.0 wire
// schema; segment identity lives on the segmentation.

const baseArtifact = {
  id: 'artifact-1',
  parentImage: 'img-1',
  name: 'Otsu result',
  path: 'segmentations/Otsu result.vti',
};

const artifactWithSource = {
  ...baseArtifact,
  source: {
    providerId: 'analysis-provider',
    jobId: 'job-abc',
    outputId: 'outputLabelmap',
  },
};

const segmentation = {
  id: 'segmentation-1',
  name: 'CT Chest',
  parentImage: 'img-1',
  masks: [
    {
      id: 'segment-1',
      segmentId: 'segment-1',
      visible: true,
      locked: false,
      representations: {
        labelmap: {
          artifactId: 'artifact-1',
          extent: [0, 3, 0, 3, 0, 1],
        },
      },
    },
  ],
  order: ['segment-1'],
};

const segments = [
  {
    id: 'segment-1',
    name: 'Bin 1',
    color: [255, 0, 0, 255],
    visible: true,
    locked: false,
  },
];

describe('SegmentationArtifact.source', () => {
  it('accepts and round-trips structured provenance', () => {
    const parsed = SegmentationArtifact.parse(artifactWithSource);
    expect(parsed.source).toEqual(artifactWithSource.source);
  });

  it('is optional for a hand-painted artifact without source', () => {
    expect(() => SegmentationArtifact.parse(baseArtifact)).not.toThrow();
    expect(SegmentationArtifact.parse(baseArtifact).source).toBeUndefined();
  });

  it('rejects a source missing one identity component', () => {
    const bad = {
      ...artifactWithSource,
      source: { providerId: 'analysis-provider', jobId: 'job-abc' },
    };
    expect(SegmentationArtifact.safeParse(bad).success).toBe(false);
  });

  it('requires either an archive path or a dataSourceId', () => {
    const { id, parentImage, name } = baseArtifact;
    const withoutPath = { id, parentImage, name };
    expect(SegmentationArtifact.safeParse(withoutPath).success).toBe(false);
    expect(
      SegmentationArtifact.safeParse({ ...withoutPath, dataSourceId: 7 })
        .success
    ).toBe(true);
  });

  it('survives a full manifest parse (round-trips the .volview.zip)', () => {
    const manifest = {
      version: MANIFEST_VERSION,
      dataSources: [],
      segmentationArtifacts: [artifactWithSource],
      segmentations: [segmentation],
      segments,
    };
    const parsed = ManifestSchema.parse(manifest) as any;
    expect(parsed.segmentationArtifacts[0].source).toEqual(
      artifactWithSource.source
    );
    expect(parsed.segments).toEqual(segments);
    expect(parsed.segmentations[0].masks[0].segmentId).toBe('segment-1');
  });
});

describe('Segmentation wire shape', () => {
  it('carries the mask id, its type and the order', () => {
    const parsed = Segmentation.parse(segmentation);
    expect(parsed.masks[0].id).toBe('segment-1');
    expect(parsed.masks[0].segmentId).toBe('segment-1');
    expect(parsed.masks[0].representations.labelmap).toEqual({
      artifactId: 'artifact-1',
      extent: [0, 3, 0, 3, 0, 1],
    });
    expect(parsed.order).toEqual(['segment-1']);
  });

  it('defaults a type to visible and unlocked', () => {
    const parsed = Segment.parse({
      id: 'segment-1',
      name: 'Bin 1',
      color: [255, 0, 0, 255],
    });

    expect(parsed.visible).toBe(true);
    expect(parsed.locked).toBe(false);
  });

  it('allows a mask with no labelmap binding', () => {
    const parsed = Segmentation.parse({
      ...segmentation,
      masks: [{ id: 'mask-1', segmentId: 'segment-1', representations: {} }],
    });
    expect(parsed.masks[0].representations.labelmap).toBeUndefined();
  });

  it('rejects a mask that names no segment', () => {
    const parsed = Segmentation.safeParse({
      ...segmentation,
      masks: [{ id: 'mask-1', representations: {} }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('paint wire block', () => {
  it('no longer carries a segment group id or a label value', () => {
    const parsed = ManifestSchema.parse({
      version: MANIFEST_VERSION,
      dataSources: [],
      tools: {
        paint: {
          activeSegmentGroupID: 'sg-1',
          activeSegment: 3,
          brushSize: 5,
          crossPlaneSync: true,
        },
      },
    });
    expect(parsed.tools?.paint).toEqual({ brushSize: 5, crossPlaneSync: true });
  });
});

describe('manifest version', () => {
  // The segment model replaces `segmentGroups` with `segmentations` plus
  // `segmentationArtifacts`, including display state in that breaking change.
  it('pins MANIFEST_VERSION at 7.0.0', () => {
    expect(MANIFEST_VERSION).toBe('7.0.0');
  });
});
