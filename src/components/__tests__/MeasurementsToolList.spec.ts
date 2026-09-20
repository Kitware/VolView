import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import MeasurementsToolList from '@/src/components/MeasurementsToolList.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useSegmentStore } from '@/src/segmentation/segments';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';

enableAutoUnmount(afterEach);

const IMAGE_ID = 'img-1';

const SlotStub = defineComponent({ template: '<div><slot /></div>' });

const mountList = () =>
  mount(MeasurementsToolList, {
    global: {
      stubs: {
        VList: SlotStub,
        VListItem: SlotStub,
        VListItemTitle: {
          template: '<div class="row-title"><slot /></div>',
        },
        VListItemSubtitle: SlotStub,
        VCheckboxBtn: {
          props: ['disabled'],
          template:
            '<input type="checkbox" :disabled="disabled || undefined" />',
        },
        VMenu: {
          template: '<div><slot name="activator" :props="{}" /></div>',
        },
        VBtn: {
          props: ['disabled'],
          template:
            '<button :disabled="disabled || undefined"><slot /></button>',
        },
        VIcon: { template: '<i class="icon"><slot /></i>' },
        VTooltip: { template: '<span role="tooltip"><slot /></span>' },
      },
    },
  });

// The wrapper around the control whose label starts with one of the verbs.
const actionLabelled = (wrapper: VueWrapper, verbs: RegExp) => {
  const action = wrapper
    .findAllComponents(ReasonedAction)
    .find((candidate) =>
      verbs.test(candidate.get('[aria-label]').attributes('aria-label') ?? '')
    );
  if (!action) throw new Error(`No action labelled ${verbs}`);
  return action;
};

const drawRuler = (segmentId: string) =>
  useRulerStore().addTool({
    imageID: IMAGE_ID,
    segmentId,
    slice: 0,
    frameOfReference: AXIAL_FRAME_OF_REFERENCE,
  });

describe('measurement list', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
      id: IMAGE_ID,
    });
    useViewStore().setDataForAllViews(IMAGE_ID);
  });

  it('shows a shape of a hidden segment as hidden and says why its eye is off', () => {
    const { segments } = useSegmentStore();
    const segmentId = segments.mintSegment({ name: 'Tumor' });
    drawRuler(segmentId);
    segments.updateSegment(segmentId, { visible: false });

    const eye = actionLabelled(mountList(), /^(Show|Hide) Tumor/);

    expect(eye.get('button').attributes('disabled')).toBeDefined();
    expect(eye.get('.icon').text()).toBe('mdi-eye-off');
    expect(eye.get('[role="tooltip"]').text()).toBe(
      'Show segment Tumor to show or hide this measurement'
    );
  });

  it('names the shape of an unnamed segment', () => {
    drawRuler(useSegmentStore().segments.mintSegment({ name: '' }));

    expect(mountList().get('.row-title').text()).toBe('(no name)');
  });

  it('offers the selection actions disabled, saying why, before any measurement', () => {
    const wrapper = mountList();

    const selectAll = wrapper.get(
      'input[aria-label="Select all measurements"]'
    );
    expect(selectAll.attributes('disabled')).toBeDefined();
    expect(selectAll.element.parentElement?.textContent).toBe(
      'No measurements yet'
    );
    [/^Hide selected/, /^Delete selected/].forEach((verbs) => {
      const action = actionLabelled(wrapper, verbs);
      expect(action.get('button').attributes('disabled')).toBeDefined();
      expect(action.get('[role="tooltip"]').text()).toBe('No measurements yet');
    });
  });

  it('says why the selection actions wait for a selection', () => {
    drawRuler(useSegmentStore().segments.mintSegment({ name: 'Tumor' }));
    const wrapper = mountList();

    const hide = actionLabelled(wrapper, /^Hide selected/);
    const remove = actionLabelled(wrapper, /^Delete selected/);

    expect(hide.attributes('tabindex')).toBe('0');
    expect(hide.get('[role="tooltip"]').text()).toBe(
      'Select measurements to show or hide'
    );
    expect(remove.attributes('tabindex')).toBe('0');
    expect(remove.get('[role="tooltip"]').text()).toBe(
      'Select measurements to delete'
    );
  });
});
