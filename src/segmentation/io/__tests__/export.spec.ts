import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import JSZip from 'jszip';

import {
  bundleExportFiles,
  layerFileName,
  segmentationFileStem,
} from '@/src/segmentation/io/export';
import { useDICOMStore } from '@/src/store/datasets-dicom';

// A labelmap file carries one label per voxel, so a segmentation with overlap
// leaves as several files. One file is the common case and stays the download
// it has always been: same name, same bytes, no archive around it.

const bytes = (...values: number[]) => new Uint8Array(values);

const readBlob = async (blob: Blob) =>
  Array.from(new Uint8Array(await blob.arrayBuffer()));

describe('naming the file each group of segments writes', () => {
  it('gives the first group the plain name', () => {
    expect(layerFileName('Prostate', 'seg.nrrd', 0)).toBe('Prostate.seg.nrrd');
  });

  it('numbers every later group after it', () => {
    expect(layerFileName('Prostate', 'seg.nrrd', 1)).toBe(
      'Prostate_layer1.seg.nrrd'
    );
    expect(layerFileName('Prostate', 'nii.gz', 2)).toBe(
      'Prostate_layer2.nii.gz'
    );
  });
});

describe('the stem a segmentation is saved and staged under', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('drops a file-backed image name’s extension, compound ones included', () => {
    expect(segmentationFileStem('file-image', 'scan.nii.gz')).toBe('scan');
  });

  it('keeps every dot of a DICOM series name', () => {
    useDICOMStore().volumeInfo['series-1'] = {
      NumberOfSlices: 1,
      VolumeID: 'series-1',
      Modality: 'MR',
      SeriesInstanceUID: '1.2.3.4',
      SeriesNumber: '1',
      SeriesDescription: 'Ax T2 FSE 3.5mm',
      WindowLevel: '128',
      WindowWidth: '256',
    };

    expect(segmentationFileStem('series-1', 'Ax T2 FSE 3.5mm')).toBe(
      'Ax T2 FSE 3.5mm'
    );
  });
});

describe('handing the written files to the browser', () => {
  it('downloads a single file as itself', async () => {
    const bundle = await bundleExportFiles('Prostate', [
      { name: 'Prostate.seg.nrrd', data: bytes(1, 2, 3) },
    ]);

    expect(bundle.name).toBe('Prostate.seg.nrrd');
    expect(await readBlob(bundle.blob)).toEqual([1, 2, 3]);
  });

  it('downloads several files as one archive of them', async () => {
    const bundle = await bundleExportFiles('Prostate', [
      { name: 'Prostate.seg.nrrd', data: bytes(1, 2, 3) },
      { name: 'Prostate_layer1.seg.nrrd', data: bytes(4, 5) },
    ]);

    expect(bundle.name).toBe('Prostate.zip');
    const zip = await JSZip.loadAsync(bundle.blob);
    expect(Object.keys(zip.files)).toEqual([
      'Prostate.seg.nrrd',
      'Prostate_layer1.seg.nrrd',
    ]);
    expect(
      Array.from(
        await zip.files['Prostate_layer1.seg.nrrd'].async('uint8array')
      )
    ).toEqual([4, 5]);
  });
});
