import { useDICOMStore, type VolumeInfo } from '@/src/store/datasets-dicom';
import { useDatasetStore } from '@/src/store/datasets';
import type { DataSource } from '@/src/io/import/dataSource';

/**
 * Seats a volume in the DICOM store so it counts as a loaded dataset
 * everywhere the stores derive selections from. Requires an active pinia.
 */
export const seatVolume = (
  imageID: string,
  info: Partial<VolumeInfo> = {}
): VolumeInfo => {
  const volumeInfo: VolumeInfo = {
    NumberOfSlices: 10,
    VolumeID: imageID,
    Modality: 'US',
    SeriesInstanceUID: '1.2.3.4',
    SeriesNumber: '1',
    SeriesDescription: 'clip',
    WindowLevel: '128',
    WindowWidth: '256',
    kind: 'volume',
    ...info,
  };
  useDICOMStore().volumeInfo[imageID] = volumeInfo;
  return volumeInfo;
};

/** Records where a seated dataset's bytes came from, as an import would. */
export const seatDataSource = (dataID: string, dataSource: DataSource) =>
  useDatasetStore().addDataSources([{ dataID, dataSource }]);
