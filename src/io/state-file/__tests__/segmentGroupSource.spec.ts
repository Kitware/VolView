import { describe, expect, it } from 'vitest';

import {
  ManifestSchema,
  SegmentGroupMetadata,
} from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

// The optional `source: {providerId, jobId, outputId}` provenance tag on
// SegmentGroupMetadata — the durable job-history idempotency key that must round-trip the
// `.volview.zip`.

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
  it('accepts and round-trips a source provenance tag', () => {
    const parsed = SegmentGroupMetadata.parse(metadataWithSource);
    expect(parsed.source).toEqual({
      providerId: 'analysis-provider',
      jobId: 'job-abc',
      outputId: 'outputLabelmap',
    });
  });

  it('is optional — a hand-painted group without source still validates', () => {
    expect(() => SegmentGroupMetadata.parse(baseMetadata)).not.toThrow();
    expect(SegmentGroupMetadata.parse(baseMetadata).source).toBeUndefined();
  });

  it('rejects a malformed source (missing outputId)', () => {
    const bad = {
      ...metadataWithSource,
      source: { providerId: 'analysis-provider', jobId: 'job-abc' },
    };
    expect(SegmentGroupMetadata.safeParse(bad).success).toBe(false);
  });

  it('rejects a source without provider identity', () => {
    const bad = {
      ...metadataWithSource,
      source: { jobId: 'job-abc', outputId: 'outputLabelmap' },
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
    expect(parsed.segmentGroups?.[0].metadata.source).toEqual({
      providerId: 'analysis-provider',
      jobId: 'job-abc',
      outputId: 'outputLabelmap',
    });
  });
});

describe('manifest version / migration bump', () => {
  it('pins MANIFEST_VERSION at 6.4.0', () => {
    expect(MANIFEST_VERSION).toBe('6.4.0');
  });

  it('migrates a 6.3.0 manifest to 6.4.0, preserving segment groups', () => {
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
    expect(migrated.version).toBe('6.4.0');
    expect(migrated.segmentGroups).toHaveLength(1);
    // An old manifest lacking `source` still validates (additive-optional).
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });
});
