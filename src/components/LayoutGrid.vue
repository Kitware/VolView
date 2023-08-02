<template>
  <div
    class="layout-container flex-equal"
    :class="flexFlow"
    data-testid="layout-grid"
  >
    <div v-for="(item, i) in items" :key="i" class="d-flex flex-equal">
      <layout-grid v-if="item.type === 'layout'" :layout="item" />
      <div v-else class="layout-item">
        <component
          :is="item.component"
          :key="item.id"
          :id="item.id"
          v-bind="item.props"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, computed, defineComponent, PropType, provide, ref, toRefs, watch } from 'vue';
import { storeToRefs } from 'pinia';
import vtkResliceCursorWidget, { ResliceCursorWidgetState } from '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';
import type { Matrix3x3 } from '@kitware/vtk.js/types';
import { ViewTypes } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';
import VtkTwoView from './VtkTwoView.vue';
import VtkObliqueView from './VtkObliqueView.vue';
import VtkThreeView from './VtkThreeView.vue';
import { Layout, LayoutDirection } from '../types/layout';
import { useViewStore } from '../store/views';
import { ViewType } from '../types/views';
import { VTKResliceCursor } from '../constants';

const TYPE_TO_COMPONENT: Record<ViewType, Component> = {
  '2D': VtkTwoView,
  '3D': VtkThreeView,
  'Oblique': VtkObliqueView,
};

export default defineComponent({
  name: 'LayoutGrid',
  props: {
    layout: {
      type: Object as PropType<Layout>,
      required: true,
    },
  },
  setup(props) {
    const { layout } = toRefs(props);
    const viewStore = useViewStore();
    const { viewSpecs } = storeToRefs(viewStore);
    const { currentImageData } = useCurrentImage();

    const flexFlow = computed(() => {
      return layout.value.direction === LayoutDirection.H
        ? 'flex-column'
        : 'flex-row';
    });

    const items = computed(() => {
      const viewIDToSpecs = viewSpecs.value;
      return layout.value.items.map((item) => {
        if (typeof item === 'string') {
          const spec = viewIDToSpecs[item];
          return {
            type: 'view',
            id: item,
            component: TYPE_TO_COMPONENT[spec.viewType],
            props: spec.props,
          };
        }
        return {
          type: 'layout',
          ...item,
        };
      });
    });

    // Construct the common instance of vtkResliceCursorWidget and provide it
    // to all the child ObliqueView components.
    const resliceCursor = ref<vtkResliceCursorWidget>(vtkResliceCursorWidget.newInstance({
      scaleInPixels: true,
      rotationHandlePosition: 0.75,
    }));
    provide(VTKResliceCursor, resliceCursor);
    // Orient the planes of the vtkResliceCursorWidget to the orientation
    // of the currently set image.
    const resliceCursorState = resliceCursor.value.getWidgetState() as ResliceCursorWidgetState;

    // Temporary fix to disable race between PanTool and ResliceCursorWidget
    resliceCursorState.setScrollingMethod(-1);

    watch(currentImageData, (image) => {
      if (image && resliceCursor.value) {
        resliceCursor.value.setImage(image);
        // Reset to default plane values before transforming based on current image-data.
        resliceCursorState.setPlanes({
          [ViewTypes.YZ_PLANE]: {
            normal: [1, 0, 0],
            viewUp: [0, 0, 1],
            color3: [255, 0, 0],
          },
          [ViewTypes.XZ_PLANE]: {
            normal: [0, -1, 0],
            viewUp: [0, 0, 1],
            color3: [0, 255, 0],
          },
          [ViewTypes.XY_PLANE]: {
            normal: [0, 0, -1],
            viewUp: [0, -1, 0],
            color3: [0, 0, 255],
          }
        });
        const planes = resliceCursorState.getPlanes();

        const d9 = image.getDirection();
        const mat = Array.from(d9) as Matrix3x3;
        vtkMath.invert3x3(mat, mat);

        Object.values(planes).forEach((plane) => {
          const {normal, viewUp} = plane;
          vtkMath.multiply3x3_vect3(mat as Matrix3x3, normal, normal);
          vtkMath.multiply3x3_vect3(mat as Matrix3x3, viewUp, viewUp);
        });
      }
    });

    return {
      items,
      flexFlow,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/utils.css"></style>

<style scoped>
.layout-container {
  display: flex;
  flex-direction: column;
}

.layout-item {
  display: flex;
  flex: 1;
  border: 1px solid #222;
}
</style>
