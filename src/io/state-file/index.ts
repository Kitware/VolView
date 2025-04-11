import JSZip from 'jszip';
import { useDatasetStore } from '@/src/store/datasets';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useViewStore } from '@/src/store/views';
import { LayoutDirection } from '@/src/types/layout';
import { Manifest } from './schema';

import { retypeFile } from '../io';
import { ARCHIVE_FILE_TYPES } from '../mimeTypes';

export const MANIFEST = 'manifest.json';
export const MANIFEST_VERSION = '5.0.0';

export async function serialize() {
  const datasetStore = useDatasetStore();
  const viewStore = useViewStore();
  const labelStore = useSegmentGroupStore();
  const toolStore = useToolStore();
  const layersStore = useLayersStore();

  const zip = new JSZip();
  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    datasets: [],
    dataSources: [],
    datasetFilePath: {},
    labelMaps: [],
    tools: {
      crosshairs: {
        position: [0, 0, 0],
      },
      paint: {
        activeSegmentGroupID: null,
        activeSegment: null,
        brushSize: 8,
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
    const zip = await JSZip.loadAsync(typedFile);

    return zip.file(MANIFEST) !== null;
  }

  return false;
}
