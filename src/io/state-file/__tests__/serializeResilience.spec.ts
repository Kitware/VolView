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

const writeOneInvalidMask = async (stateFile: StateFile) => {
  stateFile.zip.file('valid.vti', 'bytes');
  (stateFile.manifest as any).segmentations = reactive([
    segmentationWithPath('valid.vti'),
    { id: 'invalid', name: 'Invalid segmentation' },
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

const segmentationWithPath = (path: string) => ({
  id: 'seg-1',
  name: 'Seg',
  parentImage: 'dataset-1',
  order: ['mask-1'],
  masks: [
    {
      id: 'mask-1',
      segmentId: 'segment-1',
      representations: {
        labelmap: { path, extent: [0, 1, 0, 1, 0, 1] },
      },
    },
  ],
});

describe('state-file serialization resilience', () => {
  it('writes a restorable zip when one manifest entry is malformed', async () => {
    const sink = recordWarnings();
    const blob = await serialize({
      writers: [writeDatasets, writeOneInvalidMask],
      addWarning: sink.addWarning,
    });
    const zip = await JSZip.loadAsync(blob);
    const manifest = JSON.parse(await zip.file(MANIFEST)!.async('string'));

    expect(manifest.segmentationArtifacts).toBeUndefined();
    expect(manifest.segmentations).toHaveLength(1);
    expect(
      manifest.segmentations[0].masks[0].representations.labelmap.path
    ).toBe('valid.vti');
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

  it('omits a segmentation and layer relationship with missing parents', () => {
    const manifest = {
      ...manifestWithSelection('dataset-1'),
      segmentations: [
        { ...segmentationWithPath('mask.vti'), parentImage: 'missing' },
      ],
      parentToLayers: [
        { selectionKey: 'dataset-1', sourceSelectionKeys: ['missing'] },
      ],
    } as unknown as Manifest;
    const zip = new JSZip();
    zip.file('mask.vti', 'voxels');
    const normalized = normalizeManifest(manifest, zip);
    expect(normalized.manifest.segmentations).toEqual([]);
    expect(zip.file('mask.vti')).toBeNull();
    expect(normalized.manifest.parentToLayers).toEqual([]);
    expect(normalized.omitted.join('\n')).toMatch(/parent dataset/);
  });

  it('reports a missing mask file without losing its segment identity', () => {
    const manifest = {
      ...manifestWithSelection('dataset-1'),
      segmentations: [segmentationWithPath('missing.vti')],
    } as unknown as Manifest;
    const normalized = normalizeManifest(manifest, new JSZip());
    expect(normalized.manifest.segmentations![0].masks[0]).toMatchObject({
      id: 'mask-1',
      segmentId: 'segment-1',
      representations: {},
    });
    expect(normalized.omitted.join('\n')).toContain(
      'archive member missing.vti is missing'
    );
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
      segmentations: [
        {
          id: 'segmentation-1',
          name: 'CT',
          parentImage: 'dataset-1',
          masks: [
            {
              id: 'segment-1',
              segmentId: 'segment-1',
              representations: {
                labelmap: {
                  path: 'mask.vti',
                  extent: [0, 3, 0, 3, 0, 3],
                },
              },
            },
          ],
          order: ['segment-1'],
        },
      ],
      segments: [
        {
          id: 'segment-1',
          name: 'Segment 1',
          color: [255, 0, 0, 255],
          visible: true,
          locked: true,
        },
      ],
      selectedSegment: 'segment-1',
    } as unknown as Manifest;

    const zip = new JSZip();
    zip.file('mask.vti', 'bytes');
    const normalized = normalizeManifest(manifest, zip) as any;
    const segmentation = normalized.manifest.segmentations[0];
    expect(segmentation.masks[0].segmentId).toBe('segment-1');
    expect(segmentation.masks[0].representations.labelmap).toEqual({
      path: 'mask.vti',
      extent: [0, 3, 0, 3, 0, 3],
    });
    // The registry and the selection survive normalization beside the records.
    // Lock rides on the type, so the record is storage and nothing else.
    expect(normalized.manifest.segments).toEqual([
      {
        id: 'segment-1',
        name: 'Segment 1',
        color: [255, 0, 0, 255],
        visible: true,
        locked: true,
      },
    ]);
    expect(normalized.manifest.selectedSegment).toBe('segment-1');
  });

  it('saves no import instructions', () => {
    const manifest = {
      ...manifestWithSelection('dataset-1'),
      segmentationArtifacts: [
        {
          id: 'input',
          parentImage: 'dataset-1',
          name: 'Input',
          dataSourceId: 1,
        },
      ],
    };
    expect(
      normalizeManifest(manifest, new JSZip()).manifest
    ).not.toHaveProperty('segmentationArtifacts');
  });
});
