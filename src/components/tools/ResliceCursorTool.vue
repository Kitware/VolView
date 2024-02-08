<script lang="ts">
import { useViewStore } from '@/src/store/views';
import {
  computed,
  defineComponent,
  inject,
  onBeforeUnmount,
  ref,
  toRefs,
  watch,
} from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import {
  vtkResliceCursorViewWidget,
  ResliceCursorWidgetState,
} from '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget';
import { OBLIQUE_OUTLINE_COLORS, VTKResliceCursor } from '@/src/constants';
import { onViewProxyMounted } from '@/src/composables/useViewProxy';
import { getLPSAxisFromDir, getVTKViewTypeFromLPSAxis } from '@/src/utils/lps';
import { LPSAxisDir } from '@/src/types/lps';
import { InitViewIDs } from '../../config';

export default defineComponent({
  props: {
    viewId: {
      type: String,
      required: true,
    },
    viewDirection: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const active = true;
    const { viewId: viewID, viewDirection } = toRefs(props);

    const { currentImageMetadata: curImageMetadata, currentImageData } =
      useCurrentImage();

    const viewStore = useViewStore();
    const viewProxy = computed(
      () => viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value)!
    );
    const widgetManager = computed(() => viewProxy.value.getWidgetManager());

    const viewType = computed(() => {
      return viewStore.viewSpecs[viewID.value].viewType;
    });

    const resliceCursor = inject(VTKResliceCursor);
    if (!resliceCursor) {
      throw new Error('Cannot fetch global instance of ResliceCursor');
    }

    const state = resliceCursor.getWidgetState() as ResliceCursorWidgetState;
    const widget = ref<vtkResliceCursorViewWidget>();

    const VTKViewType = computed(() => {
      const viewAxis = getLPSAxisFromDir(viewDirection.value as LPSAxisDir);
      return getVTKViewTypeFromLPSAxis(viewAxis);
    });

    watch(widgetManager, (wm, oldWm) => {
      if (oldWm) {
        oldWm.removeWidget(resliceCursor);
      }
      if (wm) {
        widget.value = wm.addWidget(
          resliceCursor,
          VTKViewType.value
        ) as vtkResliceCursorViewWidget;
      }
    });

    onViewProxyMounted(viewProxy, () => {
      if (widgetManager?.value) {
        widget.value = widgetManager.value.addWidget(
          resliceCursor,
          VTKViewType.value
        ) as vtkResliceCursorViewWidget;

        widget.value.setKeepOrthogonality(true);
        // reset mouse cursor styles
        widget.value.setCursorStyles({
          translateCenter: 'default',
          rotateLine: 'default',
          translateAxis: 'default',
        });

        state.getStatesWithLabel('sphere').forEach((handle) => {
          const h = handle as ResliceCursorWidgetState;
          h.setScale1(10);
          h.setOpacity(128);
        });

        state.getStatesWithLabel('line').forEach((handle) => {
          const h = handle as ResliceCursorWidgetState;
          h.setScale3(1, 1, 1);
          h.setOpacity(100);
        });

        const xLines = [
          ...state.getStatesWithLabel('XinZ'),
          ...state.getStatesWithLabel('XinY'),
        ];
        xLines.forEach((handle) => {
          const h = handle as ResliceCursorWidgetState;
          h.setColor3(OBLIQUE_OUTLINE_COLORS[InitViewIDs.ObliqueSagittal]);
        });

        const yLines = [
          ...state.getStatesWithLabel('YinZ'),
          ...state.getStatesWithLabel('YinX'),
        ];
        yLines.forEach((handle) => {
          const h = handle as ResliceCursorWidgetState;
          h.setColor3(OBLIQUE_OUTLINE_COLORS[InitViewIDs.ObliqueCoronal]);
        });

        const zLines = [
          ...state.getStatesWithLabel('ZinX'),
          ...state.getStatesWithLabel('ZinY'),
        ];
        zLines.forEach((handle) => {
          const h = handle as ResliceCursorWidgetState;
          h.setColor3(OBLIQUE_OUTLINE_COLORS[InitViewIDs.ObliqueAxial]);
        });

        // update representation to not be as 3D
        widget.value.getRepresentations().forEach((rep) => {
          rep.getActors().forEach((actor) => {
            actor.getProperty().setAmbient(1);
          });
        });

        // show widget
        viewProxy.value.renderLater();
      }
    });

    onBeforeUnmount(() => {
      if (widgetManager?.value) {
        widgetManager.value.removeWidget(resliceCursor);
      }
    });

    watch(
      curImageMetadata,
      (metadata) => {
        state.placeWidget(metadata.worldBounds);
      },
      { immediate: true }
    );

    watch(
      currentImageData,
      (currImage) => {
        if (resliceCursor && currImage) {
          resliceCursor.setImage(currImage);
        }
      },
      { immediate: true }
    );

    return {
      active,
      viewType,
    };
  },
});
</script>

<template>
  <div></div>
</template>
