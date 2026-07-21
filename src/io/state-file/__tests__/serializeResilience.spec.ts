import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { reactive } from 'vue';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import { debug } from '@/src/utils/loggers';

const mocks = vi.hoisted(() => ({
  addWarning: vi.fn(),
  writeSegmentGroups: vi.fn(),
}));

const writeOneInvalidGroup = async (stateFile: StateFile) => {
  stateFile.manifest.segmentGroups = reactive([
    {
      id: 'valid-group',
      dataSourceId: 1,
      metadata: {
        name: 'Valid group',
        parentImage: 'dataset-1',
        segments: { order: [], byValue: {} },
      },
    },
    {
      id: 'invalid-group',
      metadata: {
        name: 'Invalid group',
        parentImage: 'dataset-1',
        segments: { order: [], byValue: {} },
      },
    } as never,
  ]) as never;
};

vi.mock('@/src/store/datasets', () => ({
  useDatasetStore: () => ({
    serialize: vi.fn((stateFile: StateFile) => {
      stateFile.manifest.datasets = [{ id: 'dataset-1', dataSourceId: 1 }];
      stateFile.manifest.dataSources = [
        { id: 1, type: 'uri', uri: '/dataset-1' },
      ];
    }),
  }),
}));
vi.mock('@/src/store/views', () => ({
  useViewStore: () => ({ serialize: vi.fn() }),
}));
vi.mock('@/src/store/view-configs', () => ({
  useViewConfigStore: () => ({ serialize: vi.fn() }),
}));
vi.mock('@/src/store/segmentGroups', () => ({
  useSegmentGroupStore: () => ({ serialize: mocks.writeSegmentGroups }),
}));
vi.mock('@/src/store/tools', () => ({
  useToolStore: () => ({ serialize: vi.fn() }),
}));
vi.mock('@/src/store/datasets-layers', () => ({
  useLayersStore: () => ({ serialize: vi.fn() }),
}));
vi.mock('@/src/store/messages', () => ({
  useMessageStore: () => ({ addWarning: mocks.addWarning }),
}));

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

describe('state-file serialization resilience', () => {
  it('writes a restorable zip when one manifest entry is malformed', async () => {
    mocks.writeSegmentGroups.mockImplementation(writeOneInvalidGroup);
    const blob = await serialize();
    const zip = await JSZip.loadAsync(blob);
    const manifest = JSON.parse(await zip.file(MANIFEST)!.async('string'));

    expect(manifest.segmentGroups).toHaveLength(1);
    expect(manifest.segmentGroups[0].id).toBe('valid-group');
    expect(mocks.addWarning).toHaveBeenCalledWith(
      'Some session content could not be saved',
      expect.objectContaining({ persist: true })
    );
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
    const manifest: Manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'dataset-1', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
      segmentGroups: [
        {
          id: 'orphan',
          path: 'segmentations/orphan.vti',
          metadata: { name: 'Orphan', parentImage: 'missing-dataset' },
        },
      ],
      parentToLayers: [
        { selectionKey: 'dataset-1', sourceSelectionKeys: ['missing-layer'] },
      ],
    };

    const normalized = normalizeManifest(manifest, zip);
    expect(normalized.manifest.segmentGroups).toEqual([]);
    expect(normalized.manifest.parentToLayers).toEqual([]);
    expect(zip.file('segmentations/orphan.vti')).toBeNull();
    expect(normalized.omitted.join('\n')).toMatch(
      /parent dataset|layer relationship/
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

  it('round-trips a locked segment mask', () => {
    const manifest: Manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'dataset-1', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: '/dataset-1' }],
      segmentGroups: [
        {
          id: 'group-1',
          dataSourceId: 1,
          metadata: {
            name: 'Group',
            parentImage: 'dataset-1',
            segments: {
              order: [1],
              byValue: {
                '1': {
                  value: 1,
                  name: 'Segment 1',
                  color: [255, 0, 0, 255],
                  visible: true,
                  locked: true,
                },
              },
            },
          },
        },
      ],
    };

    const normalized = normalizeManifest(manifest, new JSZip());
    expect(
      normalized.manifest.segmentGroups?.[0].metadata.segments?.byValue['1']
        .locked
    ).toBe(true);
  });
});
