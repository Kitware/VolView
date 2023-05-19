import { partition } from '@/src/utils';
import {
  isRemoteDataSource,
  serializeDataSource,
} from '@/src/io/import/dataSource';
import { StateFile, DatasetType } from './schema';
import { useFileStore } from '../../store/datasets-files';

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
    const sources = fileStore.getDataSources(id);
    if (!sources.length) {
      throw new Error(`No files for dataID: ${id}`);
    }

    const [remotes, toZip] = partition(isRemoteDataSource, sources);

    remoteFiles[id] = remotes.map(serializeDataSource);

    const dataPath = `data/${id}/`;

    toZip.forEach((ds) => {
      const { file } = ds.fileSrc;
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
