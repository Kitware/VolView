import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { useDatasetStore } from '@/src/store/datasets';
import { useViewStore } from '@/src/store/views';
import { seatImage } from '@/src/segmentation/__tests__/segmentMaskFixtures';
import type { TaskFormModel } from '../formModel';

/** A task whose only parameter takes the active image's segmentation. */
export const labelmapTaskModel: TaskFormModel = {
  id: 'task',
  title: 'Task',
  fields: [
    {
      kind: 'sourceRef',
      id: 'inputSeg',
      accepts: ['labelmap'],
      required: true,
    },
  ],
  hidden: [],
};

/**
 * The least a staged input needs: an active image that carries the server
 * provenance a staged file references.
 */
export async function seatStagingScene(imageId = 'image-1') {
  const pinia = createPinia().use(CorePiniaProviderPlugin());
  createApp({}).use(pinia);
  setActivePinia(pinia);
  await seatImage(imageId, { name: 'image.nrrd', dimensions: [2, 2, 2] });
  useDatasetStore().addDataSources([
    {
      dataID: imageId,
      dataSource: {
        type: 'uri',
        uri: `girder://file/${imageId}`,
        name: 'image.nrrd',
      },
    },
  ]);
  useViewStore().setDataForAllViews(imageId);
}
