import { describe, expect, it } from 'vitest';

import {
  ManifestSchema,
  SegmentGroupMetadata,
} from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

// The optional structured `source` on SegmentGroupMetadata is the durable
// idempotency identity that must round-trip the `.volview.zip`.

const baseMetadata = {
  name: 'Otsu result',
  parentImage: 'img-1',
  segments: {
    order: [1],
    byValue: {
      '1': { value: 1, name: 'Bin 1', color: [255, 0, 0, 255], visible: true },
    },
  },
};

const metadataWithSource = {
  ...baseMetadata,
  source: {
    providerId: 'analysis-provider',
    jobId: 'job-abc',
    outputId: 'outputLabelmap',
  },
};

describe('SegmentGroupMetadata.source', () => {
  it('accepts and round-trips structured provenance', () => {
    const parsed = SegmentGroupMetadata.parse(metadataWithSource);
    expect(parsed.source).toEqual(metadataWithSource.source);
  });

  it('is optional — a hand-painted group without source still validates', () => {
    expect(() => SegmentGroupMetadata.parse(baseMetadata)).not.toThrow();
    expect(SegmentGroupMetadata.parse(baseMetadata).source).toBeUndefined();
  });

  it('rejects a source missing one identity component', () => {
    const bad = {
      ...metadataWithSource,
      source: {
        providerId: 'analysis-provider',
        jobId: 'job-abc',
      },
    };
    expect(SegmentGroupMetadata.safeParse(bad).success).toBe(false);
  });

  it('survives a full manifest parse (round-trips the .volview.zip)', () => {
    const manifest = {
      version: MANIFEST_VERSION,
      dataSources: [],
      segmentGroups: [
        { id: 'sg-1', dataSourceId: 7, metadata: metadataWithSource },
      ],
    };
    const parsed = ManifestSchema.parse(manifest);
    expect(parsed.segmentGroups?.[0].metadata.source).toEqual(
      metadataWithSource.source
    );
  });
});

describe('manifest version / migration bump', () => {
  // Annotation provenance is additive to the structured segment-group source
  // already covered by 6.4.0, so it needs no stamp-only version bump.
  it('keeps MANIFEST_VERSION at 6.4.0', () => {
    expect(MANIFEST_VERSION).toBe('6.4.0');
  });

  it('migrates a 6.3.0 manifest to the current version, preserving segment groups', () => {
    const old = JSON.stringify({
      version: '6.3.0',
      dataSources: [],
      segmentGroups: [
        {
          id: 'sg-1',
          dataSourceId: 7,
          metadata: {
            name: 'Painted',
            parentImage: 'img-1',
            segments: { order: [], byValue: {} },
          },
        },
      ],
    });
    const migrated = migrateManifest(old);
    expect(migrated.version).toBe(MANIFEST_VERSION);
    expect(migrated.segmentGroups).toHaveLength(1);
    // An old manifest lacking `source` still validates (additive-optional).
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });
});
