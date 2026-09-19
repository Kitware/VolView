import { beforeEach, describe, expect, it } from 'vitest';

import { useSegmentationStore } from '@/src/segmentation/store';
import { useInputStaging } from '@/src/processing/composables/useInputStaging';
import type { ProcessingProvider } from '@/src/processing/types';
import { addMask } from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { bindSourceRefs } from '../sourceRefs';
import { labelmapTaskModel as model, seatStagingScene } from './stagingScene';

// A provider that would throw if staging ever reached it.
const refusingProvider = {
  stageInput: () => {
    throw new Error('nothing should be staged');
  },
} as unknown as ProcessingProvider;

describe('an empty segmentation is not a labelmap input', () => {
  beforeEach(async () => {
    await seatStagingScene();
  });

  it('reports no-segmentation until the record holds a mask', async () => {
    const staging = useInputStaging();
    useSegmentationStore().ensureSegmentationForImage('image-1');

    const empty = bindSourceRefs(model, staging.sourceRefContext());
    expect(empty.states.inputSeg).toBe('no-segmentation');
    expect(empty.labelmap.segmentations).toEqual({});
    expect(
      await staging.stageLabelmapInputs(refusingProvider, empty, model)
    ).toEqual({});

    addMask('image-1', 'Tumor');

    const populated = bindSourceRefs(model, staging.sourceRefContext());
    expect(populated.states.inputSeg).toBe('bound');
    expect(populated.labelmap.segmentations.inputSeg).toBe(
      useSegmentationStore().getSegmentationForImage('image-1')!.id
    );
    expect(populated.issues).toEqual([]);
  });
});
