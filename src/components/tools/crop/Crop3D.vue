<script lang="ts">
import { useImage } from '@/src/composables/useCurrentImage';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useCropStore } from '@/src/store/tools/crop';
import { LPSCroppingPlanes } from '@/src/types/crop';
import { arrayEquals } from '@/src/utils';
import { getAxisBounds, LPSAxes } from '@/src/utils/lps';
import type { Bounds } from '@kitware/vtk.js/types';
import vtkImageCroppingWidget, {
  ImageCroppingWidgetState,
  vtkImageCroppingViewWidget,
} from '@kitware/vtk.js/Widgets/Widgets3D/ImageCroppingWidget';
import {
  computed,
  DeepReadonly,
  defineComponent,
  inject,
  onBeforeUnmount,
  PropType,
  toRefs,
} from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { Maybe } from '@/src/types';
import { watchImmediate } from '@vueuse/core';

function isValidCroppingPlanes(planes: LPSCroppingPlanes) {
  return (
    planes.Sagittal[0] <= planes.Sagittal[1] &&
    planes.Coronal[0] <= planes.Coronal[1] &&
    planes.Axial[0] <= planes.Axial[1]
  );
}

function lpsPlanesEqual(a: LPSCroppingPlanes, b: LPSCroppingPlanes) {
  return (
    a.Axial[0] === b.Axial[0] &&
    a.Axial[1] === b.Axial[1] &&
    a.Sagittal[0] === b.Sagittal[0] &&
    a.Sagittal[1] === b.Sagittal[1] &&
    a.Coronal[0] === b.Coronal[0] &&
    a.Coronal[1] === b.Coronal[1]
  );
}

export default defineComponent({
  props: {
    imageId: String as PropType<Maybe<string>>,
  },
  setup(props) {
    const view = inject(VtkViewContext);
    if (!view) throw new Error('No VtkView');

    console.log('whee');

    const { widgetManager } = view;

    const { imageId } = toRefs(props);

    const cropStore = useCropStore();
    const croppingPlanes = computed(() => {
      const id = imageId.value;
      if (id && id in cropStore.croppingByImageID) {
        return cropStore.croppingByImageID[id];
      }
      return null;
    });

    const factory = vtkImageCroppingWidget.newInstance();
    const state = factory.getWidgetState() as ImageCroppingWidgetState;

    factory.setEdgeHandlesEnabled(false);
    factory.setFaceHandlesEnabled(true);
    factory.setCornerHandlesEnabled(true);

    const widget = widgetManager.addWidget(
      factory
    ) as vtkImageCroppingViewWidget;

    // update representation to not be as 3D
    widget.getRepresentations().forEach((rep) => {
      rep.getActors().forEach((actor) => {
        actor.getProperty().setAmbient(1);
      });
    });

    onBeforeUnmount(() => {
      widgetManager.removeWidget(factory);
    });

    const { metadata: imageMetadata } = useImage(imageId);
    watchImmediate(imageMetadata, (metadata) => {
      state.setWorldToIndexT(metadata.worldToIndex);
      state.setIndexToWorldT(metadata.indexToWorld);
      state.placeWidget(metadata.worldBounds);
    });

    const applyPlanes = (lpsPlanes: DeepReadonly<LPSCroppingPlanes>) => {
      const { lpsOrientation: dirs } = imageMetadata.value;
      // LPSCroppingPlanes -> Bounds
      const planes = [0, 0, 0, 0, 0, 0] as Bounds;
      LPSAxes.forEach((axis) => {
        [planes[dirs[axis] * 2], planes[dirs[axis] * 2 + 1]] = lpsPlanes[axis];
      });

      // prevent infinite loops
      if (!arrayEquals(planes, state.getCroppingPlanes().getPlanes())) {
        state.getCroppingPlanes().setPlanes(planes);
        view.requestRender();
      }
    };

    watchImmediate(croppingPlanes, (lpsPlanes) => {
      if (lpsPlanes) {
        applyPlanes(lpsPlanes);
      }
    });

    onVTKEvent(state.getCroppingPlanes(), 'onModified', () => {
      const id = imageId.value;
      if (!id) return;

      // Bounds -> LPSCroppingPlanes
      const planes = state.getCroppingPlanes().getPlanes();
      const { lpsOrientation } = imageMetadata.value;
      const lpsPlanes: LPSCroppingPlanes = {
        Sagittal: getAxisBounds(planes, 'Sagittal', lpsOrientation),
        Coronal: getAxisBounds(planes, 'Coronal', lpsOrientation),
        Axial: getAxisBounds(planes, 'Axial', lpsOrientation),
      };

      // avoid updates if equal
      const planesFromStore = croppingPlanes.value;
      if (
        planesFromStore &&
        lpsPlanesEqual(lpsPlanes, planesFromStore as LPSCroppingPlanes)
      ) {
        return;
      }

      if (isValidCroppingPlanes(lpsPlanes)) {
        cropStore.setCropping(id, lpsPlanes);
      } else if (planesFromStore) {
        applyPlanes(planesFromStore);
      }
    });

    return () => null;
  },
});
</script>
