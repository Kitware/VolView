import { describe, expect, it } from 'vitest';

import {
  Segment,
  ManifestSchema,
  Segmentation,
  SegmentationArtifact,
} from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

// Provenance rides on the artifact record, which is where persistent labelmap
// identity lives in the 7.0.0 wire schema; segment identity lives on the
// segmentation.

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
      id: 'mask-1',
      segmentId: 'segment-1',
      representations: {
        labelmap: {
          path: 'mask.vti',
          extent: [0, 3, 0, 3, 0, 1],
        },
      },
    },
  ],
  order: ['mask-1'],
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
  it('carries the mask id, its segment and the order', () => {
    const parsed = Segmentation.parse(segmentation);
    expect(parsed.masks[0].id).toBe('mask-1');
    expect(parsed.masks[0].segmentId).toBe('segment-1');
    expect(parsed.masks[0].representations.labelmap).toEqual({
      path: 'mask.vti',
      extent: [0, 3, 0, 3, 0, 1],
    });
    expect(parsed.order).toEqual(['mask-1']);
  });

  it.each([{ path: 'mask.vti', artifactId: 'artifact-1' }, {}])(
    'rejects a mask binding with ambiguous or missing storage %j',
    (storage) => {
      const parsed = ManifestSchema.safeParse({
        version: MANIFEST_VERSION,
        dataSources: [],
        segments,
        segmentations: [
          {
            ...segmentation,
            masks: [
              {
                ...segmentation.masks[0],
                representations: {
                  labelmap: { ...storage, extent: [0, 3, 0, 3, 0, 1] },
                },
              },
            ],
          },
        ],
      });
      expect(parsed.success).toBe(false);
    }
  );

  it('defaults a segment to visible and unlocked', () => {
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

describe('manifest version', () => {
  // The segment model replaces `segmentGroups` with `segmentations` plus
  // `segmentationArtifacts`, including display state in that breaking change.
  it('pins MANIFEST_VERSION at 7.0.0', () => {
    expect(MANIFEST_VERSION).toBe('7.0.0');
  });
});
