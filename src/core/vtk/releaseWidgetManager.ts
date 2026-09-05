import type vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import type vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { WebGLContext } from '@/src/core/vtk/releaseRenderWindow';
import { Maybe } from '@/src/types';

type SelectorFramebuffer = {
  isDeleted(): boolean;
  releaseGraphicsResources(): void;
  getColorTexture(): Maybe<{
    releaseGraphicsResources(view: vtkOpenGLRenderWindow): void;
  }>;
  get(): {
    context?: Maybe<WebGLContext>;
    depthTexture?: Maybe<WebGLRenderbuffer>;
  };
};

type HardwareSelector = {
  isDeleted(): boolean;
  get(): { framebuffer?: Maybe<SelectorFramebuffer> };
};

/**
 * Deletes a widget manager and frees the picking resources vtk.js leaves behind.
 *
 * vtkWidgetManager.delete() drops only its own subscriptions, so the hardware
 * selector's framebuffer, color texture and depth renderbuffer pile up on the
 * shared context one set per view; the framebuffer's releaseGraphicsResources()
 * covers itself alone, hence the explicit renderbuffer handback.
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
      const { context, depthTexture } = framebuffer.get();
      if (context && depthTexture) {
        context.deleteRenderbuffer(depthTexture);
      }
      framebuffer.releaseGraphicsResources();
    }
  } finally {
    manager.delete();
  }
}
