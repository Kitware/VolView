import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { useFileStore } from '@/src/store/datasets-files';
import { useImageStore } from '@/src/store/datasets-images';
import { useModelStore } from '@/src/store/datasets-models';
import { FILE_READERS } from '@/src/io';
import { ImportHandler } from '@/src/io/import/common';
import { convertDataSourceToDatasetFile } from '@/src/io/import/dataSource';

/**
 * Reads and imports a file DataSource.
 * @param dataSource
 * @returns
 */
const importSingleFile: ImportHandler = async (dataSource, { done }) => {
  const { fileSrc } = dataSource;
  if (fileSrc && FILE_READERS.has(fileSrc.fileType)) {
    const reader = FILE_READERS.get(fileSrc.fileType)!;
    const dataObject = await reader(fileSrc.file);

    const fileStore = useFileStore();

    if (dataObject.isA('vtkImageData')) {
      const dataID = useImageStore().addVTKImageData(
        fileSrc.file.name,
        dataObject as vtkImageData
      );
      fileStore.add(dataID, [convertDataSourceToDatasetFile(dataSource)]);

      return done({
        dataID,
        dataSource,
        dataType: 'image',
      });
    }

    if (dataObject.isA('vtkPolyData')) {
      const dataID = useModelStore().addVTKPolyData(
        fileSrc.file.name,
        dataObject as vtkPolyData
      );
      fileStore.add(dataID, [convertDataSourceToDatasetFile(dataSource)]);

      return done({
        dataID,
        dataSource,
        dataType: 'model',
      });
    }

    throw new Error('Data reader did not produce a valid dataset');
  }
  return dataSource;
};

export default importSingleFile;
