import vtkCustomDistanceWidget from '@/src/vtk/CustomDistanceWidget';

import Widget, { FOLLOW_VIEW, NEVER_VISIBLE, is2DView } from './widget';

export default class RulerWidget extends Widget {
  constructor(id, store) {
    super(id, store);

    this.mouse2DViewBehavior = FOLLOW_VIEW;
    this.mouse3DViewBehavior = NEVER_VISIBLE;
    // this will be changed to false when the widget is finalized
    this.removeOnDeactivate = true;

    this.factory = vtkCustomDistanceWidget.newInstance();
    this.state = this.factory.getWidgetState();

    this.stateSub = this.state.onModified(() => this.onStateChange());
    this.lockedAxis = null;
    this.lockedSlice = null;

    this.store.dispatch('measurements/addMeasurementData', {
      id: this.id,
      type: 'ruler',
      parentID: this.parentDataID,
      initialData: {
        length: 0,
      },
    });
  }

  onStateChange() {
    const list = this.state.getHandleList();

    if (!this.lockToCurrentViewFlag && list.length > 0) {
      this.lockPickingToCurrentView(true);
      const axis = this.currentView.getAxis();
      const { slices } = this.store.state.visualization;
      this.lockedAxis = axis;
      this.lockedSlice = slices['xyz'[axis]];
    }

    if (this.removeOnDeactivate && list.length === 2) {
      this.removeOnDeactivate = false;
      this.deactivateSelf();
    } else {
      this.store.dispatch('measurements/setMeasurementData', {
        id: this.id,
        data: {
          length: this.factory.getDistance(),
        },
      });
    }
  }

  // override
  updateVisibility(view) {
    if (
      this.currentView === view &&
      is2DView(view) &&
      view.getAxis() === this.lockedAxis
    ) {
      const axis = view.getAxis();
      const { slices } = this.store.state.visualization;
      const slice = slices['xyz'[axis]];
      const visible = Math.abs(slice - this.lockedSlice) < 1e-6;

      this.setWidgetVisibilityForView(view, visible);

      // render
      view.getReferenceByName('widgetManager').renderWidgets();
      view.getRenderWindow().render();
    } else {
      super.updateVisibility(view);
    }
  }

  updateManipulator(view) {
    if (view && this.lockedSlice === null) {
      const axis = view.getAxis();
      const { slices, imageConfig } = this.store.state.visualization;
      const { spacing } = imageConfig;
      const normal = [0, 0, 0];
      normal[axis] = 1;
      const origin = [0, 0, 0];
      origin[axis] = slices['xyz'[axis]] * spacing[axis];

      // plane manipulator
      const manipulator = this.factory.getManipulator();
      manipulator.setNormal(normal);
      manipulator.setOrigin(origin);
    }
  }

  // override
  delete() {
    super.delete();
    this.stateSub.unsubscribe();
  }
}
