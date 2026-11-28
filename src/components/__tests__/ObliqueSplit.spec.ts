import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, onUnmounted } from 'vue';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import ObliqueSliceViewer from '@/src/components/ObliqueSliceViewer.vue';
import VtkBaseObliqueSliceRepresentation from '@/src/components/vtk/VtkBaseObliqueSliceRepresentation.vue';
import { useImageStore } from '@/src/store/datasets-images';
import { useViewStore } from '@/src/store/views';
import useResliceCursorStore from '@/src/store/reslice-cursor';
import { makeImage } from '@/src/segmentation/__tests__/segmentMaskFixtures';

const createImage = (size: number) =>
  makeImage({ dimensions: [size, size, size] });

describe('split oblique cursor position', () => {
  const wrappers: VueWrapper[] = [];
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

  const mountSlice = (viewID: string) => {
    // Rendering is unnecessary here; retain the real camera collaborator.
    const VtkSlice = defineComponent({
      setup(_, { expose, slots }) {
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
        return () => h('div', slots.default?.());
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
    // The plane the viewer asks its slice representation to draw.
    return () =>
      [
        ...wrapper
          .findComponent(VtkBaseObliqueSliceRepresentation)
          .props('planeOrigin'),
      ] as number[];
  };

  it('keeps the cursor away from image center as split slice viewers mount', async () => {
    const image = createImage(10);
    useImageStore().addVTKImageData('image', image, { id: 'image' });
    const views = useViewStore();
    const source = views.layoutViews[0].id;
    views.setDataForView(source, 'image');
    views.setActiveView(source);
    mountSlice(source + '-axial');
    await nextTick();
    useResliceCursorStore().resliceCursor.setCenter([1, 2, 3]);
    const target = views.splitView(source, 'row')!;
    const split = ['-axial', '-coronal', '-sagittal'].map((suffix) =>
      mountSlice(target + suffix)
    );
    await nextTick();
    split.forEach((origin) => expect(origin()).toEqual([1, 2, 3]));
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
    const origin = mountSlice(source + '-axial');
    useResliceCursorStore().resliceCursor.setCenter([1, 2, 3]);
    views.setDataForView(source, 'second');
    await nextTick();
    expect(origin()).toEqual(second.getCenter());
  });
});
