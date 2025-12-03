import macro from '@kitware/vtk.js/macros';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkWidgetRepresentation from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation';
import { Behavior } from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation/Constants';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';

function vtkRectangleFillRepresentation(publicAPI, model) {
  model.classHierarchy.push('vtkRectangleFillRepresentation');

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

  const superBehavior = model.widgetAPI.behavior;
  let behaviorModel;
  model.widgetAPI.behavior = (publicAPIy, bModel) => {
    behaviorModel = bModel;
    return superBehavior(publicAPIy, bModel);
  };

  publicAPI.requestData = (inData, outData) => {
    const states = publicAPI.getRepresentationStates(inData[0]);

    if (states.length < 2 || !behaviorModel) {
      model.internalPolyData.getPoints().setData(new Float32Array(0));
      model.internalPolyData.getPolys().setData(new Uint32Array(0));
      model.internalPolyData.modified();
      outData[0] = model.internalPolyData;
      return;
    }

    const box = [...vtkBoundingBox.INIT_BOUNDS];
    states.forEach((handle) => {
      const displayPos = behaviorModel._apiSpecificRenderWindow.worldToDisplay(
        ...handle.getOrigin(),
        behaviorModel._renderer
      );
      vtkBoundingBox.addPoint(box, ...displayPos);
    });
    const corners = vtkBoundingBox.getCorners(box, []);

    const corners2D = corners.reduce((outCorners, corner) => {
      const duplicate = outCorners.some((outCorner) =>
        vtkMath.areEquals(outCorner, corner)
      );
      if (!duplicate) {
        outCorners.push(corner);
      }
      return outCorners;
    }, []);

    if (corners2D.length < 4) {
      model.internalPolyData.getPoints().setData(new Float32Array(0));
      model.internalPolyData.getPolys().setData(new Uint32Array(0));
      model.internalPolyData.modified();
      outData[0] = model.internalPolyData;
      return;
    }

    const worldCorners = [0, 2, 3, 1].map((cornerIndex) =>
      behaviorModel._apiSpecificRenderWindow.displayToWorld(
        ...corners2D[cornerIndex],
        behaviorModel._renderer
      )
    );

    const points = new Float32Array(12);
    worldCorners.forEach((corner, i) => {
      points[i * 3] = corner[0];
      points[i * 3 + 1] = corner[1];
      points[i * 3 + 2] = corner[2];
    });

    const polys = new Uint32Array([4, 0, 1, 2, 3]);

    model.internalPolyData.getPoints().setData(points);
    model.internalPolyData.getPolys().setData(polys);
    model.internalPolyData.modified();

    outData[0] = model.internalPolyData;
  };
}

const DEFAULT_VALUES = {
  behavior: Behavior.HANDLE,
  widgetAPI: null,
};

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);
  vtkWidgetRepresentation.extend(publicAPI, model, initialValues);
  macro.setGet(publicAPI, model, ['widgetAPI']);
  macro.get(publicAPI, model._pipeline, ['mapper', 'actor']);
  vtkRectangleFillRepresentation(publicAPI, model);
}

export const newInstance = macro.newInstance(
  extend,
  'vtkRectangleFillRepresentation'
);

export default { newInstance, extend };
