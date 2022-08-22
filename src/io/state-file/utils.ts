import { StateFile, DataSetType } from './schema';
import { useFileStore } from '../../store/datasets-files';

export async function serializeData(
  stateFile: StateFile,
  dataIDs: string[],
  dataType: DataSetType
) {
  const fileStore = useFileStore();
  const { manifest } = stateFile;
  const { zip } = stateFile;
  const { dataSets } = manifest;

  dataIDs.forEach((id) => {
    const files = fileStore.getFiles(id);
    if (files === null) {
      throw new Error(`No files for dataID: ${id}`);
    }

    const dataPath = `data/${id}/`;
    dataSets.push({
      id,
      path: dataPath,
      type: dataType,
    });

    files.forEach((file: File) => {
      const filePath = `data/${id}/${file.name}`;

      zip.file(filePath, file);
    });
  });
}
