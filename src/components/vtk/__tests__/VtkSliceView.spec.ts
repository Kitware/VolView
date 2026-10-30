import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import VtkSliceView from '@/src/components/vtk/VtkSliceView.vue';
import type { View } from '@/src/core/vtk/types';
import * as vtkViews from '@/src/core/vtk/useVtkView';
import { metadataFromVtkImageData } from '@/src/utils/imageMetadata';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';

const views: View[] = [];

beforeEach(() => setActivePinia(createPinia()));
enableAutoUnmount(afterEach);
afterEach(async () => {
  vi.restoreAllMocks();
  views.splice(0).forEach((view) => {
    view.interactor.delete();
    view.renderer.delete();
  });
  await cleanupCachedImages([]);
});

function create() {
  const image = vtkImageData.newInstance();
  image.setDimensions(3, 4, 5);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ values: new Uint8Array(60) }));
  useImageCacheStore().addVTKImageData(image, 'Volume', { id: 'image' });
  const metadata = { name: 'Volume', ...metadataFromVtkImageData(image) };
  const renderer = vtkRenderer.newInstance();
  const view = {
    renderer,
    imageRenderer: renderer,
    interactor: vtkRenderWindowInteractor.newInstance(),
    requestRender: vi.fn(),
    renderWindowView: { getSize: () => [400, 400] },
  } as unknown as View;
  views.push(view);
  vi.spyOn(vtkViews, 'useVtkView').mockReturnValue(view);
  const viewId = useViewStore().layoutViews[0].id;
  const wrapper = mount(VtkSliceView, {
    props: {
      viewId,
      imageId: 'image',
      viewDirection: 'Posterior',
      viewUp: 'Superior',
      renderGeometry: { metadata, fitKey: 'axis-1' },
    },
  });
  const camera = renderer.getActiveCamera();
  return { wrapper, camera, metadata, cameras: useViewCameraStore(), viewId };
}

it.each([false, true])(
  'faces the new projection axis with automatic reset disabled=%s',
  async (disabled) => {
    const { wrapper, camera, metadata, cameras, viewId } = create();
    expect([...camera.getDirectionOfProjection()]).toAlmostEqual([0, 1, 0]);
    camera.setPositionAndFocalPoint([2, -9, 1], [2, 1, 1]);
    camera.setParallelScale(0.75);
    cameras.updateConfig(viewId, 'image', { autoFit: false });
    cameras.disableCameraAutoReset = disabled;
    await nextTick();
    await wrapper.setProps({
      viewDirection: 'Left',
      viewUp: 'Posterior',
      renderGeometry: { metadata, fitKey: 'axis-0' },
    });
    expect([...camera.getDirectionOfProjection()]).toAlmostEqual([1, 0, 0]);
    expect([...camera.getViewUp()]).toAlmostEqual([0, 1, 0]);
    if (disabled) {
      expect([...camera.getFocalPoint()]).toAlmostEqual([2, 1, 1]);
      expect(camera.getDistance()).toBeCloseTo(10);
      expect(camera.getParallelScale()).toBe(0.75);
      expect(cameras.getConfig(viewId, 'image')?.autoFit).toBe(false);
      const position = [...camera.getPosition()];
      await wrapper.setProps({
        renderGeometry: { metadata, fitKey: 'axis-0-edited' },
      });
      cameras.disableCameraAutoReset = false;
      await nextTick();
      expect([...camera.getPosition()]).toAlmostEqual(position);
      expect(camera.getParallelScale()).toBe(0.75);
    } else {
      expect(cameras.getConfig(viewId, 'image')?.autoFit).toBe(true);
      expect(camera.getParallelScale()).not.toBe(0.75);
    }
  }
);
