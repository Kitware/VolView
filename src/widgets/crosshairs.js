import { vec3 } from 'gl-matrix';
import vtkCrosshairsWidget from '@/src/vtk/CrosshairsWidget';
import {
  onViewMouseEvent,
  onAddedToView,
  onWidgetStateChanged,
} from './context';

export default {
  setup({ store }) {
    const factory = vtkCrosshairsWidget.newInstance();
    const widgetState = factory.getWidgetState();
    const { extent, spacing } = store.state.visualization.imageParams;
    widgetState
      .getHandle()
      .setBounds(...extent.map((b, i) => b * spacing[Math.floor(i / 2)]));

    function handleWidgetStateChanged() {
      const origin = widgetState.getHandle().getOrigin();
      store.dispatch('visualization/setSlices', {
        x: origin[0] / spacing[0],
        y: origin[1] / spacing[1],
        z: origin[2] / spacing[2],
      });
    }

    onWidgetStateChanged(handleWidgetStateChanged);
    onAddedToView(({ view, viewWidget }) => {
      viewWidget.setHorizontalLineProps({
        stroke: '#ffd154',
        'stroke-width': 2,
      });
      viewWidget.setVerticalLineProps({
        stroke: '#ffd154',
        'stroke-width': 2,
      });

      if (view) {
        const axis = view.getAxis();
        const { slices } = store.state.visualization;
        const normal = [0, 0, 0];
        normal[axis] = 1;
        const origin = [0, 0, 0];
        origin[axis] = slices['xyz'[axis]] * spacing[axis];

        // plane manipulator
        const manipulator = factory.getManipulator();
        manipulator.setNormal(normal);
        manipulator.setOrigin(origin);
      }
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

    return {
      factory,
      serialize() {
        return { system: 'Image' };
      },
    };
  },
};
