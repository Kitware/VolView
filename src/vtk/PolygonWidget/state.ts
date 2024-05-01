import macro from '@kitware/vtk.js/macros';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import bounds from '@kitware/vtk.js/Widgets/Core/StateBuilder/boundsMixin';
import visibleMixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/visibleMixin';
import scale1Mixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/scale1Mixin';
import { Vector3 } from '@kitware/vtk.js/types';
import vtkAnnotationWidgetState from '@/src/vtk/ToolWidgetUtils/annotationWidgetState';
import { Polygon } from '@/src/types/polygon';
import { AnnotationToolType } from '@/src/store/tools/types';
import { getImageMetadata } from '@/src/composables/useCurrentImage';
import { getPixelSizeSquared } from '@/src/utils/frameOfReference';
import createPointState from '../ToolWidgetUtils/pointState';
import { watchState } from '../ToolWidgetUtils/utils';
import decimate from './decimate';

export const MoveHandleLabel = 'moveHandle';
export const HandlesLabel = 'handles';

const HANDLE_PIXEL_SIZE = 20;
const DECIMATE_PIXEL_SIZE_FACTOR = 0.01;

type VtkObjectModel = {
  classHierarchy: string[];
};

type HandleModel = {
  index: number;
} & VtkObjectModel;

function vtkPolygonWidgetState(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkPolygonWidgetState');
  model.moveHandle = createPointState({
    id: model.id,
    store: publicAPI.getStore(),
    key: 'movePoint',
    visible: true,
  });
  watchState(publicAPI, model.moveHandle, () => publicAPI.modified());

  const getTool = () => publicAPI.getStore().toolByID[model.id] as Polygon;

  model.handles = [];

  model.labels = {
    [MoveHandleLabel]: [model.moveHandle],
    [HandlesLabel]: [],
  };

  model.finishable = false;

  // After deserialize, Pinia store already added points
  // and addPoint will be false.
  publicAPI.addHandle = ({ insertIndex = -1, addPoint = true } = {}) => {
    const index = insertIndex === -1 ? model.handles.length : insertIndex;

    if (addPoint) getTool().points.splice(index, 0, [0, 0, 0]);

    const handleModel = { index };
    const handlePublicAPI = {
      getOrigin: () => getTool()?.points[handleModel.index],
      setOrigin: (xyz: Vector3) => {
        getTool().points[handleModel.index] = xyz;
        publicAPI.modified();
      },
      getIndex: () => handleModel.index,
      setIndex: (i: number) => {
        handleModel.index = i;
      },
    };
    vtkWidgetState.extend(handlePublicAPI, handleModel, {});
    visibleMixin.extend(handlePublicAPI, handleModel, { visible: true });
    scale1Mixin.extend(handlePublicAPI, handleModel, {
      scale1: HANDLE_PIXEL_SIZE,
    });
    const handleModelPromoted = handleModel as HandleModel;
    handleModelPromoted.classHierarchy.push('vtkPolygonHandleState');

    model.handles.splice(index, 0, handlePublicAPI);
    // when inserting into middle of array, update indices of subsequent handles
    for (let i = index + 1; i < model.handles.length; i++) {
      model.handles[i].setIndex(i);
    }

    publicAPI.bindState(handlePublicAPI, [HandlesLabel]);
    // bindState pushes handle at end of labels array,
    // but we may have inserted handle in middle of array.
    // Downstream WidgetRepresentations get order of
    // state/handles from internal HandlesLabel array.
    // So copy handles array.
    model.labels[HandlesLabel] = [...model.handles];

    publicAPI.modified();
    return handlePublicAPI;
  };

  publicAPI.removeHandle = (removeIndex: number) => {
    const instance = model.handles[removeIndex];
    publicAPI.unbindState(instance);
    model.handles.splice(removeIndex, 1);

    // update indices of subsequent handles
    for (let i = removeIndex; i < model.handles.length; i++) {
      model.handles[i].setIndex(i);
    }

    // Tool does not exist if loading new image
    const tool = getTool();
    if (tool) tool.points.splice(removeIndex, 1);

    publicAPI.modified();
  };

  publicAPI.clearHandles = () => {
    while (model.handles.length) {
      publicAPI.removeHandle(model.handles.length - 1);
    }
  };

  const addPointsAsHandles = () => {
    getTool().points.forEach((point) => {
      const handle = publicAPI.addHandle({ addPoint: false });
      handle.setOrigin(point);
    });
  };

  publicAPI.getPlacing = () => getTool().placing;

  publicAPI.setPlacing = (placing: boolean) => {
    const tool = getTool();
    tool.placing = placing;
    if (placing) return;

    // Decimate points
    const imageMeta = getImageMetadata(tool.imageID);
    const pixelSizeSquared = getPixelSizeSquared(
      tool.frameOfReference,
      imageMeta
    );
    if (pixelSizeSquared) {
      const optimizedLine = decimate(
        tool.points,
        pixelSizeSquared * DECIMATE_PIXEL_SIZE_FACTOR
      );
      publicAPI.clearHandles();
      tool.points = optimizedLine;
      addPointsAsHandles();
    } else {
      console.error(
        'Off LPS axis pixel sizing not implemented.  Not decimating line.'
      );
    }
  };

  // Setup after deserialization
  addPointsAsHandles();
}

const defaultValues = (initialValues: any) => ({
  toolType: AnnotationToolType.Polygon,
  ...initialValues,
});

function _createPolygonWidgetState(
  publicAPI: any,
  model: any,
  initialValues: any
) {
  Object.assign(model, defaultValues(initialValues));
  vtkAnnotationWidgetState.extend(publicAPI, model, initialValues);
  bounds.extend(publicAPI, model);

  macro.get(publicAPI, model, ['handles', 'moveHandle', 'finishable']);
  macro.setGet(publicAPI, model, ['finishable']);

  vtkPolygonWidgetState(publicAPI, model);
}

const createPolygonWidgetState = macro.newInstance(
  _createPolygonWidgetState,
  'vtkPolygonWidgetState'
);

export default createPolygonWidgetState;
