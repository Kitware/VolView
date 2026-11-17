import { beforeEach, describe, expect, it } from 'vitest';

import { useInputStaging } from '@/src/processing/composables/useInputStaging';
import type { ProcessingProvider } from '@/src/processing/types';
import {
  addSegment,
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

  it('reports no-segmentation until a segment has a mask', async () => {
    const staging = useInputStaging();

    const empty = bindSourceRefs(model, staging.sourceRefContext());
    expect(empty.states.inputSeg).toBe('no-segmentation');
    expect(empty.labelmap.segmentations).toEqual({});
    expect(await staging.stageLabelmapInputs(refusingProvider, empty)).toEqual(
      {}
    );

    const segmentId = addSegment('image-1', 'Tumor');
    expect(
      bindSourceRefs(model, staging.sourceRefContext()).states.inputSeg
    ).toBe('no-segmentation');

    seedVoxel(segmentId, [0, 0, 0]);

    const populated = bindSourceRefs(model, staging.sourceRefContext());
    expect(populated.states.inputSeg).toBe('bound');
    expect(populated.labelmap.segmentations.inputSeg?.imageId).toBe('image-1');
    expect(populated.issues).toEqual([]);
  });
});
