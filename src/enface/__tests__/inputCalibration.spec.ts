import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createVuetify } from 'vuetify';
import { Tags } from '@/src/core/dicomTags';
import { CurrentImageInjectionKey } from '@/src/composables/useCurrentImage';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useEnFaceInput } from '@/src/enface/useEnFaceInput';
import EnFaceControls from '@/src/enface/EnFaceControls.vue';
import { useEnFaceViewStore } from '@/src/enface/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { measureOccupiedDepth } from '@/src/segmentation/measurements/occupiedDepth';
import { createOCTFixture } from '@/tests/unit/octFixture';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

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
  const segment = useSegmentStore().segments.addSegment({ name: 'Layer' });
  const mask = segmentation.createMask(
    segmentation.ensureSegmentationForImage(id).id,
    segment
  );
  const voxels = segmentation.maskVoxels(mask.id);
  voxels.materialize();
  voxels.ensureContains([0, 1, 0, 1, 0, 1]);
  voxels.apply(new Uint8Array(8).fill(1));
  const settings = useEnFaceViewStore().configFor('calibration', id);
  settings.highlightThin = true;
  const host = defineComponent({
    setup() {
      const input = useEnFaceInput('calibration');
      return () => {
        const request = input.measurementRequest.value;
        const result = request ? measureOccupiedDepth(request) : null;
        const {
          axisOptions: axes,
          segmentOptions: segments,
          highlightEligibilityReason: highlightReason,
          ...controls
        } = input.controls.value;
        return h('div', [
          h(
            'output',
            {
              'data-measurable': Boolean(request),
              'data-depth': result
                ? result.maximumCount * input.micronsPerVoxel.value
                : '',
            },
            input.controls.value.thicknessReason ?? 'Ready'
          ),
          h(EnFaceControls, {
            ...controls,
            axes,
            segments,
            highlightReason,
            settings: input.settings.value,
            thresholdMaximum: 200,
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
    maskImage: segmentation.findMaskBinding(mask.id)!.image,
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
        for (const control of ['thin-highlight', 'thickness-threshold-input'])
          expect(
            wrapper
              .get(`[data-testid="enface-${control}"] input`)
              .attributes('disabled')
          ).toBeDefined();
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
      const highlight = wrapper.get(
        '[data-testid="enface-thin-highlight"] input'
      );
      const threshold = wrapper.get(
        '[data-testid="enface-thickness-threshold-input"] input'
      );
      expect(highlight.attributes('disabled')).toBeUndefined();
      expect(threshold.attributes('disabled')).toBeUndefined();
      settings.axis = 0;
      await nextTick();
      expect(wrapper.get('output').attributes('data-measurable')).toBe('false');
      expect(wrapper.text()).toMatch(/no reliable declared voxel spacing/);
      expect(highlight.attributes('disabled')).toBeDefined();
      expect(threshold.attributes('disabled')).toBeDefined();
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

  it('rejects a nonorthogonal source grid', async () => {
    const { wrapper, image } = await inputFor('0.0104\\0.02');
    try {
      image.setDirection([1, 0, 0, 0.1, 1, 0, 0, 0, 1]);
      await nextTick();
      expect(wrapper.get('output').attributes('data-measurable')).toBe('false');
      expect(wrapper.text()).toMatch(
        /requires an orthogonal source voxel grid/
      );
    } finally {
      wrapper.unmount();
    }
  });

  it('retains physical scale carried by an orthogonal generic image direction', async () => {
    const image = vtkImageData.newInstance();
    image.setDimensions([2, 2, 2]);
    image.setSpacing([0.01, 0.01, 0.01]);
    image.setDirection([1, 0, 0, 0, 2, 0, 0, 0, 1]);
    image
      .getPointData()
      .setScalars(vtkDataArray.newInstance({ values: new Uint8Array(8) }));
    const id = useImageCacheStore().addVTKImageData(image, 'scaled.vti');
    const { wrapper } = await mountInput(id);
    try {
      expect(wrapper.get('output').attributes('data-measurable')).toBe('true');
      expect(wrapper.get('output').attributes('data-depth')).toBe('40');
    } finally {
      wrapper.unmount();
    }
  });
});
