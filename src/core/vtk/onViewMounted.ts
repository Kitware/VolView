import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { whenever } from '@vueuse/core';
import { computed, onUnmounted } from 'vue';

function isViewMounted(renderWindowView: vtkOpenGLRenderWindow) {
  const container = vtkFieldRef(renderWindowView, 'container');
  return computed(() => !!container.value);
}

export function onViewMounted(
  renderWindowView: vtkOpenGLRenderWindow,
  callback: () => void
) {
  const isMounted = isViewMounted(renderWindowView);
  whenever(isMounted, () => {
    callback();
  });
}

export function onViewUnmounted(
  renderWindowView: vtkOpenGLRenderWindow,
  callback: () => void
) {
  const isMounted = isViewMounted(renderWindowView);
  whenever(
    computed(() => !isMounted.value),
    () => {
      callback();
    }
  );

  onUnmounted(() => {
    callback();
  });
}
