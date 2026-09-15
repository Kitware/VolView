import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import PatientStudyVolumeBrowser from '@/src/components/PatientStudyVolumeBrowser.vue';
import { seatVolume } from '@/src/store/__tests__/datasetFixtures';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import type { ProgressiveImage } from '@/src/core/progressiveImage';

const SlotStub = defineComponent({
  template: '<div><slot /></div>',
});

const mountBrowser = () =>
  mount(PatientStudyVolumeBrowser, {
    props: { volumeKeys: ['seg-volume'] },
    global: {
      stubs: {
        GroupableItem: {
          template: '<div><slot :active="false" :select="() => {}" /></div>',
        },
        PersistentOverlay: {
          props: ['disabled'],
          template: '<div v-if="!disabled"><slot /></div>',
        },
        VImg: {
          template: '<div><slot name="placeholder" /><slot /></div>',
        },
        VProgressCircular: { template: '<div class="progress" />' },
        VContainer: SlotStub,
        VRow: SlotStub,
        VCol: SlotStub,
        VCard: SlotStub,
        VCardText: SlotStub,
        VCheckbox: true,
        VBtn: true,
        VMenu: true,
        VList: true,
        VListItem: true,
        VIcon: true,
        VTooltip: true,
        VSpacer: true,
      },
    },
  });

describe('DICOM segmentation conversion progress', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seatVolume('seg-volume', {
      Modality: 'SEG',
      SeriesDescription: 'TotalSegmentator segmentation',
    });
    useImageCacheStore().imageById['seg-volume'] = {
      getThumbnail: () => Promise.resolve(null),
    } as ProgressiveImage;
  });

  it('covers the source thumbnail while it is becoming a segmentation', async () => {
    const segmentations = useSegmentationStore();
    segmentations.convertingLabelmaps.add('seg-volume');
    const wrapper = mountBrowser();
    await nextTick();

    const progress = wrapper.find(
      '[data-testid="segmentation-conversion-progress"]'
    );
    expect(progress.exists()).toBe(true);
    expect(progress.text()).toContain('Adding segmentation');
    expect(wrapper.findAll('.progress')).toHaveLength(1);

    segmentations.convertingLabelmaps.delete('seg-volume');
    await nextTick();
    expect(
      wrapper.find('[data-testid="segmentation-conversion-progress"]').exists()
    ).toBe(false);
  });
});
