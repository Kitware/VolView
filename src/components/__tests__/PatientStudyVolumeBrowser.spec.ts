import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import PatientStudyVolumeBrowser from '@/src/components/PatientStudyVolumeBrowser.vue';
import { seatVolume } from '@/src/store/__tests__/datasetFixtures';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import * as labelmapImport from '@/src/segmentation/io/import';
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('covers the source thumbnail while it is becoming a segmentation', async () => {
    let finish!: () => void;
    vi.spyOn(labelmapImport, 'importLabelmapImage').mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve([]);
      })
    );
    const conversion = useSegmentationStore().convertImageToLabelmap(
      'seg-volume',
      'parent'
    );
    const wrapper = mountBrowser();
    await nextTick();

    const progress = wrapper.find(
      '[data-testid="segmentation-conversion-progress"]'
    );
    expect(progress.exists()).toBe(true);
    expect(progress.text()).toContain('Adding segmentation');
    expect(wrapper.findAll('.progress')).toHaveLength(1);
    expect(wrapper.find('.series-selector').exists()).toBe(true);

    finish();
    await conversion;
    await nextTick();
    expect(
      wrapper.find('[data-testid="segmentation-conversion-progress"]').exists()
    ).toBe(false);
  });
});
