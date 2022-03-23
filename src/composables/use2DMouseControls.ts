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
  interactionDefs: any
) {
  const rangeManipulator = vtkMouseRangeManipulator.newInstance({
    button: 1,
  });
  const vertVal = ref(0);
  const horizVal = ref(0);

  function updateManipulator() {
    rangeManipulator.removeAllListeners();
    const vertRange = unref(verticalRange);
    const horizRange = unref(horiontalRange);

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
  }

  watchEffect(() => {
    const istyle = view.getInteractorStyle2D();

    // removes all manipulators
    InteractionPresets.applyDefinitions(interactionDefs, istyle);

    istyle.addMouseManipulator(rangeManipulator);
  });

  // reset vals when the ranges reset
  watch(
    [verticalRange, horiontalRange],
    ([vRange, hRange]) => {
      vertVal.value = vRange.default;
      horizVal.value = hRange.default;
    },
    { immediate: true, deep: true }
  );

  watch([verticalRange, horiontalRange], updateManipulator, {
    deep: true,
  });
  updateManipulator();

  return { vertVal, horizVal };
}
