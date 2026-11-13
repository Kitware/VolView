import { datasetFromTags, instanceFor } from '@/tests/dicomDataset';
import { getDatasetTag, Tags } from '@/packages/dicom/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import type {
  DicomInstanceSource,
  DataSource,
} from '@/src/io/import/dataSource';
import { uriToDataSource } from '@/src/io/import/dataSource';
import { importDicomInstanceSources } from '@/src/io/import/importDataSources';
import { useDatasetStore } from '@/src/store/datasets';
import type { ImportInstancesResult } from '@/src/store/datasets-dicom';

// A replan can fold one collection into another. The dataset the dissolved id
// owned has to go, and the survivor has to name the member it inherited, or a
// later save writes a dangling dataset and loses that instance.

const instanceSourceFor = (sop: string) => {
  const source: DataSource = {
    type: 'dicom',
    instance: instanceFor(datasetFromTags([[Tags.SOPInstanceUID, sop]])),
    parent: uriToDataSource(
      `https://ex/series/${sop}.dcm`,
      `${sop}.dcm`,
      FILE_EXT_TO_MIME.dcm
    ),
  };
  return source as DataSource & DicomInstanceSource;
};

const collectedSops = (dataSource: DataSource | undefined) => {
  if (dataSource?.type !== 'collection') throw new Error('Expected collection');
  return dataSource.sources.map((src) => {
    if (src.type !== 'dicom') throw new Error('Expected a DICOM source');
    return getDatasetTag(src.instance.dataset, Tags.SOPInstanceUID);
  });
};

describe('importDicomInstanceSources', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('inherits a moved member and drops the dissolved dataset', () => {
    const datasetStore = useDatasetStore();
    const [a, b, c] = ['sop-a', 'sop-b', 'sop-c'].map(instanceSourceFor);

    // Stands in for the store: a dissolved id is removed during the commit.
    const load = (
      sources: DicomInstanceSource[],
      result: ImportInstancesResult
    ) =>
      importDicomInstanceSources(sources, (_instances, { removeDissolved }) => {
        result.dissolved.forEach(removeDissolved);
        return result;
      });

    load([a, b], {
      volumes: { 'vol-1': [a.instance], 'vol-2': [b.instance] },
      dissolved: [],
    });
    expect(datasetStore.getDataSource('vol-2')).toBeDefined();

    load([c], {
      volumes: { 'vol-1': [a.instance, b.instance, c.instance] },
      dissolved: ['vol-2'],
    });

    expect(datasetStore.getDataSource('vol-2')).toBeUndefined();
    expect(collectedSops(datasetStore.getDataSource('vol-1'))).toEqual([
      'sop-a',
      'sop-b',
      'sop-c',
    ]);
  });
});
