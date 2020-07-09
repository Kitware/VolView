import WidgetManagerConstants from 'vtk.js/Sources/Widgets/Core/WidgetManager/Constants';

const { ViewTypes } = WidgetManagerConstants;

function withWidgetManager(view, handler) {
  const wm = view.getReferenceByName('widgetManager');
  if (wm) {
    handler(wm);
  }
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
  constructor(id, store, provider) {
    this.id = id;
    this.store = store;
    this.provider = provider;
    this.watchers = [];
    this.widgetInstances = new Map();

    // configurable
    this.mouse2DViewBehavior = ALWAYS_VISIBLE;
    this.mouse3DViewBehavior = ALWAYS_VISIBLE;
    this.removeOnDeactivate = true;
  }

  watchStore(...args) {
    this.watchers.push(this.store.watch(...args));
  }

  addToView(view, type = ViewTypes.DEFAULT, initialValues = {}) {
    withWidgetManager(view, (wm) => {
      const widget = wm.addWidget(this.factory, type, initialValues);
      this.widgetInstances.set(view, widget);
    });
  }

  removeFromView(view) {
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
    this.provider.deactivateWidget(this.id);
  }

  removeSelf() {
    this.provider.removeWidget(this.id);
  }

  delete() {
    while (this.watchers.length) {
      this.watchers.pop()();
    }
    [...this.widgetInstances.keys()].forEach((view) =>
      this.removeFromView(view)
    );
  }

  updateVisibility(currentView) {
    const it = this.widgetInstances.entries();
    let { value, done } = it.next();
    while (!done) {
      const [view, viewWidget] = value;
      viewWidget.setVisibility(view === currentView);
      ({ value, done } = it.next());
    }
  }

  // eslint-disable-next-line class-methods-use-this
  updateManipulator() {}
}
