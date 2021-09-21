<template>
  <div id="spleen-module" class="mx-2 height-100">
    <v-btn
      :disabled="!canSegment || loading"
      :loading="loading"
      @click="segmentCurrentImage"
    >
      Segment
    </v-btn>
  </div>
</template>

<script>
import { computed, defineComponent, ref, unref } from '@vue/composition-api';

import { useStore, useComputedState } from '@/src/composables/store';
import { useWidgetProvider } from '@/src/composables/widgetProvider';
import HostConnection from '@/server/host';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { DEFAULT_LABELMAP_COLORS } from '@/src/constants';

function copyImageToLabelMap(imageData) {
  const labelmap = vtkLabelMap.newInstance(
    imageData.get('spacing', 'origin', 'direction')
  );
  labelmap.setDimensions(imageData.getDimensions());
  labelmap.getPointData().setScalars(imageData.getPointData().getScalars());
  labelmap.computeTransforms();

  labelmap.setColorMap(DEFAULT_LABELMAP_COLORS);
  return labelmap;
}

export default defineComponent({
  name: 'SpleenModule',
  setup() {
    const loading = ref(false);

    const store = useStore();
    const widgetProvider = useWidgetProvider();

    const { currentImageId, currentImage } = useComputedState({
      currentImageId(state) {
        return state.selectedBaseImage;
      },
      currentImage(state) {
        return state.data.vtkCache[state.selectedBaseImage] ?? null;
      },
    });

    const canSegment = computed(() => Boolean(currentImage.value));

    const connection = new HostConnection('ws://localhost:8888/ws');
    connection.connect();

    async function segmentCurrentImage() {
      const curImage = unref(currentImage);
      const curImageId = unref(currentImageId);
      if (curImage) {
        loading.value = true;

        const result = await connection.call('run', currentImage.value, 44);
        console.log('got result:', result);
        const { segmentation, measurements } = result;

        const segMap = copyImageToLabelMap(segmentation);
        await store.dispatch('importLabelMap', {
          name: 'whodis',
          labelMap: segMap,
          parent: curImageId,
        });

        measurements.measurements.map((mm) => {
          const rulerState = {
            version: '1.0',
            type: 'ruler',
            name: mm.name,
            axis: 'IJK'[mm.axis.findIndex((v) => v === 1)],
            slice: mm.slice,
            system: mm.coordinate_system,
            point1: mm.point1,
            point2: mm.point2,
          };

          return widgetProvider.createWidget('Ruler', {
            initialState: rulerState,
          });
        });

        loading.value = false;
      }
    }

    return {
      canSegment,
      segmentCurrentImage,
      loading,
    };
  },
});
</script>
