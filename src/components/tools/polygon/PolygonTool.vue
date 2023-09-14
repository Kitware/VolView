<script lang="ts">
import { createAnnotationToolComponent } from '@/src/components/tools/createAnnotationToolComponent';
import { createPlacingWidget2DComponent } from '@/src/components/tools/createPlacingWidget2DComponent';
import { createWidget2DComponent } from '@/src/components/tools/createWidget2DComponent';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { Tools } from '@/src/store/tools/types';
import type { PolygonStore } from '@/src/store/tools/polygons';
import vtkPolygonWidget, {
  vtkPolygonViewWidget,
  vtkPolygonWidgetState,
} from '@/src/vtk/PolygonWidget';
import {
  PolygonInitState,
  PolygonSyncedState,
  useSyncedPolygonState,
} from '@/src/components/tools/polygon/common';
import { WidgetComponentMeta } from '@/src/components/tools/common';
import PolygonSVG2D from '@/src/components/tools/polygon/PolygonSVG2D.vue';
import createStandaloneState from '@/src/vtk/PolygonWidget/standaloneState';
import createPolygonWidgetState from '@/src/vtk/PolygonWidget/storeState';
import { PolygonID } from '@/src/types/polygon';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { h } from 'vue';

const componentMeta: WidgetComponentMeta<
  PolygonID,
  PolygonStore,
  vtkPolygonWidgetState,
  vtkPolygonWidget,
  vtkPolygonViewWidget,
  PolygonSyncedState,
  PolygonInitState
> = {
  name: 'PolygonWidget',
  useToolStore: usePolygonStore,
  createStandaloneState: () => createStandaloneState() as vtkPolygonWidgetState,
  createStoreBackedState: (toolId: string, store: PolygonStore) =>
    createPolygonWidgetState({ id: toolId, store }),
  createWidgetFactory: (widgetState) =>
    vtkPolygonWidget.newInstance({ widgetState }),
  useSyncedState: useSyncedPolygonState,
  resetPlacingWidget: (widget) => {
    widget.reset();
    widget.getWidgetState().setPlacing(true);
  },
  constructInitState: (syncedState) => {
    return {
      points: syncedState.points,
    };
  },
  render: (viewId, syncedState, labelProps, tool) => {
    return h(PolygonSVG2D, {
      viewId,
      points: syncedState.points,
      color: labelProps?.color,
      movePoint: syncedState.movePoint,
      placing: !tool,
    });
  },
};

const Widget2DComponent = createWidget2DComponent({
  ...componentMeta,
  name: 'PolygonWidget2D',
});

const PlacingWidget2DComponent = createPlacingWidget2DComponent({
  ...componentMeta,
  name: 'PlacingPolygonWidget2D',
});

export default createAnnotationToolComponent<
  PolygonID,
  AnnotationToolStore<PolygonID>
>({
  name: 'PolygonTool',
  type: Tools.Polygon,
  useToolStore: usePolygonStore,
  Widget2DComponent,
  PlacingWidget2DComponent,
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
