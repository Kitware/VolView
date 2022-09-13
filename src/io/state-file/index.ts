import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useFileStore } from '@/src/store/datasets-files';
import { LayoutDirection } from '@/src/types/layout';
import { useViewStore } from '@/src/store/views';
import {
  useDatasetStore,
  makeFileFailureStatus,
  LoadResult,
  DataSelection,
  makeDICOMSelection,
  makeImageSelection,
} from '../../store/datasets';
import { useDICOMStore } from '../../store/datasets-dicom';
import {
  ARCHIVE_FILE_TYPES,
  extractArchivesRecursively,
  retypeFile,
} from '../io';
import { FileEntry } from '../types';
import { Manifest, ManifestSchema, DataSet } from './schema';

const MANIFEST = 'manifest.json';
const VERSION = '0.0.1';

export async function save(fileName: string) {
  const datasetStore = useDatasetStore();
  const viewStore = useViewStore();

  const zip = new JSZip();
  const manifest: Manifest = {
    version: VERSION,
    dataSets: [],
    layout: {
      direction: LayoutDirection.H,
      items: [],
    },
    views: [],
  };

  const stateFile = {
    zip,
    manifest,
  };

  await datasetStore.serialize(stateFile);
  await viewStore.serialize(stateFile);

  zip.file(MANIFEST, JSON.stringify(manifest));
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, fileName);
}

async function restore(state: FileEntry[]): Promise<LoadResult[]> {
  const datasetStore = useDatasetStore();
  const dicomStore = useDICOMStore();
  const fileStore = useFileStore();
  const viewStore = useViewStore();

  // First load the manifest
  const manifestFile = state.filter((entry) => entry.file.name === MANIFEST);
  if (manifestFile.length === 0) {
    return [makeFileFailureStatus(MANIFEST, 'State file is missing manifest')];
  }

  const manifestString = await manifestFile[0].file.text();
  const manifest = ManifestSchema.parse(JSON.parse(manifestString));
  const { dataSets } = manifest;

  // We restore the view first, so that the appropriate watchers are triggered
  // in the views as the data is loaded
  viewStore.setLayout(manifest.layout);

  // Build up a map of path to DataSet
  const pathToDataSet: { [path: string]: DataSet } = {};
  dataSets.forEach((dataSet: DataSet) => {
    const { path } = dataSet;
    pathToDataSet[path] = dataSet;
  });

  // Mapping of the state file ID => new store ID
  const stateIDToStoreID: Record<string, string> = {};

  const statuses: LoadResult[] = [];

  // We load them sequentially to preserve the order
  for (const dataSet of dataSets) {
    const files = state
      .filter((entry) => entry.path === dataSet.path)
      .map((entry) => entry.file);

    const status = await datasetStore
      .deserialize(dataSet, files)
      .then((result) => {
        if (result.loaded) {
          stateIDToStoreID[dataSet.id] = result.dataID;
          fileStore.add(result.dataID, files);
        }

        return result;
      });

    statuses.push(status);
  }

  // Restore the primary selection
  if (manifest.primarySelection !== undefined) {
    const selectedID = stateIDToStoreID[manifest.primarySelection];
    let dataSelection: DataSelection | undefined;

    if (selectedID in dicomStore.volumeInfo) {
      dataSelection = makeDICOMSelection(selectedID);
    } else {
      dataSelection = makeImageSelection(selectedID);
    }

    datasetStore.setPrimarySelection(dataSelection);
  }

  // Now restore the views
  viewStore.deserialize(manifest.views, stateIDToStoreID);

  return new Promise<LoadResult[]>((resolve) => {
    resolve(statuses);
  });
}

export async function loadState(stateFile: File) {
  const typedFile = await retypeFile(stateFile);
  const fileEntries = await extractArchivesRecursively([typedFile]);

  return restore(fileEntries);
}

export async function isStateFile(file: File) {
  if (ARCHIVE_FILE_TYPES.has(file.type)) {
    const zip = await JSZip.loadAsync(file);

    return zip.file(MANIFEST) !== null;
  }

  return false;
}
