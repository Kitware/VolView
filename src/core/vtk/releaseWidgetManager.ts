import type vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import type vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { Maybe } from '@/src/types';

type SelectorFramebuffer = {
  isDeleted(): boolean;
  releaseGraphicsResources(): void;
  getColorTexture(): Maybe<{
    releaseGraphicsResources(view: vtkOpenGLRenderWindow): void;
  }>;
};

type HardwareSelector = {
  isDeleted(): boolean;
  get(): { framebuffer?: Maybe<SelectorFramebuffer> };
};

/**
 * Deletes a widget manager and frees the picking resources vtk.js leaves behind.
 *
 * vtkWidgetManager.delete() drops only its own subscriptions, so the hardware
 * selector's framebuffer and color texture pile up on the shared context one
 * set per view.
 *
 * rootView owns that context, so there is nothing to hand back once it is gone.
 */
export function releaseWidgetManager(
  manager: vtkWidgetManager,
  rootView: vtkOpenGLRenderWindow
) {
  const selector = (
    manager as unknown as { get(): { _selector?: Maybe<HardwareSelector> } }
  ).get()._selector;
  const framebuffer =
    selector && !selector.isDeleted() ? selector.get().framebuffer : null;

  try {
    if (framebuffer && !framebuffer.isDeleted() && !rootView.isDeleted()) {
      framebuffer.getColorTexture()?.releaseGraphicsResources(rootView);
      framebuffer.releaseGraphicsResources();
    }
  } finally {
    manager.delete();
  }
}
