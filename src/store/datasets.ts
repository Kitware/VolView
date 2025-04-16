import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import {
  isDicomImage,
  isRegularImage,
  type DataSelection,
} from '@/src/utils/dataSelection';
import { DataSource } from '@/src/io/import/dataSource';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDICOMStore } from './datasets-dicom';
import { useImageStore } from './datasets-images';
import * as Schema from '../io/state-file/schema';
import { useLayersStore } from './datasets-layers';
import { useModelStore } from './datasets-models';

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

    // don't need to serialize all parents, just the ones that are necessary.
    const { type } = ds;
    if (type === 'file') {
      // file derives from the parent. Just return the serialized parent.
      if (ds.parent) {
        return serializeDataSource(ds.parent);
      }

      const id = nextId();
      dataSourceToId.set(ds, id);

      const fileId = nextId();
      files[fileId] = ds.file;
      serializedDependencies.push({
        id,
        type: 'file',
        fileId,
        fileType: ds.fileType,
      });
      return id;
    }

    if (type === 'archive') {
      const parentId = serializeDataSource(ds.parent);
      const id = nextId();
      dataSourceToId.set(ds, id);

      serializedDependencies.push({
        id,
        type: 'archive',
        path: ds.path,
        parent: parentId,
      });
      return id;
    }

    if (type === 'uri') {
      const id = nextId();
      dataSourceToId.set(ds, id);

      serializedDependencies.push({
        id,
        type: 'uri',
        name: ds.name,
        uri: ds.uri,
        mime: ds.mime,
      });
      return id;
    }

    if (type === 'collection') {
      const id = nextId();
      dataSourceToId.set(ds, id);

      serializedDependencies.push({
        id,
        type: 'collection',
        sources: ds.sources.map((src) => serializeDataSource(src)),
      });
      return id;
    }

    if (type === 'chunk') {
      // chunk derives from the parent. Just return the serialized parent.
      if (ds.parent) {
        return serializeDataSource(ds.parent);
      }
      throw new Error('Chunk does not have a parent');
    }

    throw new Error(`Invalid data source type: ${type as string}`);
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
  const imageCacheStore = useImageCacheStore();
  const dicomStore = useDICOMStore();
  const layersStore = useLayersStore();
  const modelStore = useModelStore();

  // --- state --- //

  const primarySelection = ref<DataSelection | null>(null);
  const loadedData = shallowRef<Array<LoadedData>>([]);

  // --- getters --- //

  const primaryImageID = primarySelection;

  const primaryDataset = computed<vtkImageData | null>(() => {
    return (
      (primaryImageID.value &&
        imageCacheStore.imageById[primaryImageID.value].getVtkImageData()) ||
      null
    );
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

  const remove = (id: string | null) => {
    if (!id) return;

    if (id === primarySelection.value) {
      primarySelection.value = null;
    }

    if (isDicomImage(id)) {
      dicomStore.deleteVolume(id);
    }
    imageStore.deleteData(id);

    layersStore.remove(id);
  };

  const removeAll = () => {
    // Create a copy to avoid iteration issue while removing data
    const imageIdCopy = [...imageStore.idList];
    imageIdCopy.forEach((id) => {
      remove(id);
    });

    const modelIdCopy = [...modelStore.idList];
    modelIdCopy.forEach((id) => {
      remove(id);
    });
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
    removeAll,
  };
});
