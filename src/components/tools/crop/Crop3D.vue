<script lang="ts">
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useVTKCallback } from '@/src/composables/useVTKCallback';
import { VTKThreeViewWidgetManager } from '@/src/constants';
import { useCropStore } from '@/src/store/tools/crop';
import { LPSCroppingPlanes } from '@/src/store/tools/types';
import { useViewStore } from '@/src/store/views';
import { arrayEquals } from '@/src/utils';
import { getAxisBounds, LPSAxes } from '@/src/utils/lps';
import vtkLPSView3DProxy from '@/src/vtk/LPSView3DProxy';
import { Bounds } from '@kitware/vtk.js/types';
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
  onMounted,
  ref,
  toRefs,
  watch,
} from '@vue/composition-api';

function isValidCroppingPlanes(planes: LPSCroppingPlanes) {
  return (
    planes.Sagittal[0] <= planes.Sagittal[1] &&
    planes.Coronal[0] <= planes.Coronal[1] &&
    planes.Axial[0] <= planes.Axial[1]
  );
}

export default defineComponent({
  props: {
    viewId: {
      type: String,
      required: true,
    },
  },

  setup(props) {
    const { viewId: viewID } = toRefs(props);

    const widgetManager = inject(VTKThreeViewWidgetManager);
    if (!widgetManager) {
      throw new Error('Crop3D component cannot access the 2D widget manager.');
    }

    const viewStore = useViewStore();
    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView3DProxy>(viewID.value)!
    );

    const cropStore = useCropStore();
    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const croppingPlanes = computed(() => {
      const imageID = currentImageID.value;
      if (imageID && imageID in cropStore.croppingByImageID) {
        return cropStore.croppingByImageID[imageID];
      }
      return null;
    });

    const factory = vtkImageCroppingWidget.newInstance();
    const state = factory.getWidgetState() as ImageCroppingWidgetState;

    factory.setEdgeHandlesEnabled(false);
    factory.setFaceHandlesEnabled(true);
    factory.setCornerHandlesEnabled(true);

    const widget = ref<vtkImageCroppingViewWidget>();

    watch(widgetManager, (wm, oldWm) => {
      if (oldWm) {
        oldWm.removeWidget(factory);
      }
      if (wm) {
        widget.value = wm.addWidget(factory) as vtkImageCroppingViewWidget;
      }
    });

    onMounted(() => {
      if (widgetManager.value) {
        widget.value = widgetManager.value.addWidget(
          factory
        ) as vtkImageCroppingViewWidget;

        // update representation to not be as 3D
        widget.value.getRepresentations().forEach((rep) => {
          rep.getActors().forEach((actor) => {
            actor.getProperty().setAmbient(1);
          });
        });

        // show widget
        viewProxy.value.render();
      }
    });

    onBeforeUnmount(() => {
      if (widgetManager.value) {
        widgetManager.value.removeWidget(factory);
      }
    });

    watch(
      currentImageMetadata,
      (metadata) => {
        state.setWorldToIndexT(metadata.worldToIndex);
        state.setIndexToWorldT(metadata.indexToWorld);
      },
      { immediate: true }
    );

    const applyPlanes = (lpsPlanes: DeepReadonly<LPSCroppingPlanes>) => {
      const { lpsOrientation: dirs } = currentImageMetadata.value;
      // LPSCroppingPlanes -> Bounds
      const planes = [0, 0, 0, 0, 0, 0] as Bounds;
      LPSAxes.forEach((axis) => {
        [planes[dirs[axis] * 2], planes[dirs[axis] * 2 + 1]] = lpsPlanes[axis];
      });

      // prevent infinite loops
      if (!arrayEquals(planes, state.getCroppingPlanes().getPlanes())) {
        state.getCroppingPlanes().setPlanes(planes);
      }
      // render any changes
      viewProxy.value.render();
    };

    watch(
      croppingPlanes,
      (lpsPlanes) => {
        if (lpsPlanes) {
          applyPlanes(lpsPlanes);
        }
      },
      { immediate: true }
    );

    const onPlanesUpdated = useVTKCallback(
      state.getCroppingPlanes().onModified
    );

    onPlanesUpdated(() => {
      const imageID = currentImageID.value;
      if (!imageID) return;

      // Bounds -> LPSCroppingPlanes
      const planes = state.getCroppingPlanes().getPlanes();
      const { lpsOrientation } = currentImageMetadata.value;
      const lpsPlanes: LPSCroppingPlanes = {
        Sagittal: getAxisBounds(planes, 'Sagittal', lpsOrientation),
        Coronal: getAxisBounds(planes, 'Coronal', lpsOrientation),
        Axial: getAxisBounds(planes, 'Axial', lpsOrientation),
      };

      if (isValidCroppingPlanes(lpsPlanes)) {
        cropStore.setCropping(imageID, lpsPlanes);
      } else if (croppingPlanes.value) {
        applyPlanes(croppingPlanes.value);
      }
    });

    return () => null;
  },
});
</script>
