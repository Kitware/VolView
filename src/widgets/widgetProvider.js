import { ViewTypes } from 'vtk.js/Sources/Widgets/Core/WidgetManager/Constants';

import { NO_WIDGET } from '@/src/constants';

import PaintWidget from '@/src/widgets/paint';
import RulerWidget from '@/src/widgets/ruler';
import CrosshairsWidget from '@/src/widgets/slicingCrosshairs';

export const DEFAULT_NAME_MAP = {
  Paint: PaintWidget,
  Ruler: RulerWidget,
  Crosshairs: CrosshairsWidget,
};

export default class WidgetProvider {
  constructor(store, nameMap = DEFAULT_NAME_MAP) {
    this.store = store;
    this.nameMap = nameMap;
    this.widgetMap = new Map();
    this.nextID = 1;
    this.views = [];
    this.viewTypes = new Map();

    // deactivate
    this.store.watch(
      (state) => state.widgets.activeWidgetID,
      (id, oldID) => {
        if (id === NO_WIDGET) {
          this.deactivateWidget(oldID);
        }
      }
    );

    // remove widgets
    this.store.watch(
      (state) => state.widgets.widgetList,
      (widgetList) => {
        const list = new Set(widgetList);
        [...this.widgetMap.keys()].forEach((id) => {
          if (!list.has(id)) {
            this.removeWidget(id);
          }
        });
      }
    );
  }

  getById(id) {
    return this.widgetMap.get(id);
  }

  createWidget(name) {
    if (name in this.nameMap) {
      const id = this.nextID;
      const WidgetClass = this.nameMap[name];
      const widget = new WidgetClass(id, this.store);

      this.widgetMap.set(id, widget);
      this.views.forEach((view) => {
        const viewType = this.viewTypes.get(view);
        widget.addToView(view, viewType);
      });

      this.nextID += 1;
      return id;
    }
    throw new Error(`Could not find widget ${name}`);
  }

  deactivateWidget(id) {
    const widget = this.getById(id);
    if (widget?.removeOnDeactivate) {
      this.removeWidget(id);
    }
  }

  removeWidget(id) {
    if (this.widgetMap.has(id)) {
      const widget = this.widgetMap.get(id);
      this.views.forEach((view) => {
        widget.removeFromView(view);
      });
      widget.delete();
      this.widgetMap.delete(id);
    }
  }

  addView(view, viewType = ViewTypes.DEFAULT) {
    this.views.push(view);
    this.viewTypes.set(view, viewType);
    const it = this.widgetMap.values();
    let { value: widget, done } = it.next();
    while (!done) {
      widget.addToView(view, viewType);
      ({ value: widget, done } = it.next());
    }
  }

  detachView(view) {
    const idx = this.views.indexOf(view);
    if (idx > -1) {
      this.views.splice(idx, 1);
      const it = this.widgetMap.values();
      let { value: widget, done } = it.next();
      while (!done) {
        widget.removeFromView(view);
        ({ value: widget, done } = it.next());
      }
    }
  }
}
