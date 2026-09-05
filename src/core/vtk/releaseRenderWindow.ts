import type vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { NOOP } from '@/src/constants';
import { Maybe } from '@/src/types';

export type WebGLContext = WebGLRenderingContext | WebGL2RenderingContext;

// releaseGraphicsResources is not in vtk.js' typings for vtkOpenGLRenderWindow,
// and neither is the shape of its model.
type ReleasableRenderWindow = vtkOpenGLRenderWindow & {
  releaseGraphicsResources(): void;
};

type RenderWindowModel = {
  get(): {
    context?: Maybe<WebGLContext>;
    rootOpenGLRenderWindow?: Maybe<vtkOpenGLRenderWindow>;
  };
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
 * Only a root render window holds a context; a child proxies getContext() and
 * releaseGraphicsResources() to the root, so releasing through one would take
 * out the resources its siblings are still drawing with.
 */
export function beginContextRelease(view: vtkOpenGLRenderWindow) {
  const releasable = view as ReleasableRenderWindow;
  const model = (view as unknown as RenderWindowModel).get();
  if (model.rootOpenGLRenderWindow) return NOOP;

  const context = model.context;
  if (context) releasable.releaseGraphicsResources();
  return () => context?.getExtension('WEBGL_lose_context')?.loseContext();
}
