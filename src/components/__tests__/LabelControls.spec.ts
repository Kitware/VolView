import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import LabelControls from '@/src/components/LabelControls.vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';

const ChipListStub = defineComponent({
  name: 'EditableChipList',
  props: ['items'],
  template: `
    <div>
      <div v-for="item in items" :key="item.id" :data-id="item.id">
        <slot name="item-append" :key="item.id" :item="item" />
      </div>
    </div>
  `,
});

const global = {
  stubs: {
    EditableChipList: ChipListStub,
    IsolatedDialog: { template: '<div><slot /></div>' },
    ToolLabelEditor: true,
    VCard: { template: '<div><slot /></div>' },
    VCardSubtitle: { template: '<div><slot /></div>' },
    VContainer: { template: '<div><slot /></div>' },
    VBtn: {
      props: ['icon'],
      template: '<button :data-icon="icon" />',
    },
  },
};

type ControlsStore =
  | ReturnType<typeof usePolygonStore>
  | ReturnType<typeof useRulerStore>;

const mountControls = (labelsStore: ControlsStore) =>
  mount(LabelControls, {
    props: { labelsStore },
    global,
  });

describe('label editing locks', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('does not offer editing for a locked shared segment', async () => {
    useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
      id: 'img-1',
    });
    useViewStore().setDataForAllViews('img-1');
    const segmentation =
      useSegmentationStore().ensureSegmentationForImage('img-1');
    const locked = useSegmentationStore().createSegment(segmentation.id, {
      name: 'Locked',
    });
    useSegmentationStore().updateSegment(locked.id, { locked: true });
    const editable = useSegmentationStore().createSegment(segmentation.id, {
      name: 'Editable',
    });
    await nextTick();

    const wrapper = mountControls(usePolygonStore());
    expect(
      wrapper
        .find(`[data-id="${locked.id}"]`)
        .find('[data-testid="edit-label-button"]')
        .exists()
    ).toBe(false);
    expect(
      wrapper
        .find(`[data-id="${editable.id}"]`)
        .find('[data-testid="edit-label-button"]')
        .exists()
    ).toBe(true);
  });

  it('keeps local ruler labels editable', () => {
    expect(
      mountControls(useRulerStore())
        .find('[data-testid="edit-label-button"]')
        .exists()
    ).toBe(true);
  });
});
