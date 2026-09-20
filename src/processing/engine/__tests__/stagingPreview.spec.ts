import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { writeSegmentation } from '@/src/io/readWriteImage';
import { readFileAsArrayBuffer } from '@/src/io/io';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { useInputStaging } from '@/src/processing/composables/useInputStaging';
import type { ProcessingProvider } from '@/src/processing/types';
import {
  addMask,
  seedVoxel,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
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

const stagingProvider = () => {
  const stageInput = vi.fn<ProcessingProvider['stageInput']>(async () => [
    'girder://staged/seg.nrrd',
  ]);
  return {
    stageInput,
    provider: { stageInput } as unknown as ProcessingProvider,
  };
};

describe('labelmap staging and an unconfirmed preview', () => {
  let cancelPreview: ReturnType<typeof vi.fn<() => void>>;
  let write: ReturnType<typeof vi.fn<typeof writeSegmentation>>;
  let written: number[][];

  beforeEach(async () => {
    await seatStagingScene();
    const mask = addMask('image-1', 'Tumor');
    seedVoxel(mask, [0, 0, 0]);
    seedVoxel(mask, [1, 0, 0]);
    const live = store().maskVoxels(mask).scalars();
    live.set([0, 1]);
    cancelPreview = vi.fn(() => live.set([1, 0]));
    useSegmentationEditsStore().hold(cancelPreview);
    written = [];
    write = vi.fn(async (_format, image) => {
      const values = [...image.getPointData().getScalars().getData()];
      written.push(values);
      return new Uint8Array(values);
    });
  });

  it('keeps the preview when the task binds no labelmap', async () => {
    const staging = useInputStaging(write);
    const { provider, stageInput } = stagingProvider();
    const bindings = bindSourceRefs(imageTaskModel, staging.sourceRefContext());

    expect(await staging.stageLabelmapInputs(provider, bindings)).toEqual({});
    expect(cancelPreview).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(stageInput).not.toHaveBeenCalled();
  });

  it('stages committed pixels after cancelling the preview', async () => {
    const staging = useInputStaging(write);
    const { provider, stageInput } = stagingProvider();
    const bindings = bindSourceRefs(
      labelmapTaskModel,
      staging.sourceRefContext()
    );

    expect(await staging.stageLabelmapInputs(provider, bindings)).toEqual({
      inputSeg: { type: 'labelmap', uris: ['girder://staged/seg.nrrd'] },
    });
    expect(cancelPreview).toHaveBeenCalledTimes(1);
    expect(written).toEqual([[1, 0, 0, 0, 0, 0, 0, 0]]);
    expect(stageInput).toHaveBeenCalledTimes(1);
    const [{ file, descriptor }] = stageInput.mock.calls[0];
    expect(descriptor).toMatchObject({
      type: 'labelmap',
      name: 'image.seg.nrrd',
      referenceImage: { type: 'image', uris: ['girder://file/image-1'] },
    });
    expect(
      new Uint8Array(await readFileAsArrayBuffer(new File([file], 'input')))
    ).toEqual(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]));
  });
});
