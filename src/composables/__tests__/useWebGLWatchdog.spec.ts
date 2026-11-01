import { expect, it } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { init, type ErrorEvent } from '@sentry/vue';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';

it('reports volume settings when the shared parent WebGL context is lost', async () => {
  setActivePinia(createPinia());
  const events: ErrorEvent[] = [];
  const client = init({
    dsn: 'https://public@example.com/1',
    defaultIntegrations: false,
    transport: () => ({
      send: async () => ({}),
      flush: async () => true,
    }),
    beforeSend(event) {
      events.push(event);
      return null;
    },
  });
  const parent = vtkRenderWindow.newInstance();
  const sliceWindow = vtkRenderWindow.newInstance();
  const volumeWindow = vtkRenderWindow.newInstance();
  const sliceRenderer = vtkRenderer.newInstance();
  const volumeRenderer = vtkRenderer.newInstance();
  const view = vtkOpenGLRenderWindow.newInstance();
  const actor = vtkVolume.newInstance();
  const mapper = vtkVolumeMapper.newInstance({
    sampleDistance: 0.37,
    maximumSamplesPerRay: 123,
  });
  actor.setMapper(mapper);
  volumeRenderer.addVolume(actor);
  sliceWindow.addRenderer(sliceRenderer);
  volumeWindow.addRenderer(volumeRenderer);
  parent.addRenderWindow(sliceWindow);
  parent.addRenderWindow(volumeWindow);
  const scope = effectScope();

  try {
    scope.run(() =>
      useWebGLWatchdog({ renderWindowView: view, renderWindow: parent })
    );
    await nextTick();
    view.getCanvas()!.dispatchEvent(new Event('webglcontextlost'));
    await client?.flush();

    expect(events).toHaveLength(1);
    expect(events[0].message).toBe('WebGL2 context was lost');
    expect(events[0].contexts?.vtk).toMatchObject({
      sampleDistance: 0.37,
      maximumSamplesPerRay: 123,
    });
  } finally {
    scope.stop();
    await client?.close();
    parent.delete();
    sliceWindow.delete();
    volumeWindow.delete();
    sliceRenderer.delete();
    volumeRenderer.delete();
    view.delete();
    actor.delete();
    mapper.delete();
  }
});
