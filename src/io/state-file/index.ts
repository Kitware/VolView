import { useDatasetStore } from '@/src/store/datasets';
import { useLabelmapStore } from '@/src/store/datasets-labelmaps';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useViewStore } from '@/src/store/views';
import { LayoutDirection } from '@/src/types/layout';
import { Manifest } from './schema';

import { retypeFile } from '../io';
import { ARCHIVE_FILE_TYPES } from '../mimeTypes';

const importJSZip = () => import('@/src/lazy/lazyJSZip');

export const MANIFEST = 'manifest.json';
export const MANIFEST_VERSION = '2.1.0';

export async function serialize() {
  const datasetStore = useDatasetStore();
  const viewStore = useViewStore();
  const labelStore = useLabelmapStore();
  const toolStore = useToolStore();
  const layersStore = useLayersStore();

  const { JSZip } = await importJSZip();
  const zip = new JSZip();
  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    datasets: [],
    remoteFiles: {},
    labelMaps: [],
    tools: {
      crosshairs: {
        position: [0, 0, 0],
      },
      paint: {
        activeLabelmapID: null,
        brushSize: 8,
        brushValue: 1,
        labelmapOpacity: 1,
      },
      crop: {},
      current: Tools.WindowLevel,
    },
    layout: {
      direction: LayoutDirection.H,
      items: [],
    },
    views: [],
    parentToLayers: [],
  };

  const stateFile = {
    zip,
    manifest,
  };

  await datasetStore.serialize(stateFile);
  viewStore.serialize(stateFile);
  await labelStore.serialize(stateFile);
  toolStore.serialize(stateFile);
  await layersStore.serialize(stateFile);

  zip.file(MANIFEST, JSON.stringify(manifest));

  return zip.generateAsync({ type: 'blob' });
}

export async function isStateFile(file: File) {
  const typedFile = await retypeFile(file);
  if (ARCHIVE_FILE_TYPES.has(typedFile.type)) {
    const { JSZip } = await importJSZip();
    const zip = await JSZip.loadAsync(typedFile);

    return zip.file(MANIFEST) !== null;
  }

  return false;
}
