import { describe, expect, it } from 'vitest';

import {
  ImageSegments,
  ManifestSchema,
  SegmentationArtifact,
} from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

// Provenance rides on the artifact record, which is where persistent labelmap
// identity lives in the wire schema; segment identity lives on the image's
// segments.

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

const segment = {
  id: 'segment-1',
  name: 'Bin 1',
  color: [255, 0, 0, 255],
  visible: true,
  locked: false,
  labelmap: { path: 'mask.vti', extent: [0, 3, 0, 3, 0, 1] },
};

const entry = { imageId: 'img-1', segments: [segment] };

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
      imageSegments: [entry],
    };
    const parsed = ManifestSchema.parse(manifest);
    expect(parsed.segmentationArtifacts![0].source).toEqual(
      artifactWithSource.source
    );
    expect(parsed.imageSegments).toEqual([entry]);
  });
});

describe('image segments wire shape', () => {
  it('carries each segment with its labelmap', () => {
    expect(ImageSegments.parse(entry)).toEqual(entry);
  });

  it.each([{ path: 'mask.vti', artifactId: 'artifact-1' }, {}])(
    'rejects a labelmap with ambiguous or missing storage %j',
    (storage) => {
      const parsed = ManifestSchema.safeParse({
        version: MANIFEST_VERSION,
        dataSources: [],
        imageSegments: [
          {
            ...entry,
            segments: [
              {
                ...segment,
                labelmap: { ...storage, extent: [0, 3, 0, 3, 0, 1] },
              },
            ],
          },
        ],
      });
      expect(parsed.success).toBe(false);
    }
  );

  it('defaults a segment to visible and unlocked', () => {
    const [parsed] = ImageSegments.parse({
      imageId: 'img-1',
      segments: [{ id: 'segment-1', name: 'Bin 1', color: [255, 0, 0, 255] }],
    }).segments;

    expect(parsed.visible).toBe(true);
    expect(parsed.locked).toBe(false);
  });

  it('saves only labelmaps that own an archive entry', () => {
    const parsed = ImageSegments.safeParse({
      ...entry,
      segments: [
        {
          ...segment,
          labelmap: { artifactId: 'artifact-1', extent: [0, 3, 0, 3, 0, 1] },
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('manifest version', () => {
  it('writes the image segment ownership version', () => {
    expect(MANIFEST_VERSION).toBe('9.0.0');
  });
});
