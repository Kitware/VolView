import { describe, expect, it, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { ManifestSchema } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import { useRulerStore } from '@/src/store/tools/rulers';

// ---------------------------------------------------------------------------
// The optional structured `source` on an annotation tool is the durable
// idempotency identity that stops a restored job result from being applied twice.
// It only works if it survives the `.volview.zip` — and the manifest schema
// strips unknown keys on parse, so "does it round-trip" is the whole test.
// ---------------------------------------------------------------------------

const source = {
  providerId: 'analysis-provider',
  jobId: 'job-abc',
  outputId: 'outputAnnotations',
};

const ruler = (extra: Record<string, unknown> = {}) => ({
  imageID: 'img-1',
  frameOfReference: { planeOrigin: [0, 0, 5], planeNormal: [0, 0, 1] },
  slice: 5,
  firstPoint: [1, 1, 5],
  secondPoint: [4, 4, 5],
  name: 'Long axis',
  ...extra,
});

const manifestWith = (tools: Record<string, unknown>) => ({
  version: MANIFEST_VERSION,
  dataSources: [],
  tools,
});

describe('annotation tool source', () => {
  it('round-trips a source through a full manifest parse', () => {
    const parsed = ManifestSchema.parse(
      manifestWith({
        rulers: { tools: [ruler({ source })], labels: {} },
      })
    );
    expect(parsed.tools?.rulers?.tools[0].source).toEqual(source);
  });

  it('round-trips on rectangles and polygons too', () => {
    const parsed = ManifestSchema.parse(
      manifestWith({
        rectangles: { tools: [ruler({ source })], labels: {} },
        polygons: {
          tools: [
            {
              imageID: 'img-1',
              frameOfReference: {
                planeOrigin: [0, 0, 3],
                planeNormal: [0, 0, 1],
              },
              slice: 3,
              points: [
                [1, 1, 3],
                [5, 1, 3],
                [3, 5, 3],
              ],
              source,
            },
          ],
          labels: {},
        },
      })
    );
    expect(parsed.tools?.rectangles?.tools[0].source).toEqual(source);
    expect(parsed.tools?.polygons?.tools[0].source).toEqual(source);
  });

  it('is optional — a hand-placed tool has none', () => {
    const parsed = ManifestSchema.parse(
      manifestWith({ rulers: { tools: [ruler()], labels: {} } })
    );
    expect(parsed.tools?.rulers?.tools[0].source).toBeUndefined();
  });

  it('rejects a source missing one identity component', () => {
    const bad = manifestWith({
      rulers: {
        tools: [ruler({ source: { providerId: 'p', jobId: 'j' } })],
        labels: {},
      },
    });
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  // The annotation `source` field is additive-optional, so 6.4.0 remains the
  // current manifest version and passes through untouched.
  it('passes a 6.4.0 manifest without touching its tools', () => {
    const old = JSON.stringify({
      version: '6.4.0',
      dataSources: [],
      tools: { rulers: { tools: [ruler()], labels: {} } },
    });
    const migrated = migrateManifest(old);
    expect(migrated.version).toBe(MANIFEST_VERSION);
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
    expect(migrated.tools.rulers.tools[0]).toEqual(ruler());
  });
});

describe('annotation tool source — store serialize/restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('survives serializeTools -> manifest parse -> deserializeTools', () => {
    const store = useRulerStore();
    store.addTool({ ...ruler({ source, placing: false }) } as never);

    const serialized = store.serializeTools();
    const parsed = ManifestSchema.parse(manifestWith({ rulers: serialized }))
      .tools!.rulers!;
    expect(parsed.tools[0].source).toEqual(source);

    setActivePinia(createPinia());
    const restored = useRulerStore();
    restored.deserializeTools(parsed as never, { 'img-1': 'img-2' });

    const [id] = restored.toolIDs;
    expect(restored.toolByID[id].source).toEqual(source);
    expect(restored.toolByID[id].imageID).toBe('img-2');
  });
});
