import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { reactive } from 'vue';
import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import type { Extent3D } from '@/src/segmentation/geometry';
import type { MessageOptions } from '@/src/store/messages';
import { debug } from '@/src/utils/loggers';

const writeDatasets = (stateFile: StateFile) => {
  stateFile.manifest.datasets = [{ id: 'dataset-1', dataSourceId: 1 }];
  stateFile.manifest.dataSources = [{ id: 1, type: 'uri', uri: '/dataset-1' }];
};

const writeOneInvalidMask = async (stateFile: StateFile) => {
  stateFile.zip.file('valid.vti', 'bytes');
  (stateFile.manifest as any).imageSegments = reactive([
    imageSegmentsWithPath('valid.vti'),
    { imageId: 'dataset-1', segments: 'invalid' },
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

const segment = {
  id: 'segment-1',
  name: 'Tumor',
  color: [255, 0, 0, 255] as [number, number, number, number],
  visible: true,
  locked: false,
};

const imageSegmentsWithPath = (path: string) => ({
  imageId: 'dataset-1',
  segments: [
    { ...segment, labelmap: { path, extent: [0, 1, 0, 1, 0, 1] as Extent3D } },
  ],
});

const toolsForSegment = (segmentId: string) =>
  ({
    rulers: {
      tools: [
        {
          id: undefined,
          imageID: 'dataset-1',
          segmentId,
          frameOfReference: { planeOrigin: [0, 0, 0], planeNormal: [0, 0, 1] },
          slice: 0,
          firstPoint: [0, 0, 0],
          secondPoint: [1, 0, 0],
        },
      ],
    },
  }) satisfies NonNullable<Manifest['tools']>;

// The zip holds mask.vti, as the segmentation writer leaves it before checks.
const normalizeWithMaskFile = (extra: Record<string, unknown>) => {
  const manifest = {
    ...manifestWithSelection('dataset-1'),
    ...extra,
  } as unknown as Manifest;
  const zip = new JSZip();
  zip.file('mask.vti', 'voxels');
  return { normalized: normalizeManifest(manifest, zip), zip };
};

describe('state-file serialization resilience', () => {
  it('writes a restorable zip when one manifest entry is malformed', async () => {
    const sink = recordWarnings();
    const blob = await serialize({
      writers: [writeDatasets, writeOneInvalidMask],
      addWarning: sink.addWarning,
    });
    const zip = await JSZip.loadAsync(blob);
    const manifest = JSON.parse(await zip.file(MANIFEST)!.async('string'));

    expect(manifest.imageSegments).toHaveLength(1);
    expect(manifest.imageSegments[0].segments[0].labelmap.path).toBe(
      'valid.vti'
    );
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

  it('omits a segment set and layer relationship with missing images', () => {
    const { normalized, zip } = normalizeWithMaskFile({
      imageSegments: [
        { ...imageSegmentsWithPath('mask.vti'), imageId: 'missing' },
      ],
      parentToLayers: [
        { selectionKey: 'dataset-1', sourceSelectionKeys: ['missing'] },
      ],
    });
    expect(normalized.manifest.imageSegments).toEqual([]);
    expect(zip.file('mask.vti')).toBeNull();
    expect(normalized.manifest.parentToLayers).toEqual([]);
    expect(normalized.omitted).toEqual([
      'imageSegments[0]: image dataset missing is missing',
      'layer relationship 0: missing or invalid dataset',
    ]);
  });

  it('drops the mask files of a segment set that fails validation', () => {
    const valid = imageSegmentsWithPath('mask.vti');
    const { normalized, zip } = normalizeWithMaskFile({
      imageSegments: [
        { ...valid, segments: [{ ...valid.segments[0], id: 7 }] },
      ],
    });
    expect(normalized.manifest.imageSegments).toEqual([]);
    expect(zip.file('mask.vti')).toBeNull();
    expect(normalized.omitted).toEqual([
      'imageSegments[0]: invalid segment set',
    ]);
  });

  it('drops and reports a mask whose file is missing', () => {
    const manifest = {
      ...manifestWithSelection('dataset-1'),
      imageSegments: [imageSegmentsWithPath('missing.vti')],
    } as unknown as Manifest;
    const normalized = normalizeManifest(manifest, new JSZip());
    expect(normalized.manifest.imageSegments).toEqual([
      { imageId: 'dataset-1', segments: [segment] },
    ]);
    expect(normalized.omitted).toEqual([
      'imageSegments[0].segments[segment-1]: archive member missing.vti is missing',
    ]);
  });

  it('omits the complete view layout when viewByID is invalid', () => {
    const manifest = {
      ...manifestWithSelection('dataset-1'),
      activeView: 'view-1',
      isActiveViewMaximized: true,
      layout: {
        direction: 'column',
        items: [{ type: 'view', viewId: 'view-1' }],
      },
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

  it('warns when an annotation names a segment absent from the registry', () => {
    const warn = vi.spyOn(debug, 'warn').mockImplementation(() => {});
    const manifest = manifestWithSelection('dataset-1');
    manifest.tools = toolsForSegment('missing-segment');
    const normalized = normalizeManifest(manifest, new JSZip());
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('tools.rulers[0].segmentId -> segment')
    );
    expect(normalized.omitted).toEqual([]);
    warn.mockRestore();
  });

  it('does not warn when every optional reference resolves', () => {
    // A fully coherent manifest must not trip the cascade-gap backstop —
    // guards against false-positive warnings on healthy sessions.
    const warnSpy = vi.spyOn(debug, 'warn').mockImplementation(() => {});
    const manifest = manifestWithSelection('dataset-1');

    manifest.imageSegments = [imageSegmentsWithPath('mask.vti')];
    manifest.tools = toolsForSegment('segment-1');
    const zip = new JSZip();
    zip.file('mask.vti', 'voxels');

    const normalized = normalizeManifest(manifest, zip);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(normalized.omitted).toEqual([]);

    warnSpy.mockRestore();
  });

  it('keeps segments, selection and mask bindings through normalization', () => {
    const entry = {
      ...imageSegmentsWithPath('mask.vti'),
      selectedSegmentId: 'segment-1',
    };
    const zip = new JSZip();
    zip.file('mask.vti', 'bytes');
    const normalized = normalizeManifest(
      { ...manifestWithSelection('dataset-1'), imageSegments: [entry] },
      zip
    );
    expect(normalized.manifest.imageSegments).toEqual([entry]);
  });

  it('keeps an initialized empty image set through normalization', () => {
    const manifest = {
      ...manifestWithSelection('dataset-1'),
      imageSegments: [{ imageId: 'dataset-1', segments: [] }],
    };
    expect(
      normalizeManifest(manifest, new JSZip()).manifest.imageSegments
    ).toEqual([{ imageId: 'dataset-1', segments: [] }]);
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
