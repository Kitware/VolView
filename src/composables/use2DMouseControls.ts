import { ref, Ref, unref, watch, watchEffect } from '@vue/composition-api';

import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import InteractionPresets from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator/Presets';

import { vtkLPSView2DProxy } from '@src/vtk/LPSView2DProxy';

interface Domain {
  min: number;
  max: number;
  step: number;
  default: number;
}

export function use2DMouseControls(
  view: vtkLPSView2DProxy,
  verticalRange: Ref<Domain>,
  horiontalRange: Ref<Domain>,
  scrollRange: Ref<Domain>,
  interactionDefs: any
) {
  const rangeManipulator = vtkMouseRangeManipulator.newInstance({
    button: 1,
    scrollEnabled: true,
  });
  const vertVal = ref(0);
  const horizVal = ref(0);
  const scrollVal = ref(0);

  function updateManipulator() {
    rangeManipulator.removeAllListeners();
    const vertRange = unref(verticalRange);
    const horizRange = unref(horiontalRange);
    const scRange = unref(scrollRange);

    rangeManipulator.setVerticalListener(
      vertRange.min,
      vertRange.max,
      vertRange.step,
      () => vertVal.value,
      (v) => {
        vertVal.value = v;
      }
    );

    rangeManipulator.setHorizontalListener(
      horizRange.min,
      horizRange.max,
      horizRange.step,
      () => horizVal.value,
      (v) => {
        horizVal.value = v;
      }
    );

    rangeManipulator.setScrollListener(
      scRange.min,
      scRange.max,
      scRange.step,
      () => scrollVal.value,
      (v) => {
        scrollVal.value = v;
      }
    );
  }

  watchEffect(() => {
    const istyle = view.getInteractorStyle2D();

    // removes all manipulators
    InteractionPresets.applyDefinitions(interactionDefs, istyle);

    istyle.addMouseManipulator(rangeManipulator);
  });

  // reset vals when the ranges reset
  watch(
    [verticalRange, horiontalRange, scrollRange],
    ([vRange, hRange, scRange]) => {
      vertVal.value = vRange.default;
      horizVal.value = hRange.default;
      scrollVal.value = scRange.default;
    },
    { immediate: true, deep: true }
  );

  watch([verticalRange, horiontalRange, scrollRange], updateManipulator, {
    deep: true,
  });
  updateManipulator();

  return { vertVal, horizVal, scrollVal };
}
