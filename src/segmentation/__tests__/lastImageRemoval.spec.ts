import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { ACTION_TO_FUNC } from '@/src/composables/actions';
import { applyPostStateConfig, config } from '@/src/io/import/configJson';
import { maskOn } from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageStore } from '@/src/store/datasets-images';
import { useRulerStore } from '@/src/store/tools/rulers';

const segments = () => useSegmentStore().segments;
const names = () => segments().segmentList.value.map(({ name }) => name);

const seatBareImage = (id: string) =>
  useImageStore().addVTKImageData('CT', vtkImageData.newInstance(), { id });

const configure = (configured: Record<string, { color?: string }>) =>
  applyPostStateConfig(config.parse({ segments: configured }));

describe('segments once the last image is removed', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useSegmentStore();
  });

  it('keeps only the configured segments after Clear Scene', () => {
    seatBareImage('img-1');
    seatBareImage('img-2');
    const matched = segments().addSegment({ name: 'Node' });
    configure({ Tumor: { color: '#ff0000' }, Node: {} });
    const tumor = segments().findSegmentByName('Tumor')!.id;
    maskOn('img-1', tumor);
    maskOn('img-2', segments().addSegment({ name: 'Painted' }));
    useRulerStore().addTool({
      imageID: 'img-1',
      segmentId: segments().addSegment({ name: 'Measured' }),
    });
    segments().addSegment({ name: 'Empty' });

    ACTION_TO_FUNC.clearScene();

    expect(names()).toEqual(['Node', 'Tumor']);
    expect(segments().getSegment(matched)?.name).toBe('Node');
    expect(segments().selectedSegmentId.value).toBe(matched);
  });

  it('prunes nothing while an image remains', () => {
    seatBareImage('img-1');
    seatBareImage('img-2');
    maskOn('img-2', segments().addSegment({ name: 'Painted' }));
    segments().addSegment({ name: 'Empty' });

    useDatasetStore().remove('img-2');

    expect(names()).toEqual(['Painted', 'Empty']);
  });

  it('prunes when images removed one by one leave none', () => {
    seatBareImage('img-1');
    seatBareImage('img-2');
    segments().addSegment({ name: 'Empty' });

    useDatasetStore().remove('img-1');
    useDatasetStore().remove('img-2');

    expect(names()).toEqual([]);
  });

  it('keeps what a load brings after the last image left', async () => {
    seatBareImage('img-1');
    segments().addSegment({ name: 'Old' });
    ACTION_TO_FUNC.clearScene();

    segments().adopt([
      {
        id: 'saved',
        name: 'Restored',
        color: [1, 2, 3, 255],
        visible: true,
        locked: false,
      },
    ]);
    seatBareImage('img-2');
    segments().addSegment({ name: 'Minted' });
    await nextTick();

    expect(names()).toEqual(['Restored', 'Minted']);
  });
});
