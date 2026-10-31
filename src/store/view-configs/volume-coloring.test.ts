import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { useImageCacheStore } from '@/src/store/image-cache';
import { applyOpacityFunction } from '@/src/composables/useColoringEffect';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import { ADAPTIVE_VOLUME_LIGHTING } from '@/src/utils/adaptiveVolumePreset';
import useVolumeColoringStore from './volume-coloring';

const viewID = 'volume';
const images: vtkImageData[] = [];
const scopes: ReturnType<typeof effectScope>[] = [];

function addImage(values: number[], numberOfComponents = 1) {
  const image = vtkImageData.newInstance();
  image.setDimensions(values.length / numberOfComponents, 1, 1);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'Scalars',
      values: Float32Array.from(values),
      numberOfComponents,
    })
  );
  images.push(image);
  const imageID = useImageCacheStore().addVTKImageData(image, 'volume');
  return { image, imageID };
}

function watchColoring(imageID: string) {
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => useVolumeColoringInitializer(viewID, imageID));
}

function selectStreamingPreset() {
  const { image, imageID } = addImage([0, 100, 200]);
  const progressiveImage = useImageCacheStore().imageById[imageID];
  progressiveImage.loaded.value = false;
  watchColoring(imageID);
  const store = useVolumeColoringStore();
  store.setColorPreset(viewID, imageID, 'CT-AAA');
  const finish = async () => {
    image
      .getPointData()
      .getScalars()
      .setData(Float32Array.from([-100, 250, 600]));
    progressiveImage.loaded.value = true;
    await nextTick();
  };
  return { imageID, store, finish };
}

describe('volume coloring initialization and preset selection', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop());
    const cache = useImageCacheStore();
    Object.values(cache.imageById).forEach((image) => image.dispose());
    images.splice(0).forEach((image) => {
      if (!image.isDeleted()) image.delete();
    });
  });

  for (const { name, values, components } of [
    { name: 'multicomponent', values: [0, 1, 2, 3, 4, 5], components: 3 },
    { name: 'nonfinite', values: [0, Infinity], components: 1 },
  ]) {
    it(`uses an applicable fallback for a configured adaptive preset on ${name} data`, () => {
      const { image, imageID } = addImage(values, components);
      const store = useVolumeColoringStore();
      store.setDefaults(imageID, {
        transferFunction: { preset: 'Adaptive-Balanced' },
      });

      store.resetToDefaultColoring(viewID, imageID, image);

      const config = store.getConfig(viewID, imageID)!;
      expect(config.transferFunction.preset).toBe('CT-AAA');
      const opacity = vtkPiecewiseFunction.newInstance();
      try {
        expect(() =>
          applyOpacityFunction(config.opacityFunction, opacity)
        ).not.toThrow();
      } finally {
        opacity.delete();
      }
    });
  }

  it('preserves explicit lighting while selecting adaptive and conventional presets', () => {
    const { imageID } = addImage([0, 50, 100, 200, 500]);
    const store = useVolumeColoringStore();
    const lighting = {
      enabled: false,
      ambient: 0.1,
      diffuse: 0.9,
      specular: 0.8,
      useLocalAmbientOcclusion: true,
    };
    store.updateCVRParameters(viewID, imageID, lighting);

    for (const preset of ['Adaptive-Balanced', 'CT-AAA', 'Adaptive-Surface']) {
      store.setColorPreset(viewID, imageID, preset);
      expect(store.getConfig(viewID, imageID)?.cvr).toMatchObject(lighting);
    }
  });

  it('applies adaptive lighting to the initial automatic appearance', () => {
    const { image, imageID } = addImage([0, 50, 100, 200, 500]);
    const store = useVolumeColoringStore();

    store.resetToDefaultColoring(viewID, imageID, image);

    expect(store.getConfig(viewID, imageID)?.transferFunction.preset).toBe(
      'Adaptive-Balanced'
    );
    expect(store.getConfig(viewID, imageID)?.cvr).toMatchObject(
      ADAPTIVE_VOLUME_LIGHTING
    );
  });

  it('fits a streaming preset to the completed range without resetting opacity or lighting edits', async () => {
    const { imageID, store, finish } = selectStreamingPreset();
    store.updateOpacityFunction(viewID, imageID, {
      shift: 0.2,
      shiftAlpha: 0.1,
    });
    store.updateCVRParameters(viewID, imageID, {
      ambient: 0.4,
      enabled: false,
    });
    const colorRange = [
      ...store.getConfig(viewID, imageID)!.transferFunction.mappingRange,
    ];

    await finish();

    const config = store.getConfig(viewID, imageID)!;
    expect(config.opacityFunction).toMatchObject({
      mappingRange: [-100, 600],
      shift: 0.2,
      shiftAlpha: 0.1,
    });
    expect(config.transferFunction).toMatchObject({
      preset: 'CT-AAA',
      mappingRange: colorRange,
    });
    expect(config.cvr).toMatchObject({ ambient: 0.4, enabled: false });
  });

  it('preserves a restored opacity range when an image finishes streaming', async () => {
    const { imageID, store, finish } = selectStreamingPreset();
    const selected = store.getConfig(viewID, imageID)!;
    store.deserialize(viewID, {
      [imageID]: {
        volumeColorConfig: {
          ...selected,
          opacityFunction: {
            ...selected.opacityFunction,
            mappingRange: [10, 90],
          },
        },
      },
    });

    await finish();

    expect(
      store.getConfig(viewID, imageID)?.opacityFunction.mappingRange
    ).toEqual([10, 90]);
  });
});
