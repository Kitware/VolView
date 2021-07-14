import vtkCrosshairsWidget from '@/src/vtk/CrosshairsWidget';
import { onAddedToView, onWidgetStateChanged } from './context';

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

    return {
      factory,
      serialize() {
        return { system: 'Image' };
      },
    };
  },
};
