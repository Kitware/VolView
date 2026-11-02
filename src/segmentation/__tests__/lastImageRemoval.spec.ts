import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { ACTION_TO_FUNC } from '@/src/composables/actions';
import { applyPostStateConfig, config } from '@/src/io/import/configJson';
import {
  maskOn,
  segmentNames,
  serializeAnnotations,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageStore } from '@/src/store/datasets-images';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';

const segments = () => useSegmentStore().segments;

const seatBareImage = (id: string) => {
  useImageStore().addVTKImageData('CT', vtkImageData.newInstance(), { id });
  useViewStore().setDataForAllViews(id);
};

const configure = (configured: Record<string, { color?: string }>) =>
  applyPostStateConfig(config.parse({ segments: configured }), undefined, []);

describe('removing image segment sets', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useSegmentStore();
  });

  it('clears image identities and keeps configured defaults after Clear Scene', () => {
    configure({ Tumor: { color: '#ff0000' }, Node: {} });
    seatBareImage('img-1');
    const tumor = segments().findSegmentByName('img-1', 'Tumor')!.id;
    maskOn('img-1', tumor);
    useRulerStore().addTool({ imageID: 'img-1', segmentId: tumor });
    seatBareImage('img-2');
    maskOn('img-2', segments().addSegment('img-2', { name: 'Painted' }));
    segments().addSegment('img-2', { name: 'Empty' });

    ACTION_TO_FUNC.clearScene();

    const saved = serializeAnnotations();
    expect(saved.imageSegmentSets).toEqual([]);
    expect(saved.segments).toEqual([]);
    expect(saved.tools?.rulers?.tools).toEqual([]);
    expect(saved.seedSegmentDefaults?.map(({ name }) => name)).toEqual([
      'Tumor',
      'Node',
    ]);
  });

  it('removes one image set while preserving the remaining image', () => {
    seatBareImage('img-1');
    const first = segments().addSegment('img-1', { name: 'Tumor' });
    seatBareImage('img-2');
    const second = segments().findSegmentByName('img-2', 'Tumor')!.id;
    maskOn('img-2', second);
    segments().addSegment('img-2', { name: 'Empty' });

    useDatasetStore().remove('img-2');

    const saved = serializeAnnotations();
    expect(saved.imageSegmentSets?.map(({ imageId }) => imageId)).toEqual([
      'img-1',
    ]);
    expect(saved.segments?.map(({ id }) => id)).not.toContain(second);
    expect(segmentNames('img-1')).toEqual(['Tumor']);
    expect(saved.segments?.map(({ id }) => id)).toContain(first);
  });

  it('leaves no image sets when images are removed one by one', () => {
    seatBareImage('img-1');
    segments().addSegment('img-1', { name: 'Empty' });
    seatBareImage('img-2');

    useDatasetStore().remove('img-1');
    useDatasetStore().remove('img-2');

    const saved = serializeAnnotations();
    expect(saved.imageSegmentSets).toEqual([]);
    expect(saved.segments).toEqual([]);
  });

  it('keeps definitions restored after the last image left', async () => {
    seatBareImage('img-1');
    segments().addSegment('img-1', { name: 'Old' });
    ACTION_TO_FUNC.clearScene();
    seatBareImage('img-2');
    segments().adopt('img-2', [
      {
        id: 'saved',
        name: 'Restored',
        color: [1, 2, 3, 255],
        visible: true,
        locked: false,
      },
    ]);
    segments().addSegment('img-2', { name: 'Minted' });
    await nextTick();

    expect(segmentNames('img-2')).toEqual(['Restored', 'Minted']);
  });
});
