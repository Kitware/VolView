import macro from 'vtk.js/Sources/macro';
import vtkDistanceWidget from 'vtk.js/Sources/Widgets/Widgets3D/DistanceWidget';
import vtkSphereHandleRepresentation from 'vtk.js/Sources/Widgets/Representations/SphereHandleRepresentation';
import vtkPolyLineRepresentation from 'vtk.js/Sources/Widgets/Representations/PolyLineRepresentation';
import { ViewTypes } from 'vtk.js/Sources/Widgets/Core/WidgetManager/Constants';

function vtkCustomDistanceWidget(publicAPI, model) {
  model.classHierarchy.push('vtkCustomDistanceWidget');

  // override
  // eslint-disable-next-line no-param-reassign
  publicAPI.getRepresentationsForViewType = (viewType) => {
    switch (viewType) {
      case ViewTypes.GEOMETRY:
      case ViewTypes.SLICE:
      case ViewTypes.VOLUME:
      case ViewTypes.DEFAULT:
      default:
        return [
          {
            builder: vtkSphereHandleRepresentation,
            labels: ['handles'],
            initialValues: { scaleByDisplay: true },
          },
          {
            builder: vtkSphereHandleRepresentation,
            labels: ['moveHandle'],
            initialValues: { scaleByDisplay: true },
          },
          {
            builder: vtkPolyLineRepresentation,
            labels: ['handles', 'moveHandle'],
          },
        ];
    }
  };
}

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, initialValues);

  vtkDistanceWidget.extend(publicAPI, model, initialValues);

  vtkCustomDistanceWidget(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, 'vtkCustomDistanceWidget');

export default { newInstance, extend };
