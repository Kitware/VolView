import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as readWriteImage from '@/src/io/readWriteImage';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { useInputStaging } from '@/src/processing/composables/useInputStaging';
import type { ProcessingProvider } from '@/src/processing/types';
import { addMask } from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { bindSourceRefs } from '../sourceRefs';
import type { TaskFormModel } from '../formModel';
import { labelmapTaskModel, seatStagingScene } from './stagingScene';

const imageTaskModel: TaskFormModel = {
  ...labelmapTaskModel,
  fields: [
    {
      kind: 'sourceRef',
      id: 'inputVolume',
      accepts: ['image'],
      required: true,
    },
  ],
};

const stagingProvider = () =>
  ({
    stageInput: vi.fn(async () => ['girder://staged/seg.nrrd']),
  }) as unknown as ProcessingProvider;

// Staging reads committed voxels, which resolves an unconfirmed preview. A task
// that stages no labelmap reads nothing, so it must leave the preview standing.
describe('labelmap staging and an unconfirmed preview', () => {
  let cancelPreview: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    await seatStagingScene();
    addMask('image-1', 'Tumor');
    vi.spyOn(readWriteImage, 'writeSegmentation').mockResolvedValue(
      new Uint8Array([1, 2, 3])
    );
    cancelPreview = vi.fn();
    useSegmentationEditsStore().hold(cancelPreview);
  });

  it('keeps the preview when the task binds no labelmap', async () => {
    const staging = useInputStaging();
    const bindings = bindSourceRefs(imageTaskModel, staging.sourceRefContext());
    expect(bindings.labelmap.segmentations).toEqual({});

    expect(
      await staging.stageLabelmapInputs(
        stagingProvider(),
        bindings,
        imageTaskModel
      )
    ).toEqual({});
    expect(cancelPreview).not.toHaveBeenCalled();
  });

  it('resolves the preview when the task binds one', async () => {
    const staging = useInputStaging();
    const bindings = bindSourceRefs(
      labelmapTaskModel,
      staging.sourceRefContext()
    );
    expect(Object.keys(bindings.labelmap.segmentations)).toEqual(['inputSeg']);

    await staging.stageLabelmapInputs(
      stagingProvider(),
      bindings,
      labelmapTaskModel
    );
    expect(cancelPreview).toHaveBeenCalledTimes(1);
  });
});
