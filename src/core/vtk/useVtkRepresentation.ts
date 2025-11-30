import { MaybeRef, onScopeDispose, unref, watchEffect } from 'vue';
import { vtkObject } from '@kitware/vtk.js/interfaces';
import vtkAbstractMapper from '@kitware/vtk.js/Rendering/Core/AbstractMapper';
import type {
  View,
  VtkObjectConstructor,
  vtkPropWithMapperProperty,
} from '@/src/core/vtk/types';
import { Maybe } from '@/src/types';
import { onVTKEvent } from '@/src/composables/onVTKEvent';

export interface UseVtkRepresentationParameters<Actor, Mapper> {
  view: View;
  data: MaybeRef<Maybe<vtkObject>>;
  vtkActorClass: VtkObjectConstructor<Actor>;
  vtkMapperClass: VtkObjectConstructor<Mapper>;
}

export function useVtkRepresentation<
  Actor extends vtkPropWithMapperProperty,
  Mapper extends vtkAbstractMapper,
  Property extends ReturnType<Actor['getProperty']>,
>({
  view,
  data: dataObject,
  vtkActorClass,
  vtkMapperClass,
}: UseVtkRepresentationParameters<Actor, Mapper>) {
  const actor = vtkActorClass.newInstance();
  const mapper = vtkMapperClass.newInstance();
  const property = actor.getProperty() as Property;

  actor.setMapper(mapper);

  watchEffect((onCleanup) => {
    const data = unref(dataObject);
    if (!data) return;

    const { renderer } = view;
    mapper.setInputData(data, 0);
    renderer.addActor(actor);
    view.requestRender();

    onCleanup(() => {
      renderer.removeActor(actor);
    });
  });

  [actor, mapper, property].forEach((obj: vtkObject) => {
    onVTKEvent(obj, 'onModified', () => {
      view.requestRender();
    });
  });

  onScopeDispose(() => {
    actor.delete();
    mapper.delete();
  });

  return { actor, mapper, property };
}
