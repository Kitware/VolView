import type vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';

// vtk.js' public cancelAnimation() is a no-op while the post-wheel extension
// window is still open (model._animationExtendedEnd), so a pending rAF can
// survive dispose and fire against a deleted interactor.
function cancelPendingAnimationFrame(interactor: vtkRenderWindowInteractor) {
  const model = (
    interactor as unknown as { get(): { animationRequest?: number | null } }
  ).get();
  if (model.animationRequest == null) return;

  cancelAnimationFrame(model.animationRequest);
  model.animationRequest = null;
}

// interactor.delete() cancels outstanding animations by rendering, through a
// view its callers have already deleted, so the pending frame has to go first.
export function deleteInteractor(interactor: vtkRenderWindowInteractor) {
  cancelPendingAnimationFrame(interactor);
  interactor.delete();
}
