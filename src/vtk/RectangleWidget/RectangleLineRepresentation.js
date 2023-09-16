import macro from '@kitware/vtk.js/macros';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkStateBuilder from '@kitware/vtk.js/Widgets/Core/StateBuilder';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';
import LineGlyphRepresentation from '../LineGlyphRepresentation';

function vtkRectangleLineRepresentation(publicAPI, model) {
  model.classHierarchy.push('vtkRectangleLineRepresentation');

  const superGetRepresentationStates = publicAPI.getRepresentationStates;

  const compositeState = vtkStateBuilder
    .createBuilder()
    .addDynamicMixinState({
      labels: ['handles'],
      mixins: ['origin', 'scale1'],
      name: 'handle',
    })
    .build();

  const cornerStates = Array.from({ length: 4 }, () =>
    compositeState.addHandle()
  );

  publicAPI.getRepresentationStates = (input = model.inputData[0]) => {
    // Map 2 handles to 4 corner states in 2D
    const states = superGetRepresentationStates(input);
    if (states.length === 0) {
      return states;
    }

    const box = [...vtkBoundingBox.INIT_BOUNDS];
    states.forEach((handle) => {
      vtkBoundingBox.addPoint(box, ...handle.getOrigin());
    });
    const corners = vtkBoundingBox.getCorners(box, []);

    // 8 corners on plane, remove duplicates
    const corners2D = corners.reduce((outCorners, corner) => {
      const duplicate = outCorners.some((outCorner) =>
        vtkMath.areEquals(outCorner, corner)
      );
      if (!duplicate) {
        outCorners.push(corner);
      }
      return outCorners;
    }, []);

    const scale = states[0].getScale1();
    // reorder corners
    const outStates = [0, 2, 3, 1]
      // if in handles are equal, corners2D length is 1
      .map((index) => Math.min(index, corners2D.length - 1))
      .map((cornerIndex, index) => {
        const state = cornerStates[index];
        state.setOrigin(corners2D[cornerIndex]);
        state.setScale1(scale);
        return state;
      });

    return outStates;
  };
}

export function extend(publicAPI, model, initialValues = {}) {
  LineGlyphRepresentation.extend(publicAPI, model, initialValues);

  vtkRectangleLineRepresentation(publicAPI, model);
}

export const newInstance = macro.newInstance(
  extend,
  'vtkRectangleLineRepresentation'
);

export default { newInstance, extend };
