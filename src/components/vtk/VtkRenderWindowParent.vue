<script setup lang="ts">
import { captureException } from '@sentry/vue';
import { VtkRenderWindowParentContext } from '@/src/components/vtk/context';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import { Messages } from '@/src/constants';
import { releaseOpenGLRenderWindow } from '@/src/core/vtk/releaseRenderWindow';
import { useMessageStore } from '@/src/store/messages';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { effectScope, onScopeDispose, onUnmounted, provide } from 'vue';

const scope = effectScope(true);

const api = scope.run(() => {
  const renderWindow = vtkRenderWindow.newInstance();
  const rwView = renderWindow.newAPISpecificView('WebGL');
  renderWindow.addView(rwView);
  try {
    rwView.initialize();
  } catch (err) {
    // vtk.js throws when the browser returns no WebGL2 context.
    captureException(err);
    useMessageStore().addError(Messages.WebGLUnavailable.title, {
      details: Messages.WebGLUnavailable.details,
      persist: true,
    });
    return undefined;
  }

  // Child views unmount before this hook runs, so their nodes are already off
  // the scene graph by the time the WebGL context they draw through goes away.
  onScopeDispose(() => {
    renderWindow.removeView(rwView);
    releaseOpenGLRenderWindow(rwView as vtkOpenGLRenderWindow);
    renderWindow.delete();
  });

  return {
    renderWindow,
    renderWindowView: rwView as vtkOpenGLRenderWindow,
  };
});

const contextLost = useWebGLWatchdog(api);

onUnmounted(() => {
  scope.stop();
});

if (api) provide(VtkRenderWindowParentContext, { ...api, contextLost });
</script>

<template><slot v-if="api" /></template>
