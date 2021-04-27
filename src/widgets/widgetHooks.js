import { vec3 } from 'gl-matrix';
import { onAddedToView, onDeleted, onViewMouseEvent } from './context';
import { observe, ref, computed } from './reactivity';

const INVALID = -1;

function is2DView(view) {
  return !!view?.getAxis;
}

export function renderViewAndWidgets(view) {
  view.getReferenceByName('widgetManager').renderWidgets();
  view.getRenderWindow().render();
}

export function watchStore(store, getter, fn, opts) {
  const stop = store.watch(getter, fn, opts);
  onDeleted(stop);
}

export function useCurrentView() {
  const currentView = ref(null);
  const currentViewType = ref(null);

  onViewMouseEvent(({ type, view, viewType }) => {
    if (type === 'mouseenter' || type === 'mousemove') {
      currentView.value = view;
      currentViewType.value = viewType;
    } else if (type === 'mouseleave') {
      currentView.value = null;
      currentViewType.value = null;
    }
  });

  return { currentView, currentViewType };
}

export function useSliceFollower(
  store,
  lockAxis,
  lockSlice,
  widgetFactory,
  viewTypeMap,
  widgetInstances
) {
  const { currentView } = useCurrentView();

  const slice = ref(INVALID);
  const axis = computed(() => {
    if (is2DView(currentView.value)) {
      return currentView.value.getAxis();
    }
    return INVALID;
  });

  function updateSlice() {
    if (axis.value !== INVALID) {
      const { slices } = store.state.visualization;
      slice.value = slices['xyz'[axis.value]];
    } else {
      slice.value = INVALID;
    }
  }

  function updateManipulator() {
    if (is2DView(currentView.value)) {
      const { slices, imageParams } = store.state.visualization;

      const vaxis = lockAxis.value ?? currentView.value.getAxis();
      const vslice = lockSlice.value ?? slices['xyz'[vaxis]];

      const normal = [0, 0, 0];
      const origin = [0, 0, 0];
      normal[vaxis] = 1;
      origin[vaxis] = vslice;

      vec3.transformMat3(normal, normal, imageParams.direction);
      vec3.transformMat4(origin, origin, imageParams.indexToWorld);

      // plane manipulator
      const manipulator = widgetFactory.getManipulator();
      manipulator.setNormal(normal);
      manipulator.setOrigin(origin);
    }
  }

  /**
   * If view is not null, then hide widget in views that don't
   * match the correct view type.
   * If view is null, then hide all widgets.
   *
   * TODO if on diff dataset, then hide.
   */
  function updateVisibility() {
    const views = Array.from(widgetInstances.keys());
    views.forEach((otherView) => {
      let visible = false;
      if (widgetInstances.has(otherView)) {
        // handle views of the same type

        // case: not locked to a slice/axis
        if (lockAxis.value === null || lockSlice.value === null) {
          if (currentView.value && viewTypeMap.has(currentView.value)) {
            const viewType = viewTypeMap.get(currentView.value);
            visible = viewTypeMap.get(otherView) === viewType;
          } else {
            visible = false;
          }
        }

        // case: locked to a slice/axis
        if (lockAxis.value !== null && lockSlice.value !== null) {
          if (is2DView(otherView)) {
            const { slices } = store.state.visualization;
            const otherAxis = otherView.getAxis();
            visible =
              otherAxis === lockAxis.value &&
              Math.abs(slices['xyz'[otherAxis]] - lockSlice.value) < 1e-6;
          } else {
            visible = false;
          }
        }

        const viewWidget = widgetInstances.get(otherView);
        viewWidget.setVisibility(visible);
        viewWidget.setContextVisibility(visible);
        renderViewAndWidgets(otherView);
      }
    });
  }

  updateManipulator();
  updateVisibility();

  onAddedToView(() => updateVisibility());

  observe(axis, updateSlice);
  watchStore(store, (state) => state.visualization.slices, updateSlice);

  observe([axis, slice], updateManipulator);

  observe([currentView, slice], updateVisibility);

  observe([lockAxis, lockSlice], ([laxis, lslice]) => {
    if (laxis === null && lslice === null) {
      updateManipulator();
    }
  });

  return { axis, slice };
}
