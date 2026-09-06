import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { reactive } from 'vue';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import type { MessageOptions } from '@/src/store/messages';
import { debug } from '@/src/utils/loggers';

const writeDatasets = (stateFile: StateFile) => {
  stateFile.manifest.datasets = [{ id: 'dataset-1', dataSourceId: 1 }];
  stateFile.manifest.dataSources = [{ id: 1, type: 'uri', uri: '/dataset-1' }];
};

const writeOneInvalidArtifact = async (stateFile: StateFile) => {
  (stateFile.manifest as any).segmentationArtifacts = reactive([
    {
      id: 'valid-artifact',
      dataSourceId: 1,
      parentImage: 'dataset-1',
      name: 'Valid artifact',
    },
    // Neither `path` nor `dataSourceId`: nothing resolves its bytes.
    {
      id: 'invalid-artifact',
      parentImage: 'dataset-1',
      name: 'Invalid artifact',
    },
  ]);
};

const recordWarnings = () => {
  const warnings: Array<{ title: string; options: MessageOptions }> = [];
  return {
    warnings,
    addWarning: (title: string, options: MessageOptions) => {
      warnings.push({ title, options });
    },
  };
};

import {
  MANIFEST,
  MANIFEST_VERSION,
  normalizeManifest,
  serialize,
} from '@/src/io/state-file/serialize';

const manifestWithSelection = (primarySelection: string): Manifest => ({
  version: MANIFEST_VERSION,
  datasets: [{ id: 'dataset-1', dataSourceId: 1 }],
  dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
  primarySelection,
});

/** One segmentation on dataset-1 whose only segment binds to `artifactId`. */
const segmentationBoundTo = (artifactId: string) => ({
  id: 'seg-1',
  name: 'Seg',
  parentImage: 'dataset-1',
  order: ['segment-1'],
  segments: [
    {
      id: 'segment-1',
      typeId: 'type-1',
      visible: true,
      locked: false,
      representations: {
        labelmap: { artifactId, labelValue: 1, extent: [0, 1, 0, 1, 0, 1] },
      },
    },
  ],
});

describe('state-file serialization resilience', () => {
  it('writes a restorable zip when one manifest entry is malformed', async () => {
    const sink = recordWarnings();
    const blob = await serialize({
      writers: [writeDatasets, writeOneInvalidArtifact],
      addWarning: sink.addWarning,
    });
    const zip = await JSZip.loadAsync(blob);
    const manifest = JSON.parse(await zip.file(MANIFEST)!.async('string'));

    expect(manifest.segmentationArtifacts).toHaveLength(1);
    expect(manifest.segmentationArtifacts[0].id).toBe('valid-artifact');
    expect(sink.warnings).toEqual([
      {
        title: 'Some session content could not be saved',
        options: expect.objectContaining({ persist: true }),
      },
    ]);
  });

  it('aborts when the core dataset graph is incoherent', () => {
    const manifest: Manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'dataset-1', dataSourceId: 99 }],
      dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
    };

    expect(() => normalizeManifest(manifest, new JSZip())).toThrow(
      /data source 99 is missing/
    );
  });

  it('omits invalid optional dependents and their archive members', () => {
    const zip = new JSZip();
    zip.file('segmentations/orphan.vti', 'bytes');
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'dataset-1', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
      segmentationArtifacts: [
        {
          id: 'orphan',
          path: 'segmentations/orphan.vti',
          parentImage: 'missing-dataset',
          name: 'Orphan',
        },
      ],
      segmentations: [
        {
          id: 'orphan-segmentation',
          name: 'Orphan',
          parentImage: 'missing-dataset',
          segments: [],
          order: [],
        },
      ],
      parentToLayers: [
        { selectionKey: 'dataset-1', sourceSelectionKeys: ['missing-layer'] },
      ],
    } as unknown as Manifest;

    const normalized = normalizeManifest(manifest, zip) as any;
    expect(normalized.manifest.segmentationArtifacts).toEqual([]);
    expect(normalized.manifest.segmentations).toEqual([]);
    expect(normalized.manifest.parentToLayers).toEqual([]);
    expect(zip.file('segmentations/orphan.vti')).toBeNull();
    expect(normalized.omitted.join('\n')).toMatch(
      /parent dataset|layer relationship/
    );
  });

  it('omits an artifact whose archive member is missing', () => {
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'dataset-1', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
      segmentationArtifacts: [
        {
          id: 'artifact-1',
          path: 'segmentations/gone.vti',
          parentImage: 'dataset-1',
          name: 'Gone',
        },
      ],
    } as unknown as Manifest;

    const normalized = normalizeManifest(manifest, new JSZip()) as any;
    expect(normalized.manifest.segmentationArtifacts).toEqual([]);
    expect(normalized.omitted.join('\n')).toMatch(/archive member/);
  });

  it('omits an artifact whose data source is missing', () => {
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'dataset-1', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
      segmentationArtifacts: [
        {
          id: 'artifact-1',
          dataSourceId: 99,
          parentImage: 'dataset-1',
          name: 'Dangling',
        },
      ],
    } as unknown as Manifest;

    const normalized = normalizeManifest(manifest, new JSZip()) as any;
    expect(normalized.manifest.segmentationArtifacts).toEqual([]);
    expect(normalized.omitted.join('\n')).toMatch(/data source 99 is missing/);
  });

  it('omits the complete view layout when viewByID is invalid', () => {
    const manifest = {
      ...manifestWithSelection('dataset-1'),
      activeView: 'view-1',
      isActiveViewMaximized: true,
      layout: {
        direction: 'column',
        items: [{ type: 'slot', slotIndex: 0 }],
      },
      layoutSlots: ['view-1'],
      viewByID: {
        'view-1': {
          id: 'view-1',
          type: '2D',
          dataID: 'dataset-1',
          name: 'Axial',
          options: { orientation: 1 },
        },
      },
    } as unknown as Manifest;

    const normalized = normalizeManifest(manifest, new JSZip());

    expect(normalized.manifest).not.toHaveProperty('viewByID');
    expect(normalized.manifest).not.toHaveProperty('activeView');
    expect(normalized.manifest).not.toHaveProperty('isActiveViewMaximized');
    expect(normalized.manifest).not.toHaveProperty('layout');
    expect(normalized.manifest).not.toHaveProperty('layoutSlots');
    expect(normalized.omitted).toContain('view/layout: invalid viewByID state');
  });

  it('does NOT re-walk cascade-owned optional references', () => {
    // Referential integrity of view / tool / crop / paint / selection ids is
    // owned by the synchronous remove cascade (datasetRemoveCascade.spec.ts),
    // and a stale id is harmless on restore (deserialize remaps and ignores
    // misses). So a dangling reference here passes through untouched rather than
    // being stripped — this pins that deliberate scope reduction. Only the core
    // graph, segment groups, and layer relationships are policed at save time.
    const manifest = manifestWithSelection('ghost-dataset');

    const normalized = normalizeManifest(manifest, new JSZip());
    expect(normalized.manifest.primarySelection).toBe('ghost-dataset');
    expect(normalized.omitted).toEqual([]);
  });

  it('warns (dev-only) when a dangling cascade-owned reference reaches save', () => {
    // The dev/test cascade-gap backstop should FLAG a dangling reference the
    // remove cascade was supposed to have cleaned — a store missing an
    // onImageDeleted registration — but it is warn-only: it must not mutate the
    // manifest.
    const warnSpy = vi.spyOn(debug, 'warn').mockImplementation(() => {});
    const manifest = manifestWithSelection('ghost-dataset');

    const normalized = normalizeManifest(manifest, new JSZip());

    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/ghost-dataset/);
    expect(normalized.manifest.primarySelection).toBe('ghost-dataset');
    expect(normalized.omitted).toEqual([]);

    warnSpy.mockRestore();
  });

  it('does not warn when every optional reference resolves', () => {
    // A fully coherent manifest must not trip the cascade-gap backstop —
    // guards against false-positive warnings on healthy sessions.
    const warnSpy = vi.spyOn(debug, 'warn').mockImplementation(() => {});
    const manifest = manifestWithSelection('dataset-1');

    const normalized = normalizeManifest(manifest, new JSZip());

    expect(warnSpy).not.toHaveBeenCalled();
    expect(normalized.omitted).toEqual([]);

    warnSpy.mockRestore();
  });

  it('round-trips a locked record, its registry and the selection', () => {
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'dataset-1', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
      segmentationArtifacts: [
        {
          id: 'artifact-1',
          dataSourceId: 1,
          parentImage: 'dataset-1',
          name: 'Artifact',
        },
      ],
      segmentations: [
        {
          id: 'segmentation-1',
          name: 'CT',
          parentImage: 'dataset-1',
          segments: [
            {
              id: 'segment-1',
              typeId: 'type-1',
              representations: {
                labelmap: {
                  artifactId: 'artifact-1',
                  labelValue: 1,
                  extent: [0, 3, 0, 3, 0, 3],
                },
              },
            },
          ],
          order: ['segment-1'],
        },
      ],
      segmentTypes: [
        {
          id: 'type-1',
          name: 'Segment 1',
          color: [255, 0, 0, 255],
          visible: true,
          locked: true,
        },
      ],
      selectedSegmentType: 'type-1',
    } as unknown as Manifest;

    const normalized = normalizeManifest(manifest, new JSZip()) as any;
    const segmentation = normalized.manifest.segmentations[0];
    expect(segmentation.segments[0].typeId).toBe('type-1');
    expect(segmentation.segments[0].representations.labelmap).toEqual({
      artifactId: 'artifact-1',
      labelValue: 1,
      extent: [0, 3, 0, 3, 0, 3],
    });
    // The registry and the selection survive normalization beside the records.
    // Lock rides on the type, so the record is storage and nothing else.
    expect(normalized.manifest.segmentTypes).toEqual([
      {
        id: 'type-1',
        name: 'Segment 1',
        color: [255, 0, 0, 255],
        visible: true,
        locked: true,
      },
    ]);
    expect(normalized.manifest.selectedSegmentType).toBe('type-1');
  });

  it('unbinds a segment whose artifact was omitted', () => {
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'dataset-1', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
      segmentationArtifacts: [
        {
          id: 'artifact-1',
          path: 'segmentations/gone.vti',
          parentImage: 'dataset-1',
          name: 'Gone',
        },
      ],
      segmentations: [segmentationBoundTo('artifact-1')],
    } as unknown as Manifest;

    const normalized = normalizeManifest(manifest, new JSZip()) as any;

    expect(normalized.manifest.segmentationArtifacts).toEqual([]);
    expect(
      normalized.manifest.segmentations[0].segments[0].representations
    ).toEqual({});
    expect(normalized.omitted.join('\n')).toMatch(
      /segmentation artifact artifact-1 is missing/
    );
  });

  it('unbinds a segment whose artifact belongs to another image', () => {
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [
        { id: 'dataset-1', dataSourceId: 1 },
        { id: 'dataset-2', dataSourceId: 2 },
      ],
      dataSources: [
        { id: 1, type: 'uri', uri: '/dataset-1' },
        { id: 2, type: 'uri', uri: '/dataset-2' },
      ],
      segmentationArtifacts: [
        {
          id: 'artifact-2',
          dataSourceId: 2,
          parentImage: 'dataset-2',
          name: 'Other image',
        },
      ],
      segmentations: [segmentationBoundTo('artifact-2')],
    } as unknown as Manifest;

    const normalized = normalizeManifest(manifest, new JSZip()) as any;

    // The artifact itself is valid, so it stays; only the binding across
    // images goes.
    expect(normalized.manifest.segmentationArtifacts).toHaveLength(1);
    expect(
      normalized.manifest.segmentations[0].segments[0].representations
    ).toEqual({});
    expect(normalized.omitted.join('\n')).toMatch(
      /segmentation artifact artifact-2 belongs to dataset-2/
    );
  });

  // The backstop exists to catch a store that left a reference behind, not to
  // report normalization's own pruning. Spying on debug.warn keeps this
  // deterministic; the warning otherwise depends on which modules a vitest
  // worker happened to load.
  describe('orphan backstop scope', () => {
    const manifestBoundTo = (artifactId: string) =>
      ({
        version: MANIFEST_VERSION,
        datasets: [{ id: 'dataset-1', dataSourceId: 1 }],
        dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
        segmentationArtifacts: [
          {
            id: 'declared-artifact',
            path: 'segmentations/gone.vti',
            parentImage: 'dataset-1',
            name: 'Gone',
          },
        ],
        segmentations: [segmentationBoundTo(artifactId)],
      }) as unknown as Manifest;

    const warningsFrom = async (manifest: Manifest) => {
      await import('@/src/store/segmentations');
      const warn = vi.spyOn(debug, 'warn').mockImplementation(() => {});
      normalizeManifest(manifest, new JSZip());
      const messages = warn.mock.calls.map((call) => String(call[0]));
      warn.mockRestore();
      return messages.join('\n');
    };

    it('does not blame the cascade for an artifact normalization pruned', async () => {
      // 'declared-artifact' is in the manifest but its archive member is gone,
      // so normalization drops it and unbinds the segment. Not a cascade bug.
      expect(
        await warningsFrom(manifestBoundTo('declared-artifact'))
      ).not.toMatch(/declared-artifact/);
    });

    it('still reports a binding to an artifact no store ever declared', async () => {
      expect(await warningsFrom(manifestBoundTo('never-declared'))).toMatch(
        /never-declared/
      );
    });
  });
});
