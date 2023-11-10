import { Maybe } from '@/src/types';
import * as macros from '@kitware/vtk.js/macros';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';

export interface vtkOffscreenRenderWindowInteractor
  extends vtkRenderWindowInteractor {
  bindInteractionContainer(): void;
  unbindInteractionContainer(): void;
  setInteractionContainer(el: Maybe<HTMLElement>): boolean;
  getInteractionContainer(): Maybe<HTMLElement>;
}

interface Model {
  interactor: vtkRenderWindowInteractor;
  interactionContainer: Maybe<HTMLElement>;
  [prop: string]: any;
}

function replaceGetScreenEventPositionFor(
  publicAPI: vtkOffscreenRenderWindowInteractor,
  model: Model
) {
  function updateCurrentRenderer(x: number, y: number) {
    if (!model._forcedRenderer) {
      model.currentRenderer = publicAPI.findPokedRenderer(x, y);
    }
  }

  function getScreenEventPositionFor(source: PointerEvent) {
    if (!model.interactionContainer)
      throw new Error('Interaction container is not set!');

    const canvas = model._view.getCanvas();
    const bounds = model.interactionContainer.getBoundingClientRect();
    const scaleX = canvas.width / bounds.width;
    const scaleY = canvas.height / bounds.height;
    const position = {
      x: scaleX * (source.clientX - bounds.left),
      y: scaleY * (bounds.height - source.clientY + bounds.top),
      z: 0,
    };

    updateCurrentRenderer(position.x, position.y);
    return position;
  }

  model._getScreenEventPositionFor = getScreenEventPositionFor;
}

function vtkOffscreenRenderWindowInteractor(
  publicAPI: vtkOffscreenRenderWindowInteractor,
  model: Model
) {
  model.classHierarchy.push('vtkOffscreenRenderWindowInteractor');

  const { setInteractionContainer } = publicAPI;

  publicAPI.setInteractionContainer = (el: Maybe<HTMLElement>) => {
    if (model.container) {
      publicAPI.unbindEvents();
    }

    const changed = setInteractionContainer(el);

    if (el) {
      publicAPI.bindEvents(el);
    }

    return changed;
  };
}

export function extend(
  publicAPI: vtkOffscreenRenderWindowInteractor,
  model: Model,
  initialValues = {}
) {
  // should happen before extending the RenderWindowInteractor
  replaceGetScreenEventPositionFor(publicAPI, model);

  vtkRenderWindowInteractor.extend(publicAPI, model, initialValues);

  macros.setGet(publicAPI, model, ['interactionContainer']);

  vtkOffscreenRenderWindowInteractor(
    publicAPI as vtkOffscreenRenderWindowInteractor,
    model as Model
  );
}

export const newInstance = macros.newInstance(
  // @ts-ignore TODO fix this typing issue
  extend,
  'vtkOffscreenRenderWindowInteractor'
);

export default { newInstance, extend };
