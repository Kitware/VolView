import vtkPaintWidget from 'vtk.js/Sources/Widgets/Widgets3D/PaintWidget';
import vtkPaintFilter from 'vtk.js/Sources/Filters/General/PaintFilter';

import { NO_SELECTION, IDENTITY4 } from '@/src/constants';
import Widget, { FOLLOW_VIEW, ALWAYS_VISIBLE } from './widget';

export default class PaintWidget extends Widget {
  constructor(id, store) {
    super(id, store);

    this.mouse2DViewBehavior = FOLLOW_VIEW;
    this.mouse3DViewBehavior = ALWAYS_VISIBLE;
    this.removeOnDeactivate = true;

    this.viewWidgetListeners = new Map();
    this.filter = null;
    this.factory = vtkPaintWidget.newInstance();
    this.state = this.factory.getWidgetState();

    const { selectedLabelmap } = store.state.annotations;
    this.onLabelmapSelect(selectedLabelmap);

    this.watchStore(
      (state) => state.annotations.selectedLabelmap,
      (labelmapID) => this.onLabelmapSelect(labelmapID)
    );
    this.watchStore(
      (state) => state.annotations.currentLabelFor,
      (currentLabelFor) => this.onCurrentLabelChange(currentLabelFor),
      { deep: true }
    );
    this.watchStore(
      (state) => state.annotations.radius,
      (r) => this.onRadiusChange(r)
    );
  }

  updateManipulator(view) {
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

  async onLabelmapSelect(labelmapID) {
    const { selectedBaseImage } = this.store.state;
    let id = NO_SELECTION;
    if (selectedBaseImage !== NO_SELECTION) {
      id = labelmapID;
      if (id === NO_SELECTION) {
        // create empty labelmap
        await this.store.dispatch(
          'annotations/createLabelmap',
          selectedBaseImage
        );
        id = this.store.state.annotations.selectedLabelmap;
      }
    }

    if (id !== NO_SELECTION) {
      const { vtkCache } = this.store.state.data;
      const { radius, currentLabelFor } = this.store.state.annotations;

      this.filter = vtkPaintFilter.newInstance();
      this.filter.setBackgroundImage(vtkCache[selectedBaseImage]);
      this.filter.setLabelMap(vtkCache[id]);
      this.filter.setMaskWorldToIndex(IDENTITY4);
      this.filter.setLabel(currentLabelFor[id]);
      this.filter.setRadius(radius);
      this.factory.setRadius(radius);
    } else {
      this.deactivateSelf();
    }
  }

  onCurrentLabelChange(currentLabelFor) {
    const { selectedLabelmap } = this.store.state.annotations;
    if (selectedLabelmap in currentLabelFor) {
      this.filter.setLabel(currentLabelFor[selectedLabelmap]);
    }
  }

  onRadiusChange(radius) {
    this.filter.setRadius(radius);
    this.factory.setRadius(radius);
  }

  // override
  addToView(view, ...rest) {
    super.addToView(view, ...rest);
    const viewWidget = this.widgetInstances.get(view);
    const subs = [
      viewWidget.onStartInteractionEvent(() => {
        this.filter.startStroke();
        this.filter.addPoint(this.state.getTrueOrigin());
      }),
      viewWidget.onInteractionEvent(() => {
        if (viewWidget.getPainting()) {
          this.filter.addPoint(this.state.getTrueOrigin());
        }
      }),
      viewWidget.onEndInteractionEvent(() => {
        this.filter.addPoint(this.state.getTrueOrigin());
        this.filter.endStroke();

        const { selectedLabelmap } = this.store.state.annotations;
        this.store.dispatch('redrawPipeline', selectedLabelmap);
      }),
    ];
    this.viewWidgetListeners.set(view, subs);
  }

  // override
  removeFromView(view) {
    super.removeFromView(view);
    const subs = this.viewWidgetListeners.get(view);
    subs.forEach((sub) => sub.unsubscribe());
    this.viewWidgetListeners.delete(view);
  }

  // override
  delete() {
    super.delete();
    this.filter.delete();
  }
}
