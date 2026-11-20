import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, markRaw, nextTick, ref } from 'vue';
import { createVuetify } from 'vuetify';
import { Tags } from '@/src/core/dicomTags';
import { CurrentImageInjectionKey } from '@/src/composables/useCurrentImage';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useEnFaceInput } from '@/src/enface/useEnFaceInput';
import { useThinCalibration } from '@/src/enface/useThinCalibration';
import { useMaskDepthRequest } from '@/src/enface/useMaskDepthRequest';
import EnFaceControls from '@/src/enface/EnFaceControls.vue';
import { useEnFaceViewStore } from '@/src/enface/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { allocateMask } from '@/src/segmentation/masks/storage';
import { measureOccupiedDepth } from '@/src/segmentation/measurements/occupiedDepth';
import { createOCTFixture } from '@/tests/unit/octFixture';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { mat3 } from 'gl-matrix';
import type { Extent3D } from '@/src/segmentation/geometry';

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  const cache = useImageCacheStore();
  [...cache.imageIds].forEach((id) => cache.removeImage(id));
});

async function inputFor(pixelSpacing: string, oblique = false) {
  const fixture = createOCTFixture();
  await fixture.chunk.loadMeta();
  fixture.chunk.metadata!.push([Tags.PixelSpacing, pixelSpacing]);
  await fixture.image.addChunks([fixture.chunk]);
  const cache = useImageCacheStore();
  const id = cache.addProgressiveImage(fixture.image);
  fixture.image.startLoad();
  await untilLoaded(id);
  if (oblique) {
    const angle = (3 * Math.PI) / 180;
    const c = Number(Math.cos(angle).toFixed(14));
    const s = Number(Math.sin(angle).toFixed(14));
    fixture.image.getVtkImageData().setDirection([c, s, 0, -s, c, 0, 0, 0, 1]);
  }
  return mountInput(id);
}

async function mountInput(id: string) {
  const image = useImageCacheStore().getVtkImageData(id)!;
  const segmentation = useSegmentationStore();
  const segment = useSegmentStore().segments.addSegment(id, { name: 'Layer' });
  const extent: Extent3D = [0, 1, 0, 1, 0, 1];
  useSegmentStore().segments.setMask(segment, {
    image: markRaw(allocateMask(image, extent)),
    extent,
  });
  segmentation.maskVoxels(segment).apply(new Uint8Array(8).fill(1));
  const settings = useEnFaceViewStore().configFor('calibration', id);
  settings.segmentProjections[segment] = {
    visible: true,
    thresholdMicrons: 100,
  };
  const host = defineComponent({
    setup() {
      const projection = useEnFaceInput('calibration');
      const calibration = useThinCalibration(
        projection.source,
        projection.specification
      );
      const depth = useMaskDepthRequest(
        projection.source,
        projection.specification,
        segment
      );
      return () => {
        const reason = calibration.reason.value || depth.geometryReason.value;
        const request = reason ? null : depth.request.value;
        const result = request ? measureOccupiedDepth(request) : null;
        return h('div', [
          h(
            'output',
            {
              'data-measurable': Boolean(request),
              'data-counts': result ? Array.from(result.counts).join(',') : '',
              'data-depth': result
                ? result.maximumCount * calibration.micronsPerVoxel.value
                : '',
            },
            reason ?? 'Ready'
          ),
          h(EnFaceControls, {
            ...projection.controls.value,
            settings,
            segmentControls: {
              segments: [
                {
                  id: segment,
                  title: 'Layer',
                  listHidden: false,
                  thresholdMaximum: 200,
                },
              ],
              segmentationReason: null,
              thinReason: calibration.reason.value,
            },
          }),
        ]);
      };
    },
  });
  const wrapper = mount(host, {
    global: {
      plugins: [createVuetify()],
      provide: {
        [CurrentImageInjectionKey as symbol]: { imageID: ref(id) },
      },
    },
  });
  await nextTick();
  return {
    wrapper,
    settings,
    image,
    maskImage: segmentation.maskOf(segment)!.image,
  };
}

describe('occupied-depth input calibration', () => {
  it.each(['0\\0.0117', 'NaN\\0.0117', '0.0104'])(
    'rejects fallback depth spacing from PixelSpacing %s',
    async (spacing) => {
      const { wrapper } = await inputFor(spacing);
      try {
        expect(wrapper.get('output').attributes('data-measurable')).toBe(
          'false'
        );
        expect(wrapper.text()).toMatch(/no reliable declared voxel spacing/);
        expect(
          wrapper.find('[data-testid="enface-thin-reason"]').exists()
        ).toBe(true);
        expect(
          wrapper
            .find('[data-testid="enface-segment-threshold-input"]')
            .exists()
        ).toBe(false);
      } finally {
        wrapper.unmount();
      }
    }
  );

  it('keeps the declared axis measurable and rejects a defaulted axis after switching', async () => {
    const { wrapper, settings } = await inputFor('0.0104\\0');
    try {
      expect(wrapper.get('output').attributes('data-measurable')).toBe('true');
      expect(wrapper.get('output').attributes('data-depth')).toBe('20.8');
      const reason = '[data-testid="enface-thin-reason"]';
      const threshold = '[data-testid="enface-segment-threshold-input"]';
      expect(wrapper.find(reason).exists()).toBe(false);
      expect(wrapper.find(threshold).exists()).toBe(true);
      settings.axis = 0;
      await nextTick();
      expect(wrapper.get('output').attributes('data-measurable')).toBe('false');
      expect(wrapper.text()).toMatch(/no reliable declared voxel spacing/);
      expect(wrapper.find(reason).exists()).toBe(true);
      expect(wrapper.find(threshold).exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it('uses declared spacing without direction-cosine rounding at a threshold boundary', async () => {
    const { wrapper } = await inputFor('0.0104\\0.02', true);
    try {
      expect(wrapper.get('output').attributes('data-depth')).toBe('20.8');
    } finally {
      wrapper.unmount();
    }
  });

  it('rejects a mask that no longer matches the source grid', async () => {
    const { wrapper, maskImage } = await inputFor('0.0104\\0.02');
    try {
      maskImage.setSpacing([0.04, 0.0104, 0.1]);
      await nextTick();
      expect(wrapper.get('output').attributes('data-measurable')).toBe('false');
      expect(wrapper.text()).toMatch(
        /mask does not match the source voxel grid/
      );
    } finally {
      wrapper.unmount();
    }
  });

  it.each([
    { name: 'unit skewed', direction: [1, 0, 0, 0.1, 1, 0, 0, 0, 1] },
    {
      name: 'scaled skewed',
      direction: [0.01, 0, 0, 0.005, 0.01, 0, 0, 0, 0.01],
    },
    { name: 'zero-length', direction: [0, 0, 0, 0, 1, 0, 0, 0, 1] },
    { name: 'non-finite', direction: [Infinity, 0, 0, 0, 1, 0, 0, 0, 1] },
  ] satisfies { name: string; direction: mat3 }[])(
    'rejects a $name source grid',
    async ({ direction }) => {
      const { wrapper, image } = await inputFor('0.0104\\0.02');
      try {
        image.setDirection(direction);
        await nextTick();
        expect(wrapper.get('output').attributes('data-measurable')).toBe(
          'false'
        );
        expect(wrapper.text()).toMatch(
          /requires an orthogonal source voxel grid/
        );
      } finally {
        wrapper.unmount();
      }
    }
  );

  it('aligns occupied-depth pixels and slab ranges', async () => {
    const image = vtkImageData.newInstance();
    image.setDimensions([3, 4, 5]);
    image.setSpacing([0.01, 0.01, 0.01]);
    image
      .getPointData()
      .setScalars(vtkDataArray.newInstance({ values: new Uint8Array(60) }));
    const id = useImageCacheStore().addVTKImageData(image, 'slab.vti');
    const { wrapper, settings } = await mountInput(id);
    try {
      expect(wrapper.get('output').attributes('data-measurable')).toBe('true');
      expect(wrapper.get('output').attributes('data-depth')).toBe('20');
      expect(wrapper.get('output').attributes('data-counts')).toBe(
        '2,2,0,2,2,0,0,0,0,0,0,0,0,0,0'
      );
      settings.depthStart = 1;
      settings.depthEnd = 1;
      await nextTick();
      expect(wrapper.get('output').attributes('data-depth')).toBe('10');
      expect(wrapper.get('output').attributes('data-counts')).toBe(
        '1,1,0,1,1,0,0,0,0,0,0,0,0,0,0'
      );
    } finally {
      wrapper.unmount();
    }
  });

  it.each([2, 0.01])(
    'retains physical scale %s carried by an orthogonal generic image direction',
    async (scale) => {
      const image = vtkImageData.newInstance();
      image.setDimensions([2, 2, 2]);
      image.setSpacing([0.01, 0.01, 0.01]);
      image.setDirection([1, 0, 0, 0, scale, 0, 0, 0, 1]);
      image
        .getPointData()
        .setScalars(vtkDataArray.newInstance({ values: new Uint8Array(8) }));
      const id = useImageCacheStore().addVTKImageData(image, 'scaled.vti');
      const { wrapper } = await mountInput(id);
      try {
        expect(wrapper.get('output').attributes('data-measurable')).toBe(
          'true'
        );
        expect(wrapper.get('output').attributes('data-depth')).toBe(
          String(20 * scale)
        );
      } finally {
        wrapper.unmount();
      }
    }
  );
});
