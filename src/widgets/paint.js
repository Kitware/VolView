import { mat4, vec3 } from 'gl-matrix';
import vtkPaintWidget from 'vtk.js/Sources/Widgets/Widgets3D/PaintWidget';
import vtkPaintFilter from 'vtk.js/Sources/Filters/General/PaintFilter';

import { NO_SELECTION } from '@/src/constants';
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

    // bug/edge case: default radius is 1, so if we initialize
    // our paint widget with a radius of 1, then the widget paintbrush
    // cursor doesn't properly resize to a radius of 1.
    this.factory.setRadius(0);

    const { selectedLabelmap } = store.state.annotations;
    this.onLabelmapSelect(selectedLabelmap, NO_SELECTION);

    this.watchStore(
      (state) => state.annotations.selectedLabelmap,
      (labelmapID, prev) => this.onLabelmapSelect(labelmapID, prev)
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
    super.updateManipulator(view);

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

  async onLabelmapSelect(labelmapID, previous) {
    // deactivate paint if we select no labelmap from previously
    // having a labelmap.
    // special case: if labelmapID and previous are NO_SELECTION,
    // then create the labelmap.
    if (labelmapID === NO_SELECTION && previous !== NO_SELECTION) {
      this.deactivateSelf();
      return;
    }

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
      const { worldOrientation } = this.store.state.visualization;
      const { radius, currentLabelFor } = this.store.state.annotations;

      this.filter = vtkPaintFilter.newInstance();
      this.filter.setBackgroundImage(vtkCache[selectedBaseImage]);
      this.filter.setLabelMap(vtkCache[id]);
      this.filter.setMaskWorldToIndex(worldOrientation.worldToIndex);
      this.filter.setLabel(currentLabelFor[id]);
      this.onRadiusChange(radius);
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

  toWorldPosition(point) {
    // the view has identity origin and direction, but not spacing
    const {
      spacing,
      worldToIndex,
    } = this.store.state.visualization.worldOrientation;
    const inv = mat4.create();
    const pt = vec3.create();
    mat4.invert(inv, worldToIndex);
    vec3.transformMat4(
      pt,
      point.map((p, i) => p / spacing[i]), // undo spacing
      inv
    );
    return pt;
  }

  // override
  addToView(view, ...rest) {
    super.addToView(view, ...rest);
    const viewWidget = this.widgetInstances.get(view);
    const subs = [
      viewWidget.onStartInteractionEvent(() => {
        this.filter.startStroke();
        this.filter.addPoint(this.toWorldPosition(this.state.getTrueOrigin()));
      }),
      viewWidget.onInteractionEvent(() => {
        if (viewWidget.getPainting()) {
          this.filter.addPoint(
            this.toWorldPosition(this.state.getTrueOrigin())
          );
        }
      }),
      viewWidget.onEndInteractionEvent(() => {
        this.filter.addPoint(this.toWorldPosition(this.state.getTrueOrigin()));
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
    if (subs) {
      subs.forEach((sub) => sub.unsubscribe());
    }
    this.viewWidgetListeners.delete(view);
  }

  // override
  delete() {
    super.delete();
    this.filter.delete();
  }
}
