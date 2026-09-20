import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';

import SaveSegmentationDialog from '@/src/segmentation/components/SaveSegmentationDialog.vue';
import {
  mintSegment,
  seatSpecImage,
  seedVoxel,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { defer, type Deferred } from '@/src/utils';
import type { saveLabelmapExport } from '@/src/segmentation/components/saveLabelmapExport';

enableAutoUnmount(afterEach);

const CardStub = defineComponent({
  name: 'VCard',
  template: '<div class="card"><slot /></div>',
});

const globalOptions = {
  stubs: {
    VCard: CardStub,
    VCardTitle: { template: '<div><slot /></div>' },
    VCardText: { template: '<div><slot /></div>' },
    VCardActions: { template: '<div><slot /></div>' },
    VForm: { template: '<form><slot /></form>' },
    VTextField: {
      props: ['modelValue'],
      template: '<input class="filename" :value="modelValue" />',
    },
    // Vuetify's select consumes Enter to open its menu.
    VSelect: {
      props: ['modelValue', 'items'],
      template: '<select class="format" @keydown.enter.prevent />',
    },
    VAlert: { template: '<div class="alert"><slot /></div>' },
    VBtn: {
      props: ['loading', 'disabled'],
      template: '<button><slot /></button>',
    },
    VIcon: { template: '<i><slot /></i>' },
    VSpacer: { template: '<span />' },
  },
};

const paintedSegmentation = (imageId: string) => {
  const segmentation = store().ensureSegmentationForImage(imageId);
  const mask = store().createMask(
    segmentation.id,
    mintSegment({ name: 'Tumor' })
  );
  seedVoxel(mask.id, [1, 1, 0]);
  return segmentation;
};

const pressEnter = (target: EventTarget) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
  );

describe('saving segments with the Enter key', () => {
  let saved: Deferred<void>;
  let save: Mock<typeof saveLabelmapExport>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    // Writing a file needs an image codec this environment has no worker for;
    // a pending save is a save still running.
    saved = defer<void>();
    save = vi.fn(() => saved.promise);
  });

  const mountDialog = async () => {
    const segmentation = paintedSegmentation('img-1');
    const wrapper = mount(SaveSegmentationDialog, {
      props: { id: segmentation.id, save },
      // Attached, so a keystroke really does reach the window the way it does
      // in the app: a detached tree would scope the listener by accident.
      attachTo: document.body,
      global: globalOptions,
    });
    await nextTick();
    return wrapper;
  };

  it('saves when the keystroke belongs to the dialog', async () => {
    const wrapper = await mountDialog();

    pressEnter(wrapper.get('.filename').element);
    await flushPromises();

    expect(save.mock.calls).toEqual([['img-1', 'CT', 'seg.nrrd']]);
    expect(wrapper.emitted('done')).toBeUndefined();

    saved.resolve();
    await flushPromises();
    expect(wrapper.emitted('done')).toHaveLength(1);
  });

  it('leaves a keystroke outside the dialog alone', async () => {
    await mountDialog();

    pressEnter(window);
    pressEnter(document.body);
    await flushPromises();

    expect(save).not.toHaveBeenCalled();
  });

  it('leaves Enter to the format select that opens its menu with it', async () => {
    const wrapper = await mountDialog();

    pressEnter(wrapper.get('.format').element);
    await flushPromises();

    expect(save).not.toHaveBeenCalled();
  });

  // A second save would compose the same masks and download them twice.
  it('ignores Enter while the save it started is still running', async () => {
    const wrapper = await mountDialog();
    const field = wrapper.get('.filename').element;

    pressEnter(field);
    pressEnter(field);
    await flushPromises();
    pressEnter(field);
    await flushPromises();

    expect(save).toHaveBeenCalledTimes(1);
  });
});
