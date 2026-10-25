import openUriStream from '@/src/io/import/processors/openUriStream';
import type { ImportContext } from '@/src/io/import/common';
import JSZip from 'jszip';
import extractArchive from '@/src/io/import/processors/extractArchive';
import { buildStateIDToStoreID } from '@/src/io/import/importDataSources';
import {
  asLoadableResult,
  type IntermediateResult,
} from '@/src/io/import/common';
import { findStateFileLeaves } from '@/src/io/import/dataSource';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { restoreStateFile } from '@/src/io/import/processors/restoreStateFile';
import { leafStateId } from '@/src/io/import/dataSource';
import type { StateFileSetupResult } from '@/src/io/import/common';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

// ---------------------------------------------------------------------------
// Leaf preparation for composed manifests: a composed
// manifest's `datasets` covers base images only, so a segmentation artifact
// wired to an artifact uri entry via `dataSourceId` (no archive `path`) must
// get a synthesized dataset leaf; otherwise its dataIDMap key never
// materializes and restore hangs on the artifact forever. Unreferenced uri
// entries and path-carrying artifacts synthesize nothing.
// ---------------------------------------------------------------------------

const BASE_URI = 'volview-backend:base/ct-chest-001';
const ARTIFACT_URI = 'volview-backend:artifact/tumor-seg/v2';
const UNREFERENCED_URI = 'volview-backend:artifact/unreferenced/v1';

const segmentationArtifact = (extras: Record<string, unknown>) => ({
  id: 'sg-tumor',
  name: 'Tumor',
  parentImage: 'ds-ct',
  ...extras,
});

const composedManifest = (extras: Record<string, unknown>) => ({
  version: MANIFEST_VERSION,
  dataSources: [
    { id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' },
    { id: 3, type: 'uri', uri: ARTIFACT_URI, name: 'Tumor.seg.nrrd' },
    { id: 9, type: 'uri', uri: UNREFERENCED_URI, name: 'unreferenced.nrrd' },
  ],
  datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
  segmentationArtifacts: [segmentationArtifact(extras)],
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

describe('prepareLeafDataSources: composed-manifest artifacts', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('synthesizes a leaf for the artifact a dataSourceId-only entry references', async () => {
    const leaves = (await prepareLeaves(
      composedManifest({ dataSourceId: 3 })
    )) as UriLeaf[];

    const artifact = leaves.find((leaf) => leaf.uri === ARTIFACT_URI);
    expect(artifact).toBeDefined();
    // Keyed in the synthesized-leaf namespace so the segmentation store's
    // deserialize finds it via dataIDMap[leafStateId(3)] and it can never
    // collide with a scene-recorded dataset id.
    expect(artifact!.stateFileLeaf).toEqual({ stateID: leafStateId(3) });

    // The base dataset leaf is untouched.
    const base = leaves.find((leaf) => leaf.uri === BASE_URI);
    expect(base!.stateFileLeaf).toEqual({ stateID: 'ds-ct' });

    // Unreferenced uri entries are never fetched.
    expect(leaves.some((leaf) => leaf.uri === UNREFERENCED_URI)).toBe(false);
  });

  it('synthesizes nothing for an artifact whose bytes ride in the zip under path', async () => {
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

describe('saved archive member leaves', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it.each([
    ['nested', 'series-a/slice.dcm', 'series-b/slice.dcm'],
    ['flat', 'a.dcm', 'b.dcm'],
    ['root-relative', '/a.dcm', '/b.dcm'],
  ])(
    'restores each dataset from its recorded %s member of a shared archive',
    async (_kind, pathA, pathB) => {
      const inner = new JSZip();
      inner.file(pathA.replace(/^\/+/, ''), 'series A');
      inner.file(pathB.replace(/^\/+/, ''), 'series B');
      const manifest = {
        version: MANIFEST_VERSION,
        dataSources: [
          { id: 1, type: 'file', fileId: 10, fileType: 'application/zip' },
          { id: 2, type: 'archive', parent: 1, path: pathA },
          { id: 3, type: 'archive', parent: 1, path: pathB },
        ],
        datasetFilePath: { '10': 'data/series.zip' },
        datasets: [
          { id: 'saved-a', dataSourceId: 2 },
          { id: 'saved-b', dataSourceId: 3 },
        ],
      };
      const outer = new JSZip();
      outer.file('manifest.json', JSON.stringify(manifest));
      outer.file(
        'data/series.zip',
        await inner.generateAsync({ type: 'blob' })
      );
      const file = new File(
        [await outer.generateAsync({ type: 'blob' })],
        'session.volview.zip'
      );
      const setup = (await restoreStateFile({
        type: 'file',
        file,
        fileType: 'application/zip',
      })) as StateFileSetupResult;
      const loadables = await Promise.all(
        setup.dataSources.map(async (source, index) => {
          const result = (await extractArchive(source)) as IntermediateResult;
          expect(result.dataSources).toHaveLength(1);
          const [member] = result.dataSources;
          if (member.type !== 'file') throw new Error('Expected a file');
          expect(await member.file.text()).toBe(
            index === 0 ? 'series A' : 'series B'
          );
          expect(findStateFileLeaves(member)).toEqual([
            { stateID: index === 0 ? 'saved-a' : 'saved-b' },
          ]);
          return asLoadableResult('loaded-' + index, member, 'image');
        })
      );
      expect(buildStateIDToStoreID(loadables)).toEqual({
        'saved-a': 'loaded-0',
        'saved-b': 'loaded-1',
      });
    }
  );
});

it('downloads a saved source archive once and reuses extracted members', async () => {
  const zip = new JSZip();
  zip.file('a.dcm', 'A');
  zip.file('b.dcm', 'B');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(new Uint8Array(bytes), {
        headers: { 'content-type': 'application/zip' },
      })
  );
  const context: ImportContext = {
    fetchFileCache: new Map(),
    archiveCache: new Map(),
  };
  try {
    const opened = await Promise.all(
      ['a', 'b'].map((name) =>
        openUriStream(
          {
            type: 'uri',
            uri: 'https://example.test/series.zip',
            name: 'series.zip',
            mime: 'application/zip',
            stateFileLeaf: { stateID: name, archivePaths: [name + '.dcm'] },
          },
          context
        )
      )
    );
    const sources = opened.map(
      (result) => (result as IntermediateResult).dataSources[0]
    );
    expect(request).toHaveBeenCalledOnce();
    if (sources[0].type !== 'file' || sources[1].type !== 'file')
      throw new Error('Expected archive files');
    expect(sources[0].file).toBe(sources[1].file);
    const first = (await extractArchive(
      sources[0],
      context
    )) as IntermediateResult;
    const second = (await extractArchive(
      sources[1],
      context
    )) as IntermediateResult;
    const again = (await extractArchive(
      sources[0],
      context
    )) as IntermediateResult;
    const a = first.dataSources[0];
    const b = second.dataSources[0];
    if (
      a.type !== 'file' ||
      b.type !== 'file' ||
      again.dataSources[0].type !== 'file'
    )
      throw new Error('Expected extracted files');
    expect(await a.file.text()).toBe('A');
    expect(await b.file.text()).toBe('B');
    expect(again.dataSources[0].file).toBe(a.file);
    expect(findStateFileLeaves(a)).toEqual([{ stateID: 'a' }]);
    expect(findStateFileLeaves(b)).toEqual([{ stateID: 'b' }]);
  } finally {
    request.mockRestore();
  }
});
