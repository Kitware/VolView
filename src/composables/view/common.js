import {
  computed,
  onBeforeUnmount,
  unref,
  watchEffect,
} from '@vue/composition-api';

import vtkWidgetManager from 'vtk.js/Sources/Widgets/Core/WidgetManager';
import { useProxyManager } from '@/src/composables/proxyManager';

function setupView(view) {
  // setup view
  view.getRenderer().setBackground(0, 0, 0);

  if (!view.getReferenceByName('widgetManager')) {
    view.set({ widgetManager: vtkWidgetManager.newInstance() }, true);
  }
  const wm = view.getReferenceByName('widgetManager');
  wm.setRenderer(view.getRenderer());
  wm.setUseSvgLayer(true);
}

function mountView(view, container) {
  if (view && container) {
    view.setContainer(container);
    setupView(view);
    view.renderLater();
  }
}

export const CommonViewProps = {
  viewType: {
    type: String,
    required: true,
  },
  viewName: {
    type: String,
    required: true,
  },
  axis: {
    type: Number,
    validator(v) {
      return v === 0 || v === 1 || v === 2;
    },
  },
  viewUp: {
    type: Array,
    validator(v) {
      return v.length === 3;
    },
  },
  orientation: {
    type: Number,
    default: 1,
    validator(v) {
      return v === -1 || v === 1;
    },
  },
};

/**
 * All parameters are passed via names in an object.
 *
 * @param {Ref<HTMLElement>} containerRef  the vtkView container
 * @param {Ref<String>} viewName  the view name
 * @param {Ref<String>} viewType the view type
 * @param {Ref<1|2|3>} axis the view axis (XYZ)
 * @param {Ref<Number[3]>} viewUp the view up unit vector
 * @param {Ref<-1|1>} orientation the view direction's "sense" or orientation
 */
export function useVtkView({ containerRef, viewName, viewType }) {
  const pxm = useProxyManager();

  const viewRef = computed(() => {
    const name = `${unref(viewName)}::${unref(viewType)}`;
    const views = pxm.getViews();
    let view = views.find(
      (v) => v.getProxyName() === unref(viewType) && v.getName() === name
    );
    if (!view) {
      view = pxm.createProxy('Views', unref(viewType), { name });
    }

    mountView(view, unref(containerRef));

    return view;
  });

  watchEffect(() => mountView(unref(viewRef), unref(containerRef)));

  onBeforeUnmount(() => {
    const view = unref(viewRef);
    if (view) {
      view.setContainer(null);
    }
  });

  return viewRef;
}

/**
 * Handles camera orientation.
 *
 * @param {Ref<vtkViewProxy>} viewRef
 * @param {Ref<Number[3]>} viewUp
 * @param {Ref<1|2|3>} axis
 * @param {Ref<-1|1>} orientation
 */
export function useVtkViewCameraOrientation(
  viewRef,
  viewUp,
  axis,
  orientation
) {
  const updateOrientation = () => {
    const view = unref(viewRef);
    if (view) {
      view.updateOrientation(unref(axis), unref(orientation), unref(viewUp));
    }
  };

  watchEffect(updateOrientation);
}

/**
 * Applies annotations to a view.
 *
 * @param {Ref<vtkViewProxy>} viewRef
 * @param {Reactive<{ [label: string]: Ref<string> }} labels
 * @param {Reactive<{ [label: string]: string }} defaults
 */
export function giveViewAnnotations(viewRef, labels, defaults = {}) {
  const places = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

  watchEffect(() => {
    const view = unref(viewRef);
    if (view) {
      // update all given labels
      places.forEach((pl) => {
        if (labels[pl]) {
          view.setCornerAnnotation(pl, labels[pl] || defaults[pl] || '');
        }
      });
    }
  });
}
