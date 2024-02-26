import { VtkObjectConstructor } from '@/src/core/vtk/types';
import vtkInteractorStyle from '@kitware/vtk.js/Rendering/Core/InteractorStyle';
import { vtkWarningMacro } from '@kitware/vtk.js/macros';
import { onScopeDispose } from 'vue';
import type { View } from '@/src/core/vtk/types';

export function useVtkInteractorStyle<T extends vtkInteractorStyle>(
  vtkCtor: VtkObjectConstructor<T>,
  view: View
) {
  const style = vtkCtor.newInstance();

  if (view.interactor.getInteractorStyle()) {
    vtkWarningMacro('Overwriting an already set interactor style');
  }
  view.interactor.setInteractorStyle(style);

  onScopeDispose(() => {
    if (view.interactor.getInteractorStyle() === style)
      view.interactor.setInteractorStyle(null);
    style.delete();
  });

  return { interactorStyle: style };
}
