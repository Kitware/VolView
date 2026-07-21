import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { restoreStateFile } from '@/src/io/import/processors/restoreStateFile';
import { leafStateId } from '@/src/io/import/dataSource';
import type { StateFileSetupResult } from '@/src/io/import/common';

// ---------------------------------------------------------------------------
// Leaf preparation for composed manifests: a composed
// manifest's `datasets` covers base images only, so a segment group wired to
// an artifact uri entry via `dataSourceId` (no archive `path`) must get a
// synthesized dataset leaf — otherwise its dataIDMap key never materializes
// and restore hangs on the group forever. Unreferenced uri entries and
// path-carrying groups synthesize nothing.
// ---------------------------------------------------------------------------

const BASE_URI = 'volview-backend:base/ct-chest-001';
const ARTIFACT_URI = 'volview-backend:artifact/tumor-seg/v2';
const UNREFERENCED_URI = 'volview-backend:artifact/unreferenced/v1';

const segmentGroup = (extras: Record<string, unknown>) => ({
  id: 'sg-tumor',
  ...extras,
  metadata: {
    name: 'Tumor',
    parentImage: 'ds-ct',
    segments: {
      order: [1],
      byValue: {
        '1': {
          value: 1,
          name: 'Tumor',
          color: [255, 0, 0, 255],
          visible: true,
        },
      },
    },
  },
});

const composedManifest = (extras: Record<string, unknown>) => ({
  version: '6.4.0',
  dataSources: [
    { id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' },
    { id: 3, type: 'uri', uri: ARTIFACT_URI, name: 'Tumor.seg.nrrd' },
    { id: 9, type: 'uri', uri: UNREFERENCED_URI, name: 'unreferenced.nrrd' },
  ],
  datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
  segmentGroups: [segmentGroup(extras)],
});

async function prepareLeaves(manifest: Record<string, unknown>) {
  const file = new File([JSON.stringify(manifest)], 'session.volview.json', {
    type: 'application/json',
  });
  const result = await restoreStateFile({
    type: 'file',
    file,
    fileType: 'application/json',
  });
  expect((result as StateFileSetupResult).type).toBe('stateFileSetup');
  return (result as StateFileSetupResult).dataSources;
}

type UriLeaf = {
  type: 'uri';
  uri: string;
  stateFileLeaf?: { stateID: string };
};

describe('prepareLeafDataSources — composed-manifest segment groups', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('synthesizes a leaf for the artifact a dataSourceId-only group references', async () => {
    const leaves = (await prepareLeaves(
      composedManifest({ dataSourceId: 3 })
    )) as UriLeaf[];

    const artifact = leaves.find((leaf) => leaf.uri === ARTIFACT_URI);
    expect(artifact).toBeDefined();
    // Keyed in the synthesized-leaf namespace so
    // segmentGroups.deserialize finds it via dataIDMap[leafStateId(3)] and it
    // can never collide with a scene-recorded dataset id.
    expect(artifact!.stateFileLeaf).toEqual({ stateID: leafStateId(3) });

    // The base dataset leaf is untouched.
    const base = leaves.find((leaf) => leaf.uri === BASE_URI);
    expect(base!.stateFileLeaf).toEqual({ stateID: 'ds-ct' });

    // Unreferenced uri entries are never fetched.
    expect(leaves.some((leaf) => leaf.uri === UNREFERENCED_URI)).toBe(false);
  });

  it('synthesizes nothing for a group whose bytes ride in the zip under path', async () => {
    const leaves = (await prepareLeaves(
      composedManifest({
        dataSourceId: 3,
        path: 'segmentations/Tumor.seg.nrrd',
      })
    )) as UriLeaf[];

    // path wins for bytes; the artifact uri is provenance only, not a fetch.
    expect(leaves.some((leaf) => leaf.uri === ARTIFACT_URI)).toBe(false);
    expect(leaves.some((leaf) => leaf.uri === BASE_URI)).toBe(true);
  });
});
