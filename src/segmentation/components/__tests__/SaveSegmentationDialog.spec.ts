import * as composition from '@/src/segmentation/io/composition';
import * as exportFiles from '@/src/segmentation/io/export';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import SaveSegmentationDialog from '@/src/segmentation/components/SaveSegmentationDialog.vue';
import {
  mintSegment,
  seatSpecImage,
  seedVoxel,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { defer, type Deferred } from '@/src/utils';

enableAutoUnmount(afterEach);

// ---------------------------------------------------------------------------
// Enter is the dialog's submit key. It belongs to this dialog: a keystroke
// aimed at an overlay above it, such as the format menu, is that overlay's,
// not a save. And a write already running is not joined by a second one, which
// would compose the same masks again and download them twice.
// ---------------------------------------------------------------------------

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
    VSelect: { props: ['modelValue', 'items'], template: '<select />' },
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
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  );

describe('saving segments with the Enter key', () => {
  let capture: ReturnType<typeof vi.spyOn>;
  let bundle: ReturnType<typeof vi.spyOn>;
  let bundled: Deferred<{ name: string; blob: Blob }>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    // The composition itself is not under test, and writing a file needs an
    // image codec this environment has no worker for, so the save is stopped
    // where it hands its parts over: the bundle stays pending, which is a save
    // still running.
    capture = vi
      .spyOn(composition, 'captureLabelmapParts')
      .mockReturnValue({ parent: vtkImageData.newInstance(), parts: [] });
    bundled = defer<{ name: string; blob: Blob }>();
    bundle = vi
      .spyOn(exportFiles, 'bundleExportFiles')
      .mockReturnValue(bundled.promise);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mountDialog = async () => {
    const segmentation = paintedSegmentation('img-1');
    const wrapper = mount(SaveSegmentationDialog, {
      props: { id: segmentation.id },
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

    expect(capture).toHaveBeenCalledTimes(1);
    expect(bundle).toHaveBeenCalledTimes(1);
  });

  it('leaves a keystroke outside the dialog alone', async () => {
    await mountDialog();

    pressEnter(window);
    pressEnter(document.body);
    await flushPromises();

    expect(capture).not.toHaveBeenCalled();
    expect(bundle).not.toHaveBeenCalled();
  });

  it('ignores Enter while the save it started is still running', async () => {
    const wrapper = await mountDialog();
    const field = wrapper.get('.filename').element;

    pressEnter(field);
    pressEnter(field);
    await flushPromises();
    pressEnter(field);
    await flushPromises();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(bundle).toHaveBeenCalledTimes(1);
  });
});
