import { beforeEach, describe, expect, it } from 'vitest';

import { useSegmentationStore } from '@/src/segmentation/store';
import { useInputStaging } from '@/src/processing/composables/useInputStaging';
import type { ProcessingProvider } from '@/src/processing/types';
import {
  addMask,
  seedVoxel,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { bindSourceRefs } from '../sourceRefs';
import { labelmapTaskModel as model, seatStagingScene } from './stagingScene';

const refusingProvider = {
  stageInput: () => {
    throw new Error('nothing should be staged');
  },
} as unknown as ProcessingProvider;

describe('an empty segmentation is not a labelmap input', () => {
  beforeEach(async () => {
    await seatStagingScene();
  });

  it('reports no-segmentation until a mask holds a voxel', async () => {
    const staging = useInputStaging();
    useSegmentationStore().ensureSegmentationForImage('image-1');

    const empty = bindSourceRefs(model, staging.sourceRefContext());
    expect(empty.states.inputSeg).toBe('no-segmentation');
    expect(empty.labelmap.segmentations).toEqual({});
    expect(await staging.stageLabelmapInputs(refusingProvider, empty)).toEqual(
      {}
    );

    // A segment declared but never painted, as a result that found nothing
    // leaves one, stages the same all-background file.
    const maskId = addMask('image-1', 'Tumor');
    expect(
      bindSourceRefs(model, staging.sourceRefContext()).states.inputSeg
    ).toBe('no-segmentation');

    seedVoxel(maskId, [0, 0, 0]);

    const populated = bindSourceRefs(model, staging.sourceRefContext());
    expect(populated.states.inputSeg).toBe('bound');
    expect(populated.labelmap.segmentations.inputSeg?.segmentationId).toBe(
      useSegmentationStore().getSegmentationForImage('image-1')!.id
    );
    expect(populated.issues).toEqual([]);
  });
});
