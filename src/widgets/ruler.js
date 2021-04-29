import vtkRulerWidget from '@/src/vtk/RulerWidget';
import { vec3 } from 'gl-matrix';
import { onAddedToView, onWidgetStateChanged } from './context';
import { observe, ref } from './reactivity';
import { useSliceFollower } from './widgetHooks';

const START = 1;
const PARTIAL = 2;
const COMPLETE = 3;

export function parseV1State(state, imageParams) {
  const { name, system, axis, slice } = state;
  const point1 = [...state.point1];
  const point2 = [...state.point2];

  if (system === 'Image') {
    vec3.transformMat4(point1, point1, imageParams.indexToWorld);
    vec3.transformMat4(point2, point2, imageParams.indexToWorld);
  }

  return {
    name,
    point1,
    point2,
    axis: 'IJK'.indexOf(axis),
    slice,
  };
}

export default {
  setup({
    id,
    datasetId,
    initialState,
    store,
    widgetInstances,
    viewTypeMap,
    unfocusSelf,
  }) {
    const factory = vtkRulerWidget.newInstance();
    const widgetState = factory.getWidgetState();

    // cache image params, assuming it doesn't change for the underlying dataset
    const imageParams = { ...store.state.visualization.imageParams };

    const name = ref('Ruler');
    const placeState = ref(START);
    const lockAxis = ref(null);
    const lockSlice = ref(null);

    function updateViewWidgetUI(viewWidget) {
      viewWidget.setTextStateIndex(0);
      viewWidget.setText(`${factory.getDistance().toFixed(2)}mm`);
    }

    function reset() {
      lockAxis.value = null;
      lockSlice.value = null;
      // reset widget state
      widgetState.clearHandleList();
    }

    // follow the active view/slice.
    // when the provided axis/slice is not null,
    // then only show widget when a view is on that axis/slice
    const { axis: curAxis, slice: curSlice } = useSliceFollower(
      store,
      lockAxis,
      lockSlice,
      factory,
      viewTypeMap,
      widgetInstances
    );

    function handleWidgetStateChanged() {
      const list = widgetState.getHandleList();

      if (list.length === 1) {
        // placed the first point.
        // If the slice changes or the mouse leaves the view,
        // reset the widget.
        placeState.value = PARTIAL;
        lockAxis.value = curAxis.value;
        lockSlice.value = curSlice.value;
      }

      if (list.length === 2) {
        placeState.value = COMPLETE;
      }

      store.dispatch('measurements/setData', {
        id,
        type: 'ruler',
        parentID: datasetId,
        data: {
          name: name.value,
          length: factory.getDistance(),
        },
      });

      // update ruler text
      [...widgetInstances.values()].forEach((viewWidget) => {
        updateViewWidgetUI(viewWidget);
      });
    }

    function restoreState(fromState) {
      if (fromState.type !== 'ruler') {
        throw new Error('Given state is not from a ruler');
      }

      let parsedState;
      if (fromState.version === '1.0') {
        parsedState = parseV1State(fromState, imageParams);
      } else {
        throw new Error(`Invalid state version ${fromState.version}`);
      }

      factory.addPoint(parsedState.point1);
      factory.addPoint(parsedState.point2);
      lockAxis.value = parsedState.axis;
      lockSlice.value = parsedState.slice;
      name.value = parsedState.name;

      handleWidgetStateChanged();
    }

    if (initialState) {
      restoreState(initialState);
    }

    observe([curAxis, curSlice], ([axis, slice]) => {
      if (
        placeState.value === PARTIAL &&
        (slice !== lockSlice.value || axis !== lockAxis.value)
      ) {
        reset();
      }
    });

    observe(placeState, (state) => {
      if (state === COMPLETE) {
        unfocusSelf();
      }
    });

    onWidgetStateChanged(handleWidgetStateChanged);

    onAddedToView(({ viewWidget }) => {
      updateViewWidgetUI(viewWidget);
    });

    return {
      factory,
      serialize({ system = 'Image' }) {
        if (placeState.value !== COMPLETE) {
          return null;
        }

        const list = widgetState.getHandleList();
        const point1 = [...list[0].getOrigin()];
        const point2 = [...list[1].getOrigin()];

        if (system === 'Image') {
          vec3.transformMat4(point1, point1, imageParams.worldToIndex);
          vec3.transformMat4(point2, point2, imageParams.worldToIndex);
        }

        return {
          version: '1.0',
          type: 'Ruler',
          name: 'W',
          system: 'Image',
          axis: lockAxis.value,
          slice: lockSlice.value,
          point1,
          point2,
        };
      },
    };
  },
};
