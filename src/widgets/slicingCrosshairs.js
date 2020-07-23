import vtkCrosshairsWidget from '@/src/vtk/CrosshairsWidget';

import Widget, { NEVER_VISIBLE, FOLLOW_VIEW, is2DView } from './widget';

export default class RulerWidget extends Widget {
  constructor(id, store) {
    super(id, store);

    this.mouse2DViewBehavior = FOLLOW_VIEW;
    this.mouse3DViewBehavior = NEVER_VISIBLE;
    this.removeOnDeactivate = true;
    this.visibleView = null;

    this.factory = vtkCrosshairsWidget.newInstance();
    this.state = this.factory.getWidgetState();

    const { bounds, spacing } = this.store.state.visualization.worldOrientation;
    this.state
      .getHandle()
      .setBounds(...bounds.map((b, i) => b * spacing[Math.floor(i / 2)]));

    // register after setting handle bounds, so our slices don't get
    // reset to 0,0,0
    this.sub = this.state.onModified(() => this.onStateChange());
  }

  onStateChange() {
    if (this.visibleView !== this.currentView) {
      this.visibleView = this.currentView;
      this.updateVisibility();
    }

    const origin = this.state.getHandle().getOrigin();
    this.store.dispatch('setSlices', {
      x: origin[0],
      y: origin[1],
      z: origin[2],
    });
  }

  // eslint-disable-next-line class-methods-use-this
  setupViewWidget(viewWidget) {
    viewWidget.setHorizontalLineProps({
      stroke: '#ffd154',
      'stroke-width': 2,
    });
    viewWidget.setVerticalLineProps({
      stroke: '#ffd154',
      'stroke-width': 2,
    });
  }

  updateManipulator(view) {
    if (view) {
      const axis = view.getAxis();
      const { slices } = this.store.state.visualization;
      const normal = [0, 0, 0];
      normal[axis] = 1;
      const origin = [0, 0, 0];
      origin[axis] = slices['xyz'[axis]];

      // plane manipulator
      const manipulator = this.factory.getManipulator();
      manipulator.setNormal(normal);
      manipulator.setOrigin(origin);
    }
  }

  // override
  updateVisibility() {
    [...this.widgetInstances.keys()]
      .filter((v) => is2DView(v))
      .forEach((view) => {
        const visible = view === this.visibleView;
        this.setWidgetVisibilityForView(view, visible);

        // render
        view.getReferenceByName('widgetManager').renderWidgets();
        view.getRenderWindow().render();
      });
  }

  // override
  delete() {
    super.delete();
    this.sub.unsubscribe();
  }
}
