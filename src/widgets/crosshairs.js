import { vec3 } from 'gl-matrix';
import vtkCrosshairsWidget from '@/src/vtk/CrosshairsWidget';
import {
  onViewMouseEvent,
  onAddedToView,
  onWidgetStateChanged,
  onBeforeDelete,
} from './context';

export default {
  setup({ store, widgetInstances }) {
    const factory = vtkCrosshairsWidget.newInstance();
    const widgetState = factory.getWidgetState();
    const {
      extent,
      spacing,
      worldToIndex,
      indexToWorld,
    } = store.state.visualization.imageParams;
    widgetState.getHandle().setBounds(...extent);

    widgetState.setWorldToIndexTransform(worldToIndex);
    widgetState.setIndexToWorldTransform(indexToWorld);

    function handleWidgetStateChanged() {
      const origin = widgetState.getHandle().getOrigin();
      store.dispatch('visualization/setSlices', {
        x: origin[0] / spacing[0],
        y: origin[1] / spacing[1],
        z: origin[2] / spacing[2],
      });
    }

    onWidgetStateChanged(handleWidgetStateChanged);
    onAddedToView(({ viewWidget }) => {
      viewWidget.setHorizontalLineProps({
        stroke: '#ffd154',
        'stroke-width': 2,
      });
      viewWidget.setVerticalLineProps({
        stroke: '#ffd154',
        'stroke-width': 2,
      });
    });

    onViewMouseEvent(({ view }) => {
      function is2DView(v) {
        return !!v?.getAxis;
      }

      if (is2DView(view)) {
        const { imageParams, slices } = store.state.visualization;

        const vaxis = view.getAxis();
        const vslice = slices['xyz'[vaxis]];

        const normal = [0, 0, 0];
        const origin = [0, 0, 0];
        normal[vaxis] = 1;
        origin[vaxis] = vslice;

        vec3.transformMat3(normal, normal, imageParams.direction);
        vec3.transformMat4(origin, origin, imageParams.indexToWorld);

        // plane manipulator
        const manipulator = factory.getManipulator();
        manipulator.setNormal(normal);
        manipulator.setOrigin(origin);
      }
    });

    // Only show when slice contains crosshair origin
    const updateCrosshairVisibility = (slices) => {
      const space = store.state.visualization.imageParams.spacing;
      const views = Array.from(widgetInstances.keys());
      views.forEach((view) => {
        const widget = widgetInstances.get(view);
        if (widget && view.getAxis) {
          const axis = view.getAxis();
          const origin = widgetState.getHandle().getOrigin();
          const cross = Math.round(origin[axis] / space[axis]);
          const axisLetter = 'xyz'[axis];
          widget.setVisibility(cross === slices[axisLetter]);
        }
        view.getReferenceByName('widgetManager').renderWidgets();
        view.getRenderWindow().render();
      });
    };

    const unsubscribe = store.watch(
      (state) => state.visualization.slices,
      updateCrosshairVisibility
    );

    onBeforeDelete(unsubscribe);

    return {
      factory,
      serialize() {
        return { system: 'Image' };
      },
    };
  },
};
