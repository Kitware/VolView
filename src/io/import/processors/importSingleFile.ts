import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { useImageStore } from '@/src/store/datasets-images';
import { useModelStore } from '@/src/store/datasets-models';
import { FILE_READERS } from '@/src/io';
import { ImportHandler, asLoadableResult } from '@/src/io/import/common';
import { useDatasetStore } from '@/src/store/datasets';
import { useMessageStore } from '@/src/store/messages';
import { Skip } from '@/src/utils/evaluateChain';

/**
 * Reads and imports a file DataSource.
 * @param dataSource
 * @returns
 */
const importSingleFile: ImportHandler = async (dataSource) => {
  if (!dataSource.fileSrc) {
    return Skip;
  }

  const { fileSrc } = dataSource;
  if (!FILE_READERS.has(fileSrc.fileType)) {
    return Skip;
  }

  const reader = FILE_READERS.get(fileSrc.fileType)!;
  const dataObject = await reader(fileSrc.file);

  if (dataObject.isA('vtkImageData')) {
    const dataID = useImageStore().addVTKImageData(
      fileSrc.file.name,
      dataObject as vtkImageData
    );

    return asLoadableResult(dataID, dataSource, 'image');
  }

  if (dataObject.isA('vtkPolyData')) {
    if (!useDatasetStore().primarySelection) {
      useMessageStore().addWarning(
        'Load an image to see the mesh. Initializing viewports from mesh files is not implemented.'
      );
    }
    const dataID = useModelStore().addVTKPolyData(
      fileSrc.file.name,
      dataObject as vtkPolyData
    );

    return asLoadableResult(dataID, dataSource, 'model');
  }

  throw new Error('Data reader did not produce a valid dataset');
};

export default importSingleFile;
