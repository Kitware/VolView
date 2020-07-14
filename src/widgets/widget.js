import WidgetManagerConstants from 'vtk.js/Sources/Widgets/Core/WidgetManager/Constants';

import { NO_SELECTION } from '@/src/constants';

const { ViewTypes } = WidgetManagerConstants;

function withWidgetManager(view, handler) {
  const wm = view.getReferenceByName('widgetManager');
  if (wm) {
    handler(wm);
  }
}

export function is2DView(view) {
  return view && view.getClassName() === 'vtkView2DProxy';
}

export const FOLLOW_VIEW = 'FOLLOW_VIEW';
export const ALWAYS_VISIBLE = 'ALWAYS_VISIBLE';
export const NEVER_VISIBLE = 'NEVER_VISIBLE';

/**
 * mouse view behaviors:
 * - FOLLOW_VIEW: only be visible in whichever view has the mouse
 * - ALWAYS_VISIBLE: always visible
 * - NEVER_VISIBLE: never visible
 *
 * the view behavior only applies if the widget chooses to render into the matching view type
 */
export default class Widget {
  constructor(id, store) {
    this.id = id;
    this.store = store;
    this.watchers = [];
    this.widgetInstances = new Map();
    this.currentView = null;
    this.lockToCurrentViewFlag = false; // only applicable to FOLLOW_VIEW

    // private properties; accessible through getters/setters
    this.$removeOnDeactivate = true;

    // need to make sure selectedBaseImage isn't NO_SELECTION
    this.parentDataID = store.state.selectedBaseImage;
    if (this.parentDataID === NO_SELECTION) {
      throw new Error('Cannot have a widget without a parent dataset');
    }

    // configurable
    this.mouse2DViewBehavior = ALWAYS_VISIBLE;
    this.mouse3DViewBehavior = ALWAYS_VISIBLE;
    this.removeOnDeactivate = true;

    this.watchStore(
      (state) => state.selectedBaseImage,
      () => this.updateVisibility(this.currentView)
    );
  }

  watchStore(...args) {
    this.watchers.push(this.store.watch(...args));
  }

  get removeOnDeactivate() {
    return this.$removeOnDeactivate;
  }

  set removeOnDeactivate(yn) {
    this.$removeOnDeactivate = yn;
    this.store.dispatch('setRemoveWidgetOnDeactivate', {
      widgetID: this.id,
      remove: yn,
    });
  }

  addToView(view, type = ViewTypes.DEFAULT, initialValues = {}) {
    withWidgetManager(view, (wm) => {
      const widget = wm.addWidget(this.factory, type, initialValues);
      this.widgetInstances.set(view, widget);
    });
  }

  removeFromView(view) {
    if (this.currentView === view) {
      this.currentView = null;
    }
    withWidgetManager(view, (wm) => {
      this.widgetInstances.delete(view);
      wm.removeWidget(this.factory);
    });
  }

  focus(view) {
    withWidgetManager(view, (wm) => {
      if (this.widgetInstances.has(view)) {
        wm.grabFocus(this.widgetInstances.get(view));
      }
    });
  }

  static unfocus(view) {
    withWidgetManager(view, (wm) => wm.releaseFocus());
  }

  deactivateSelf() {
    this.store.dispatch('deactivateWidget', this.id);
  }

  removeSelf() {
    this.store.dispatch('removeWidget', this.id);
  }

  delete() {
    while (this.watchers.length) {
      this.watchers.pop()();
    }
    [...this.widgetInstances.keys()].forEach((view) =>
      this.removeFromView(view)
    );
  }

  lockPickingToCurrentView(yn) {
    this.lockToCurrentViewFlag = yn;
    this.updatePicking(this.currentView);
  }

  setCurrentView(view) {
    if (!this.lockToCurrentViewFlag) {
      this.currentView = view;
    }
  }

  update() {
    this.updateManipulator(this.currentView);
    this.updateVisibility(this.currentView);
  }

  updatePicking(currentView) {
    const it = this.widgetInstances.entries();
    let { value, done } = it.next();
    while (!done) {
      const [view, viewWidget] = value;
      if (is2DView(view)) {
        let pickable = true;
        if (
          this.mouse2DViewBehavior === FOLLOW_VIEW &&
          this.lockToCurrentViewFlag
        ) {
          pickable = view === currentView;
        }
        viewWidget.setPickable(pickable);
      }
      // TODO 3D view

      ({ value, done } = it.next());
    }
  }

  updateVisibility(currentView) {
    [...this.widgetInstances.keys()].forEach((view) => {
      if (is2DView(view)) {
        let visible = false;
        if (this.mouse2DViewBehavior === FOLLOW_VIEW) {
          visible = view === currentView;
        } else if (this.mouse2DViewBehavior === ALWAYS_VISIBLE) {
          visible = true;
        }
        this.setWidgetVisibilityForView(view, visible);
      }
      // TODO 3D view

      // render
      view.getReferenceByName('widgetManager').renderWidgets();
      view.getRenderWindow().render();
    });
  }

  setWidgetVisibilityForView(view, visible) {
    let v = visible;
    if (this.store.state.selectedBaseImage !== this.parentDataID) {
      v = false;
    }

    const viewWidget = this.widgetInstances.get(view);
    if (viewWidget) {
      viewWidget.setVisibility(v);
      viewWidget.setContextVisibility(v);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  updateManipulator() {}
}
