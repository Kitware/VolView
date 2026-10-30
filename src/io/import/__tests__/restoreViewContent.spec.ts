import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createStateFileRestorer } from '@/src/io/import/processors/restoreStateFile';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useViewStore } from '@/src/store/views';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { defer } from '@/src/utils';

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.restoreAllMocks());

function restoreWithPendingMasks() {
  const views = useViewStore();
  const id = views.layoutViews[0].id;
  const manifest = ManifestSchema.parse({
    version: '7.0.0',
    dataSources: [{ id: 1, type: 'uri', uri: '/image.nrrd' }],
    datasets: [{ id: 'saved-image', dataSourceId: 1 }],
    viewByID: {
      [id]: {
        id,
        name: 'Axial',
        type: '2D',
        dataID: 'saved-image',
        options: { orientation: 'Axial' },
        config: {
          'saved-image': {
            window: {
              width: 90,
              level: 40,
              auto: 'FullRange',
              useAuto: false,
            },
            camera: { position: [1, 2, 3], parallelScale: 7 },
          },
        },
      },
    },
  });
  views.deserializeLayout(manifest);
  const masks =
    defer<
      Awaited<
        ReturnType<ReturnType<typeof useSegmentationStore>['deserialize']>
      >
    >();
  vi.spyOn(useSegmentationStore(), 'deserialize').mockReturnValue(
    masks.promise
  );
  const contrastAtBinding: number[] = [];
  const unsubscribe = views.ViewDataChangeEvent.on((viewID, dataID) => {
    if (dataID)
      contrastAtBinding.push(
        useWindowingStore().getConfig(viewID, dataID).width ?? 0
      );
  });
  const restored = createStateFileRestorer({ addWarning: vi.fn() })(
    manifest,
    [],
    { 'saved-image': 'image' }
  );
  unsubscribe.off();
  return { views, id, masks, restored, contrastAtBinding };
}

describe('restoring view content', () => {
  it.each(['complete', 'fail'] as const)(
    'shows the saved view before masks %s',
    async (outcome) => {
      const { views, id, masks, restored, contrastAtBinding } =
        restoreWithPendingMasks();
      expect(views.getView(id)?.dataID).toBe('image');
      expect(contrastAtBinding).toEqual([90]);
      expect(useViewCameraStore().getConfig(id, 'image')).toMatchObject({
        position: [1, 2, 3],
        parallelScale: 7,
      });

      if (outcome === 'complete') {
        masks.resolve({ skipped: [], restoredImportIds: new Set() });
        await restored;
      } else {
        masks.reject(new Error('Mask decode failed'));
        await expect(restored).rejects.toThrow('Mask decode failed');
      }
      expect(views.getView(id)?.dataID).toBe('image');
      expect(useWindowingStore().getConfig(id, 'image').width).toBe(90);
    }
  );

  it('does not rebind an image removed while masks decode', async () => {
    const { views, id, masks, restored } = restoreWithPendingMasks();
    views.removeDataFromViews('image');
    masks.resolve({ skipped: [], restoredImportIds: new Set() });
    await restored;
    expect(views.getView(id)?.dataID).toBeNull();
  });
});
