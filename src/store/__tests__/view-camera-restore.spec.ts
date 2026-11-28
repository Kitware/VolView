import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useViewCameraStore } from '@/src/store/view-configs/camera';

describe('restoring a saved camera', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it.each([
    ['holds its zoom when the session saved no auto-fit choice', {}, false],
    ['keeps auto-fit when the session saved it on', { autoFit: true }, true],
  ])('%s', (_name, saved, autoFit) => {
    const cameras = useViewCameraStore();

    cameras.deserialize('view', {
      image: { camera: { parallelScale: 7, ...saved } },
    });

    expect(cameras.getConfig('view', 'image')).toMatchObject({
      parallelScale: 7,
      autoFit,
    });
  });
});
