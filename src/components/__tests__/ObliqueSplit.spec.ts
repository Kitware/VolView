import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, onUnmounted } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import ObliqueSliceViewer from '@/src/components/ObliqueSliceViewer.vue';
import { useImageStore } from '@/src/store/datasets-images';
import { useViewStore } from '@/src/store/views';
import useResliceCursorStore from '@/src/store/reslice-cursor';

const createImage = (size: number) => {
  const image = vtkImageData.newInstance();
  image.setDimensions(size, size, size);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      values: new Uint8Array(size ** 3),
    })
  );
  return image;
};

describe('split oblique cursor position', () => {
  const wrappers: VueWrapper[] = [];
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

  const mountSlice = (viewID: string) => {
    // Rendering is unnecessary here; retain the real camera collaborator.
    const VtkSlice = defineComponent({
      setup(_, { expose }) {
        const renderer = vtkRenderer.newInstance();
        const renderWindow = vtkRenderWindow.newInstance();
        const renderWindowView = vtkOpenGLRenderWindow.newInstance();
        renderWindowView.setSize(100, 100);
        renderWindow.addRenderer(renderer);
        renderWindow.addView(renderWindowView);
        onUnmounted(() => {
          renderer.delete();
          renderWindowView.delete();
          renderWindow.delete();
        });
        expose({
          renderer,
          requestRender: () => {},
          resetCamera: () => {},
        });
        return () => h('div');
      },
    });
    const wrapper = shallowMount(ObliqueSliceViewer, {
      props: {
        viewId: viewID,
        outlineType: 'ObliqueAxial',
        viewDirection: 'Superior',
        viewUp: 'Anterior',
      },
      global: { stubs: { VtkSliceView: VtkSlice } },
    });
    wrappers.push(wrapper);
  };

  it('keeps the cursor away from image center as split slice viewers mount', async () => {
    const image = createImage(10);
    useImageStore().addVTKImageData('image', image, { id: 'image' });
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    views.setDataForView(source, 'image');
    views.setActiveView(source);
    const cursor = useResliceCursorStore();
    mountSlice(source + '-axial');
    await nextTick();
    cursor.resliceCursor.setCenter([1, 2, 3]);
    const target = views.splitView(source, 'row')!;
    mountSlice(target + '-axial');
    mountSlice(target + '-coronal');
    mountSlice(target + '-sagittal');
    await nextTick();
    expect(cursor.resliceCursorState.getCenter()).toEqual([1, 2, 3]);
    expect(cursor.resliceCursorState.getImage()).toBe(image);
  });

  it('still recenters when the selected dataset changes', async () => {
    const first = createImage(10);
    const second = createImage(20);
    const images = useImageStore();
    images.addVTKImageData('first', first, { id: 'first' });
    images.addVTKImageData('second', second, { id: 'second' });
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    views.setDataForView(source, 'first');
    views.setActiveView(source);
    const cursor = useResliceCursorStore();
    mountSlice(source + '-axial');
    cursor.resliceCursor.setCenter([1, 2, 3]);
    views.setDataForView(source, 'second');
    await nextTick();
    expect(cursor.resliceCursorState.getImage()).toBe(second);
    expect(cursor.resliceCursorState.getCenter()).toEqual(second.getCenter());
  });
});
