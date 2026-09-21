import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import PatientStudyVolumeBrowser from '@/src/components/PatientStudyVolumeBrowser.vue';
import { seatVolume } from '@/src/store/__tests__/datasetFixtures';
import { useSegmentationStore } from '@/src/segmentation/store';
import { seatImage } from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { defer } from '@/src/utils';

enableAutoUnmount(afterEach);

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
  beforeEach(async () => {
    setActivePinia(createPinia());
    seatVolume('seg-volume', {
      Modality: 'SEG',
      SeriesDescription: 'TotalSegmentator segmentation',
    });
    await seatImage('seg-volume');
    await seatImage('parent');
  });

  it('covers the source thumbnail until a pending conversion fails', async () => {
    const pending = defer<vtkImageData>();
    const entered = defer<void>();
    const conversion = useSegmentationStore().convertImageToLabelmap(
      'seg-volume',
      'parent',
      {
        resample: () => {
          entered.resolve();
          return pending.promise;
        },
      }
    );
    const outcome = conversion.catch((error: Error) => error);
    await entered.promise;
    const wrapper = mountBrowser();
    await nextTick();

    const progress = wrapper.find(
      '[data-testid="segmentation-conversion-progress"]'
    );
    expect(progress.exists()).toBe(true);
    expect(progress.text()).toContain('Adding segmentation');
    expect(wrapper.findAll('.progress')).toHaveLength(1);
    expect(wrapper.find('.series-selector').exists()).toBe(true);

    pending.reject(new Error('Resampling failed'));
    expect(await outcome).toMatchObject({ message: 'Resampling failed' });
    await nextTick();
    expect(
      wrapper.find('[data-testid="segmentation-conversion-progress"]').exists()
    ).toBe(false);
  });
});
