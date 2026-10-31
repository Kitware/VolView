import { describe, expect, it, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, ref, type Ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { useVolumeThumbnailing } from '@/src/composables/useVolumeThumbnailing';
import { CurrentImageInjectionKey } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { NOOP } from '@/src/constants';
import type { createVolumeThumbnailer } from '@/src/core/thumbnailers/volume-thumbnailer';

type Thumbnailer = ReturnType<typeof createVolumeThumbnailer>;

const IMAGE_ID = 'img-1';
const OTHER_IMAGE_ID = 'img-2';

// the real thumbnailer needs a WebGL context the test DOM cannot provide, so
// this stands in for the surface the composable touches
function createStubThumbnailer(
  capture?: Promise<string> | (() => Promise<string>)
) {
  let deleted = false;
  let captureCount = 0;
  const noopProxy = {
    setDataRange: NOOP,
    setMode: NOOP,
    setPoints: NOOP,
    setGaussians: NOOP,
    setPresetName: NOOP,
  };
  const renderWindow = {
    render: NOOP,
    captureImages: () => {
      captureCount += 1;
      return [
        typeof capture === 'function'
          ? capture()
          : (capture ?? Promise.resolve('')),
      ];
    },
  };
  const thumbnailer = {
    scene: { getRenderWindow: () => renderWindow },
    opacityFuncProxy: noopProxy,
    colorTransferFuncProxy: noopProxy,
    setInputImage: NOOP,
    setPreset: NOOP,
    resetCameraWithOrientation: NOOP,
    delete() {
      deleted = true;
    },
  };
  return {
    thumbnailer: thumbnailer as unknown as Thumbnailer,
    isDeleted: () => deleted,
    getCaptureCount: () => captureCount,
  };
}

function addImageToCache(id = IMAGE_ID) {
  const image = vtkImageData.newInstance();
  image.setDimensions([2, 2, 2]);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ values: new Uint8Array(8) }));
  useImageCacheStore().addVTKImageData(image, 'CT', { id });
}

function mountThumbnailing(
  thumbnailer: Thumbnailer,
  imageID: Ref<string | null>
) {
  const component = defineComponent({
    setup() {
      const { currentThumbnails } = useVolumeThumbnailing(
        64,
        () => thumbnailer
      );
      return () =>
        h('div', [
          h('img', {
            src: currentThumbnails.value['Adaptive-Balanced'] ?? '',
          }),
          h('img', {
            'data-preset': 'CT-AAA',
            src: currentThumbnails.value['CT-AAA'] ?? '',
          }),
        ]);
    },
  });
  return mount(component, {
    global: {
      provide: {
        [CurrentImageInjectionKey as symbol]: { imageID },
      },
    },
  });
}

describe('useVolumeThumbnailing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('disposes the thumbnailer when the component unmounts', async () => {
    const stub = createStubThumbnailer();
    const wrapper = mountThumbnailing(stub.thumbnailer, ref(null));
    expect(stub.isDeleted()).toBe(false);

    wrapper.unmount();
    await flushPromises();

    expect(stub.isDeleted()).toBe(true);
  });

  it('holds off deletion until an in-flight capture settles', async () => {
    let resolveCapture!: (uri: string) => void;
    const capture = new Promise<string>((resolve) => {
      resolveCapture = resolve;
    });
    const stub = createStubThumbnailer(capture);
    addImageToCache();

    const wrapper = mountThumbnailing(stub.thumbnailer, ref(IMAGE_ID));
    await flushPromises();
    expect(stub.getCaptureCount()).toBe(1);

    // captureImages() finishes its render on a timer, so deleting the render
    // window while the capture is pending would crash that callback.
    wrapper.unmount();
    await flushPromises();
    expect(stub.isDeleted()).toBe(false);

    resolveCapture('data:image/png;base64,');
    await flushPromises();
    expect(stub.isDeleted()).toBe(true);

    // the unmount sentinel keeps the remaining presets from capturing
    expect(stub.getCaptureCount()).toBe(1);
  });

  it('starts a new cycle even while an earlier capture never settles', async () => {
    const stub = createStubThumbnailer(new Promise<string>(() => {}));
    addImageToCache();
    addImageToCache(OTHER_IMAGE_ID);
    const imageID = ref<string | null>(IMAGE_ID);

    mountThumbnailing(stub.thumbnailer, imageID);
    await flushPromises();
    expect(stub.getCaptureCount()).toBe(1);

    imageID.value = OTHER_IMAGE_ID;
    await flushPromises();

    expect(stub.getCaptureCount()).toBeGreaterThan(1);
  });
  it('keeps the thumbnail map renderable when a volume finishes loading', async () => {
    const uri = 'data:image/png;base64,dGh1bWJuYWls';
    const stub = createStubThumbnailer(Promise.resolve(uri));
    addImageToCache();
    const image = useImageCacheStore().imageById[IMAGE_ID];
    image.loaded.value = false;
    const wrapper = mountThumbnailing(stub.thumbnailer, ref(IMAGE_ID));
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('');

    image.loaded.value = true;
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe(uri);
    wrapper.unmount();
    await flushPromises();
  });

  it('shows the selected image thumbnails when its cache is already complete', async () => {
    const firstURI = 'data:image/png;base64,Zmlyc3Q=';
    const secondURI = 'data:image/png;base64,c2Vjb25k';
    let captureURI = firstURI;
    const stub = createStubThumbnailer(() => Promise.resolve(captureURI));
    addImageToCache();
    addImageToCache(OTHER_IMAGE_ID);
    const imageID = ref<string | null>(IMAGE_ID);
    const wrapper = mountThumbnailing(stub.thumbnailer, imageID);
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe(firstURI);

    captureURI = secondURI;
    imageID.value = OTHER_IMAGE_ID;
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe(secondURI);

    imageID.value = IMAGE_ID;
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe(firstURI);
    wrapper.unmount();
    await flushPromises();
  });

  it('waits for complete data before rendering thumbnails, including background loads', async () => {
    const partialURI = 'data:image/png;base64,cGFydGlhbA==';
    const completeURI = 'data:image/png;base64,Y29tcGxldGU=';
    let captureURI = partialURI;
    const stub = createStubThumbnailer(() => Promise.resolve(captureURI));
    addImageToCache();
    addImageToCache(OTHER_IMAGE_ID);
    const image = useImageCacheStore().imageById[IMAGE_ID];
    image.loaded.value = false;
    const imageID = ref<string | null>(IMAGE_ID);
    const wrapper = mountThumbnailing(stub.thumbnailer, imageID);
    await flushPromises();
    expect(stub.getCaptureCount()).toBe(0);
    expect(wrapper.get('[data-preset="CT-AAA"]').attributes('src')).toBe('');

    imageID.value = OTHER_IMAGE_ID;
    await flushPromises();
    image.loaded.value = true;
    captureURI = completeURI;
    imageID.value = IMAGE_ID;
    await flushPromises();

    expect(wrapper.get('[data-preset="CT-AAA"]').attributes('src')).toBe(
      completeURI
    );
    wrapper.unmount();
    await flushPromises();
  });
});
