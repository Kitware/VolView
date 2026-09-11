import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { useImageStore } from '@/src/store/datasets-images';
import { useModelStore } from '@/src/store/datasets-models';
import { FILE_READERS } from '@/src/io';
import { ImportHandler, asLoadableResult } from '@/src/io/import/common';
import { surfaceWarning, useMessageStore } from '@/src/store/messages';
import { Skip } from '@/src/utils/evaluateChain';
import { repairUnusableSpacing } from '@/src/utils/imageSpace';

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
  const { dataObject, headerMetadata } = await reader(dataSource.file);

  if (dataObject.isA('vtkImageData')) {
    const image = dataObject as vtkImageData;
    const declared = repairUnusableSpacing(image);
    if (declared) {
      surfaceWarning(
        'Invalid voxel spacing',
        `"${dataSource.file.name}" declares voxel spacing ${declared.join(', ')}. Axes with zero or non-finite spacing use 1 instead, so measurements along them are not physical.`
      );
    }
    const dataID = useImageStore().addVTKImageData(
      dataSource.file.name,
      image,
      { headerMetadata }
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

  throw new Error(
    `Failed to import "${dataSource.file.name}". The file may be corrupted or in an unsupported format variant.`
  );
};

export default importSingleFile;
