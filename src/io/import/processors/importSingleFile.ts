import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { useImageStore } from '@/src/store/datasets-images';
import { useModelStore } from '@/src/store/datasets-models';
import { FILE_READERS } from '@/src/io';
import { ImportHandler, asLoadableResult } from '@/src/io/import/common';
import { useDatasetStore } from '@/src/store/datasets';
import { useMessageStore } from '@/src/store/messages';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { InitViewSpecs } from '@/src/config';
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

    // Create a default view for each viewID
    useViewStore().viewIDs.forEach((viewID: string) => {
      const { lpsOrientation, dimensions } = useImageStore().metadata[dataID];
      const axisDir = InitViewSpecs[viewID].props.viewDirection;
      const lpsFromDir = getLPSAxisFromDir(axisDir);
      const lpsOrient = lpsOrientation[lpsFromDir];

      const dimMax = dimensions[lpsOrient];

      useViewSliceStore().updateConfig(viewID, dataID, {
        axisDirection: axisDir,
        max: dimMax - 1,
      });
      useViewSliceStore().resetSlice(viewID, dataID);
    });

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
