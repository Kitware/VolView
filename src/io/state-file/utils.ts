import { partition } from '@/src/utils';
import { StateFile, DatasetType } from './schema';
import {
  DatasetFile,
  isRemote,
  RemoteDatasetFile,
  useFileStore,
} from '../../store/datasets-files';

export async function serializeData(
  stateFile: StateFile,
  dataIDs: string[],
  dataType: DatasetType
) {
  const fileStore = useFileStore();
  const { zip } = stateFile;
  const {
    manifest: { datasets, remoteFiles },
  } = stateFile;

  dataIDs.forEach((id) => {
    const files = fileStore.getDatasetFiles(id);
    if (!files.length) {
      throw new Error(`No files for dataID: ${id}`);
    }

    const [remotes, toZip] = partition(isRemote, files) as [
      Array<RemoteDatasetFile>,
      Array<DatasetFile>
    ];

    remoteFiles[id] = remotes.map(({ file: { name }, ...rest }) => ({
      name,
      ...rest,
    }));

    const dataPath = `data/${id}/`;

    toZip.forEach(({ file }) => {
      const filePath = `${dataPath}/${file.name}`;
      zip.file(filePath, file);
    });

    datasets.push({
      id,
      path: dataPath,
      type: dataType,
    });
  });
}
