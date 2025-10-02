<script setup lang="ts">
import { VtkRenderWindowParentContext } from '@/src/components/vtk/context';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { effectScope, onUnmounted, provide } from 'vue';

const scope = effectScope(true);

const api = scope.run(() => {
  const renderWindow = vtkRenderWindow.newInstance();
  const rwView = renderWindow.newAPISpecificView('WebGL');
  renderWindow.addView(rwView);
  rwView.initialize();

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
