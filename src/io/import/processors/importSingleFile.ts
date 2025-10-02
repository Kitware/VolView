import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { useImageStore } from '@/src/store/datasets-images';
import { useModelStore } from '@/src/store/datasets-models';
import { FILE_READERS } from '@/src/io';
import { ImportHandler, asLoadableResult } from '@/src/io/import/common';
import { useMessageStore } from '@/src/store/messages';
import { Skip } from '@/src/utils/evaluateChain';

/**
 * Reads and imports a file DataSource.
 * @param dataSource
 * @returns
 */
const importSingleFile: ImportHandler = async (dataSource) => {
  if (dataSource.type !== 'file') {
    return Skip;
  }

  if (!FILE_READERS.has(dataSource.fileType)) {
    return Skip;
  }

  const reader = FILE_READERS.get(dataSource.fileType)!;
  const dataObject = await reader(dataSource.file);

  if (dataObject.isA('vtkImageData')) {
    const dataID = useImageStore().addVTKImageData(
      dataSource.file.name,
      dataObject as vtkImageData
    );

    return asLoadableResult(dataID, dataSource, 'image');
  }

  if (dataObject.isA('vtkPolyData')) {
    useMessageStore().addWarning('Meshes are currently not viewable');
    const dataID = useModelStore().addVTKPolyData(
      dataSource.file.name,
      dataObject as vtkPolyData
    );

    return asLoadableResult(dataID, dataSource, 'model');
  }

  throw new Error('Data reader did not produce a valid dataset');
};

export default importSingleFile;
