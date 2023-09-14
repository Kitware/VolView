<script lang="ts">
import { createAnnotationToolComponent } from '@/src/components/tools/createAnnotationToolComponent';
import { createPlacingWidget2DComponent } from '@/src/components/tools/createPlacingWidget2DComponent';
import { createWidget2DComponent } from '@/src/components/tools/createWidget2DComponent';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { Tools } from '@/src/store/tools/types';
import type { RectangleStore } from '@/src/store/tools/rectangles';
import vtkRectangleWidget, {
  InteractionState,
  vtkRectangleViewWidget,
  vtkRectangleWidgetState,
} from '@/src/vtk/RectangleWidget';
import {
  RectangleInitState,
  RectangleSyncedState,
  useSyncedRectangleState,
} from '@/src/components/tools/rectangle/common';
import { WidgetComponentMeta } from '@/src/components/tools/common';
import RectangleSVG2D from '@/src/components/tools/rectangle/RectangleSVG2D.vue';
// Rectangle is just another case of the Ruler
import createStandaloneState from '@/src/vtk/RulerWidget/standaloneState';
import createRectangleWidgetState from '@/src/vtk/RulerWidget/storeState';
import { RectangleID } from '@/src/types/rectangle';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { h } from 'vue';

const componentMeta: WidgetComponentMeta<
  RectangleID,
  RectangleStore,
  vtkRectangleWidgetState,
  vtkRectangleWidget,
  vtkRectangleViewWidget,
  RectangleSyncedState,
  RectangleInitState
> = {
  name: '',
  useToolStore: useRectangleStore,
  createStandaloneState: () =>
    createStandaloneState() as vtkRectangleWidgetState,
  createStoreBackedState: (toolId: string, store: RectangleStore) =>
    createRectangleWidgetState({ id: toolId, store }),
  createWidgetFactory: (widgetState) =>
    vtkRectangleWidget.newInstance({ widgetState }),
  useSyncedState: useSyncedRectangleState,
  resetPlacingWidget: (widget) => {
    widget.resetInteractions();
    widget.setInteractionState(InteractionState.PlacingFirst);
  },
  constructInitState: (syncedState) => {
    const { firstPoint, secondPoint } = syncedState;
    if (!firstPoint.origin || !secondPoint.origin)
      throw new Error('Incomplete placing widget state');
    return {
      firstPoint: firstPoint.origin,
      secondPoint: secondPoint.origin,
    };
  },
  render: (viewId, syncedState, labelProps) => {
    const { firstPoint, secondPoint } = syncedState;
    return h(RectangleSVG2D, {
      viewId,
      point1: firstPoint.visible ? firstPoint.origin : null,
      point2: secondPoint.visible ? secondPoint.origin : null,
      color: labelProps?.color,
      fillColor: labelProps?.fillColor,
    });
  },
};

const Widget2DComponent = createWidget2DComponent({
  ...componentMeta,
  name: 'RectangleWidget2D',
});

const PlacingWidget2DComponent = createPlacingWidget2DComponent({
  ...componentMeta,
  name: 'PlacingRectangleWidget2D',
});

export default createAnnotationToolComponent<
  RectangleID,
  AnnotationToolStore<RectangleID>
>({
  name: 'RectangleTool',
  type: Tools.Rectangle,
  useToolStore: useRectangleStore,
  Widget2DComponent,
  PlacingWidget2DComponent,
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
