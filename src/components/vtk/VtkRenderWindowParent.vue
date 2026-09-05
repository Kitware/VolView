<script setup lang="ts">
import { VtkRenderWindowParentContext } from '@/src/components/vtk/context';
import { releaseOpenGLRenderWindow } from '@/src/core/vtk/releaseRenderWindow';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { effectScope, onScopeDispose, onUnmounted, provide } from 'vue';

const scope = effectScope(true);

const api = scope.run(() => {
  const renderWindow = vtkRenderWindow.newInstance();
  const rwView = renderWindow.newAPISpecificView('WebGL');
  renderWindow.addView(rwView);
  rwView.initialize();

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
})!;

onUnmounted(() => {
  scope.stop();
});

provide(VtkRenderWindowParentContext, api);
</script>

<template><slot /></template>
