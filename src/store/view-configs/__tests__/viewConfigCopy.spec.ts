import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { useVolumeColoringStore } from '@/src/store/view-configs/volume-coloring';
import { useCinePlaybackStore } from '@/src/store/view-configs/cine-playback';
import { useEnFaceViewStore } from '@/src/enface/store';
import { useImageStore } from '@/src/store/datasets-images';
import { useImageStatsStore } from '@/src/store/image-stats';
import '@/src/vtk/ColorMaps';
import { makeImage } from '@/src/segmentation/__tests__/segmentMaskFixtures';

describe('copying a view configuration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useImageStatsStore().stats.image = {
      scalarMin: 0,
      scalarMax: 0,
      autoRangeValues: {},
    };
    useImageStore().addVTKImageData(
      'image',
      makeImage({ dimensions: [2, 2, 12] }),
      { id: 'image' }
    );
  });

  it('copies the slice, which then changes on its own', () => {
    const slices = useViewSliceStore();
    slices.updateConfig('source', 'image', { slice: 7, min: 0, max: 11 });

    slices.copyView('source', 'copy');
    expect(slices.getConfig('copy', 'image')).toEqual(
      slices.getConfig('source', 'image')
    );
    slices.updateConfig('copy', 'image', { slice: 3 });
    expect(slices.getConfig('source', 'image').slice).toBe(7);
  });

  it('copies the window and level', () => {
    const windowing = useWindowingStore();
    windowing.updateConfig('source', 'image', {
      width: 120,
      level: 60,
      useAuto: false,
    });

    windowing.copyView('source', 'copy');
    expect(windowing.getConfig('copy', 'image')).toMatchObject({
      width: 120,
      level: 60,
      useAuto: false,
    });
  });

  it('copies a fitted camera with a position of its own', () => {
    const cameras = useViewCameraStore();
    cameras.updateConfig('source', 'image', {
      position: [1, 2, 3],
      focalPoint: [4, 5, 6],
      parallelScale: 14,
      autoFit: false,
    });
    cameras.markCameraAsInitialized('source', 'image');

    cameras.copyView('source', 'copy');
    const source = cameras.getConfig('source', 'image');
    const copy = cameras.getConfig('copy', 'image');
    expect(copy).toEqual(source);
    expect(copy?.position).not.toBe(source?.position);
    expect(cameras.isCameraInitialized('copy', 'image')).toBe(true);
  });

  it('copies the volume coloring with a mapping range of its own', () => {
    const coloring = useVolumeColoringStore();
    coloring.updateColorTransferFunction('source', 'image', {
      mappingRange: [10, 80],
    });

    coloring.copyView('source', 'copy');
    const source = coloring.getConfig('source', 'image')?.transferFunction;
    const copy = coloring.getConfig('copy', 'image')?.transferFunction;
    expect(copy?.mappingRange).toEqual([10, 80]);
    expect(copy?.mappingRange).not.toBe(source?.mappingRange);
  });

  it('copies the cine frame and rate with playback paused', () => {
    const cine = useCinePlaybackStore();
    cine.updateConfig('source', 'image', { frame: 1, fps: 30, playing: true });

    cine.copyView('source', 'copy');
    expect(cine.getConfig('copy', 'image')).toEqual({
      frame: 1,
      fps: 30,
      playing: false,
    });
    expect(cine.getConfig('source', 'image').playing).toBe(true);
  });

  it('copies en face settings, which then change on their own', () => {
    const enFace = useEnFaceViewStore();
    Object.assign(enFace.configFor('source', 'image'), {
      method: 'max',
      depthStart: 2,
      depthEnd: 9,
    });
    enFace.patchSegment('source', 'image', 'segment', {
      visible: true,
      thresholdMicrons: 40,
    });

    enFace.copyView('source', 'copy');
    expect(enFace.settingsFor('copy', 'image')).toEqual(
      enFace.settingsFor('source', 'image')
    );
    enFace.patchSegment('copy', 'image', 'segment', { visible: false });
    expect(
      enFace.settingsFor('source', 'image').segmentProjections.segment.visible
    ).toBe(true);
  });
});
