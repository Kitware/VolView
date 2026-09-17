import type vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';

// These public methods are not included in vtk.js' render window typings.
type ReleasableRenderWindow = vtkOpenGLRenderWindow & {
  getContext(): WebGLRenderingContext | WebGL2RenderingContext | null;
  releaseGraphicsResources(): void;
};

/**
 * Releases a WebGL render window along with the browser context behind it.
 *
 * delete() alone leaves the context live until the canvas is collected, and
 * browsers force-lose the oldest context past their per page cap. loseContext()
 * runs after delete() because delete() removes the webglcontextlost handler
 * that would ask the browser to restore what we are giving up.
 */
export function releaseOpenGLRenderWindow(view: vtkOpenGLRenderWindow) {
  if (view.isDeleted()) return;
  const loseContext = beginContextRelease(view);
  try {
    view.delete();
  } finally {
    loseContext();
  }
}

/**
 * Frees a render window's GPU resources and returns the step that gives the
 * browser context back, for owners whose own teardown chain deletes the view
 * for them.
 *
 * This must only be called for a root render window. Child windows proxy both
 * methods to their root, which would release resources still used by siblings.
 */
export function beginContextRelease(view: vtkOpenGLRenderWindow) {
  const releasable = view as ReleasableRenderWindow;
  const context = releasable.getContext();
  releasable.releaseGraphicsResources();
  return () => context?.getExtension('WEBGL_lose_context')?.loseContext();
}
