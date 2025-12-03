import macro from '@kitware/vtk.js/macros';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkWidgetRepresentation from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation';
import { Behavior } from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation/Constants';

function vtkPolygonFillRepresentation(publicAPI, model) {
  model.classHierarchy.push('vtkPolygonFillRepresentation');

  model.internalPolyData = vtkPolyData.newInstance();

  model._pipeline = {
    source: publicAPI,
    mapper: vtkMapper.newInstance(),
    actor: vtkActor.newInstance({ pickable: true }),
  };

  model._pipeline.actor.setMapper(model._pipeline.mapper);

  vtkWidgetRepresentation.connectPipeline(model._pipeline);
  publicAPI.addActor(model._pipeline.actor);

  publicAPI.getSelectedState = () => model.inputData[0];

  publicAPI.requestData = (inData, outData) => {
    const states = publicAPI.getRepresentationStates(inData[0]);

    if (states.length < 3) {
      model.internalPolyData.getPoints().setData(new Float32Array(0));
      model.internalPolyData.getPolys().setData(new Uint32Array(0));
      model.internalPolyData.modified();
      outData[0] = model.internalPolyData;
      return;
    }

    const points = new Float32Array(states.length * 3);
    states.forEach((state, i) => {
      const origin = state.getOrigin();
      points[i * 3] = origin[0];
      points[i * 3 + 1] = origin[1];
      points[i * 3 + 2] = origin[2];
    });

    const polys = new Uint32Array(states.length + 1);
    polys[0] = states.length;
    for (let i = 0; i < states.length; i++) {
      polys[i + 1] = i;
    }

    model.internalPolyData.getPoints().setData(points);
    model.internalPolyData.getPolys().setData(polys);
    model.internalPolyData.modified();

    outData[0] = model.internalPolyData;
  };
}

const DEFAULT_VALUES = {
  behavior: Behavior.HANDLE,
};

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);
  vtkWidgetRepresentation.extend(publicAPI, model, initialValues);
  macro.get(publicAPI, model._pipeline, ['mapper', 'actor']);
  vtkPolygonFillRepresentation(publicAPI, model);
}

export const newInstance = macro.newInstance(
  extend,
  'vtkPolygonFillRepresentation'
);

export default { newInstance, extend };
