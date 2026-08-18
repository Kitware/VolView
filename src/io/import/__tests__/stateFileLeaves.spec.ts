import { describe, expect, it } from 'vitest';

import {
  findStateFileLeaves,
  type DataSource,
} from '@/src/io/import/dataSource';
import { buildStateIDToStoreID } from '@/src/io/import/importDataSources';
import type { LoadableResult } from '@/src/io/import/common';

// ---------------------------------------------------------------------------
// Multi-file DICOM ephemeral open: the backend's
// ephemeral compose emits ONE dataset per canonical FILE, but the client
// merges all N files into ONE volume. The restore-time stateID -> storeID map
// must cover EVERY per-file dataset id with the merged volume's store id —
// mapping only sources[0]'s leaf leaves N-1 datasets "unresolved" (a spurious
// missing-content warning on every fresh open) and makes segment-group parent
// binding a race on which file sorts first.
// ---------------------------------------------------------------------------

const uriLeaf = (uri: string, stateID: string): DataSource => ({
  type: 'uri',
  uri,
  name: uri,
  stateFileLeaf: { stateID },
});

// A merged DICOM volume's dataSource: a fresh collection over the chunk
// sources, each chunk parented by its own per-file uri leaf.
const mergedDicomSource = (stateIDs: string[]): DataSource => ({
  type: 'collection',
  sources: stateIDs.map((stateID, i) => ({
    type: 'chunk',
    chunk: {} as never,
    mime: 'application/dicom',
    parent: uriLeaf(`https://girder.example/file/${i}`, stateID),
  })),
});

describe('findStateFileLeaves', () => {
  it('walks the parent chain of a plain source', () => {
    const source: DataSource = {
      type: 'file',
      file: new File([], 'a.nrrd'),
      fileType: 'application/octet-stream',
      parent: uriLeaf('https://girder.example/file/9', 'ds-a'),
    };
    expect(findStateFileLeaves(source)).toEqual([{ stateID: 'ds-a' }]);
  });

  it('collects EVERY member leaf of a merged collection', () => {
    const source = mergedDicomSource(['ds-f1', 'ds-f2', 'ds-f3']);
    expect(findStateFileLeaves(source)).toEqual([
      { stateID: 'ds-f1' },
      { stateID: 'ds-f2' },
      { stateID: 'ds-f3' },
    ]);
  });

  it('a leaf on the source itself wins over member recursion', () => {
    const source: DataSource = {
      ...mergedDicomSource(['ds-f1']),
      stateFileLeaf: { stateID: 'ds-self' },
    };
    expect(findStateFileLeaves(source)).toEqual([{ stateID: 'ds-self' }]);
  });

  it('yields nothing for a source with no leaf anywhere', () => {
    expect(
      findStateFileLeaves({
        type: 'file',
        file: new File([], 'a.nrrd'),
        fileType: 'application/octet-stream',
      })
    ).toEqual([]);
  });
});

describe('buildStateIDToStoreID', () => {
  it('maps every per-file dataset id of a merged DICOM volume to the ONE store id', () => {
    const loadables: LoadableResult[] = [
      {
        type: 'data',
        dataID: 'store-dicom',
        dataType: 'image',
        dataSource: mergedDicomSource(['ds-f1', 'ds-f2', 'ds-f3']),
      },
      {
        type: 'data',
        dataID: 'store-seg',
        dataType: 'image',
        dataSource: {
          type: 'file',
          file: new File([], 'seg.nrrd'),
          fileType: 'application/octet-stream',
          parent: uriLeaf('https://girder.example/file/seg', 'leaf:4'),
        },
      },
    ];

    expect(buildStateIDToStoreID(loadables)).toEqual({
      'ds-f1': 'store-dicom',
      'ds-f2': 'store-dicom',
      'ds-f3': 'store-dicom',
      'leaf:4': 'store-seg',
    });
  });

  it('leaves a dataset unmapped when its leaves load as several volumes', () => {
    // A series saved as one dataset that a later build splits into several
    // volumes (overlapping acquisitions) has no single owner for its saved
    // state. Binding to either volume would attach annotations to an
    // arbitrary sub-volume, so the dataset must go unresolved instead.
    const loadables: LoadableResult[] = [
      {
        type: 'data',
        dataID: 'store-acq1',
        dataType: 'image',
        dataSource: mergedDicomSource(['ds-split', 'ds-split']),
      },
      {
        type: 'data',
        dataID: 'store-acq2',
        dataType: 'image',
        dataSource: mergedDicomSource(['ds-split']),
      },
      {
        type: 'data',
        dataID: 'store-whole',
        dataType: 'image',
        dataSource: mergedDicomSource(['ds-whole']),
      },
    ];

    expect(buildStateIDToStoreID(loadables)).toEqual({
      'ds-whole': 'store-whole',
    });
  });
});
