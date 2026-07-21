import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import JSZip from 'jszip';
import {
  restoreStateFile,
  completeStateFileRestore,
} from '@/src/io/import/processors/restoreStateFile';
import type { StateFileSetupResult } from '@/src/io/import/common';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { useMessageStore } from '@/src/store/messages';

// ---------------------------------------------------------------------------
// Regression: a state file whose archive is missing SOME of a dataset's files
// (e.g. one slice of a multi-file DICOM series) must never restore silently
// truncated. The surviving leaves still resolve the dataset, so the
// dataset-level unresolved check alone cannot see the loss — the missing
// members have to be carried through to the consolidated notice themselves.
// ---------------------------------------------------------------------------

const manifest = {
  version: '6.4.0',
  dataSources: [
    { id: 1, type: 'file', fileId: 10, fileType: 'application/octet-stream' },
    { id: 2, type: 'file', fileId: 20, fileType: 'application/octet-stream' },
    { id: 5, type: 'collection', sources: [1, 2] },
  ],
  datasetFilePath: { '10': 'data/10/a.dcm', '20': 'data/20/b.dcm' },
  datasets: [{ id: 'ds-ct', dataSourceId: 5 }],
};

async function stateZipMissingOneMember() {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  // Only the first of the two recorded members rides in the archive.
  zip.file('data/10/a.dcm', 'aaaa');
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'session.volview.zip');
}

describe('restore with a partially missing dataset archive', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reports the missing archive member while the surviving leaves still load', async () => {
    const file = await stateZipMissingOneMember();
    const result = (await restoreStateFile({
      type: 'file',
      file,
      fileType: 'application/zip',
    })) as StateFileSetupResult;

    expect(result.type).toBe('stateFileSetup');
    // The surviving member still becomes a leaf — the dataset partially loads.
    expect(result.dataSources).toHaveLength(1);
    // The missing member is carried out of leaf preparation, not dropped.
    expect(result.missingFiles).toEqual([
      { stateID: 'ds-ct', path: 'data/20/b.dcm' },
    ]);
  });

  it('the consolidated notice names a member missing from a dataset that still restored', async () => {
    await completeStateFileRestore(
      ManifestSchema.parse(manifest),
      [],
      { 'ds-ct': 'store-ct' }, // the dataset resolved from its surviving files
      [{ stateID: 'ds-ct', path: 'data/20/b.dcm' }]
    );

    const warning = useMessageStore().messages.find(
      (message) => message.title === 'Some scene content could not be restored'
    );
    expect(warning?.options.details).toContain('b.dcm');
  });
});
