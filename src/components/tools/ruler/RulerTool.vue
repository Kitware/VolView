<script lang="ts">
import { createAnnotationToolComponent } from '@/src/components/tools/createAnnotationToolComponent';
import { createPlacingWidget2DComponent } from '@/src/components/tools/createPlacingWidget2DComponent';
import { createWidget2DComponent } from '@/src/components/tools/createWidget2DComponent';
import { useRulerStore } from '@/src/store/tools/rulers';
import { Tools } from '@/src/store/tools/types';
import type { RulerStore } from '@/src/store/tools/rulers';
import vtkRulerWidget, {
  InteractionState,
  vtkRulerViewWidget,
  vtkRulerWidgetState,
} from '@/src/vtk/RulerWidget';
import {
  RulerInitState,
  RulerSyncedState,
  useSyncedRulerState,
} from '@/src/components/tools/ruler/common';
import createStandaloneState from '@/src/vtk/RulerWidget/standaloneState';
import RulerSVG2D from '@/src/components/tools/ruler/RulerSVG2D.vue';
import { WidgetComponentMeta } from '@/src/components/tools/common';
import createRulerWidgetState from '@/src/vtk/RulerWidget/storeState';
import { h } from 'vue';

const componentMeta: WidgetComponentMeta<
  string,
  RulerStore,
  vtkRulerWidgetState,
  vtkRulerWidget,
  vtkRulerViewWidget,
  RulerSyncedState,
  RulerInitState
> = {
  name: '',
  useToolStore: useRulerStore,
  createStandaloneState: () => createStandaloneState() as vtkRulerWidgetState,
  createStoreBackedState: (toolId: string, store: RulerStore) =>
    createRulerWidgetState({ id: toolId, store }),
  createWidgetFactory: (widgetState) =>
    vtkRulerWidget.newInstance({ widgetState }),
  useSyncedState: useSyncedRulerState,
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
    return h(RulerSVG2D, {
      viewId,
      syncedState,
      labelProps,
    });
  },
};

const Widget2DComponent = createWidget2DComponent({
  ...componentMeta,
  name: 'RulerWidget2D',
});

const PlacingWidget2DComponent = createPlacingWidget2DComponent({
  ...componentMeta,
  name: 'PlacingRulerWidget2D',
});

export default createAnnotationToolComponent({
  name: 'RulerTool',
  type: Tools.Ruler,
  useToolStore: useRulerStore,
  Widget2DComponent,
  PlacingWidget2DComponent,
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
