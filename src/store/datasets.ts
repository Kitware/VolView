import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import {
  isDicomImage,
  isRegularImage,
  type DataSelection,
} from '@/src/utils/dataSelection';
import { DataSource } from '@/src/io/import/dataSource';
import { useDICOMStore } from './datasets-dicom';
import { useImageStore } from './datasets-images';
import * as Schema from '../io/state-file/schema';
import { useLayersStore } from './datasets-layers';

export const DataType = {
  Image: 'Image',
  Model: 'Model',
};

interface LoadedData {
  dataID: string;
  dataSource: DataSource;
}

function createIdGenerator() {
  let nextId = 1;
  return () => nextId++;
}

function serializeLoadedData(loadedDataSources: Array<LoadedData>) {
  const nextId = createIdGenerator();
  const dataSourceToId = new Map<DataSource, number>();
  // topologically ordered ancestor -> descendant
  const serializedDependencies: Array<Schema.DataSourceType> = [];
  const dataIDToDataSourceID: Record<string, number> = {};
  const files: Record<string, File> = {};

  function serializeDataSource(ds: DataSource): number {
    if (dataSourceToId.has(ds)) {
      return dataSourceToId.get(ds)!;
    }

    const id = nextId();
    dataSourceToId.set(ds, id);

    // don't need to serialize all parents, just the ones that are necessary.
    const { type } = ds;
    if (type === 'file') {
      // file derives from the parent. Just return the serialized parent.
      if (ds.parent) {
        return serializeDataSource(ds.parent);
      }

      const fileId = nextId();
      files[fileId] = ds.file;
      serializedDependencies.push({
        id,
        type: 'file',
        fileId,
        fileType: ds.fileType,
      });
    } else if (type === 'archive') {
      serializedDependencies.push({
        id,
        type: 'archive',
        path: ds.path,
        parent: serializeDataSource(ds.parent),
      });
    } else if (type === 'uri') {
      serializedDependencies.push({
        id,
        type: 'uri',
        name: ds.name,
        uri: ds.uri,
        mime: ds.mime,
      });
    } else if (type === 'collection') {
      serializedDependencies.push({
        id,
        type: 'collection',
        sources: ds.sources.map((src) => serializeDataSource(src)),
      });
    } else if (type === 'chunk') {
      // chunk derives from the parent. Just return the serialized parent.
      if (ds.parent) {
        return serializeDataSource(ds.parent);
      }
      throw new Error('Chunk does not have a parent');
    } else {
      throw new Error(`Invalid data source type: ${type as string}`);
    }

    return id;
  }

  loadedDataSources.forEach(({ dataID, dataSource }) => {
    const id = serializeDataSource(dataSource);
    dataIDToDataSourceID[dataID] = id;
  });

  return {
    serializedDependencies,
    dataIDToDataSourceID,
    files,
  };
}

export const useDatasetStore = defineStore('dataset', () => {
  const imageStore = useImageStore();
  const dicomStore = useDICOMStore();
  const layersStore = useLayersStore();

  // --- state --- //

  const primarySelection = ref<DataSelection | null>(null);
  const loadedData = shallowRef<Array<LoadedData>>([]);

  // --- getters --- //

  const primaryImageID = primarySelection;

  const primaryDataset = computed<vtkImageData | null>(() => {
    const { dataIndex } = imageStore;
    return (primaryImageID.value && dataIndex[primaryImageID.value]) || null;
  });

  const idsAsSelections = computed(() => {
    const volumeKeys = Object.keys(dicomStore.volumeInfo);
    const images = imageStore.idList.filter((id) => isRegularImage(id));
    return [...volumeKeys, ...images];
  });

  // --- actions --- //

  function setPrimarySelection(sel: DataSelection | null) {
    primarySelection.value = sel;
  }

  async function serialize(stateFile: Schema.StateFile) {
    const { manifest, zip } = stateFile;

    const { serializedDependencies, dataIDToDataSourceID, files } =
      serializeLoadedData(loadedData.value);

    // save datasets and data sources
    manifest.datasets = loadedData.value.map(({ dataID }) => ({
      id: dataID,
      dataSourceId: dataIDToDataSourceID[dataID],
    }));
    manifest.dataSources = serializedDependencies;

    // add any locally loaded files
    manifest.datasetFilePath = {};
    Object.entries(files).forEach(([fileId, file]) => {
      const filePath = `data/${fileId}/${file.name}`;
      zip.file(filePath, file);
      manifest.datasetFilePath[fileId] = filePath;
    });

    if (primarySelection.value) {
      manifest.primarySelection = primarySelection.value;
    }
  }

  const remove = (id: string) => {
    if (id === primarySelection.value) {
      primarySelection.value = null;
    }

    if (isDicomImage(id)) {
      dicomStore.deleteVolume(id);
    }
    imageStore.deleteData(id);

    layersStore.remove(id);
  };

  function addDataSources(sources: Array<LoadedData>) {
    loadedData.value.push(...sources);
  }

  return {
    primaryImageID,
    primarySelection,
    primaryDataset,
    idsAsSelections,
    addDataSources,
    setPrimarySelection,
    serialize,
    remove,
  };
});
