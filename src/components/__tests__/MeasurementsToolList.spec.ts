import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import MeasurementsToolList from '@/src/components/MeasurementsToolList.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import type { Ruler } from '@/src/types/ruler';
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
        VListItemSubtitle: {
          template: '<div class="row-subtitle"><slot /></div>',
        },
        VCheckboxBtn: {
          props: ['disabled', 'modelValue', 'indeterminate'],
          template: `<input
            type="checkbox"
            :checked="modelValue"
            :indeterminate="indeterminate"
            :disabled="disabled || undefined"
          />`,
        },
        VMenu: {
          template: '<div><slot name="activator" :props="{}" /><slot /></div>',
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

const drawRuler = (segmentId: string, overrides: Partial<Ruler> = {}) =>
  useRulerStore().addTool({
    imageID: IMAGE_ID,
    segmentId,
    slice: 0,
    frameOfReference: AXIAL_FRAME_OF_REFERENCE,
    ...overrides,
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

  it('selects all rows from a partial selection and clears them on a second click', async () => {
    const { segments } = useSegmentStore();
    drawRuler(segments.mintSegment({ name: 'Tumor' }));
    drawRuler(segments.mintSegment({ name: 'Node' }));
    const wrapper = mountList();
    const selectAll = wrapper.get<HTMLInputElement>(
      'input[aria-label="Select all measurements"]'
    );
    const checkboxes = () =>
      wrapper
        .findAll<HTMLInputElement>('[data-testid="segment-shape-row"] input')
        .map((checkbox) => checkbox.element.checked);

    expect(wrapper.text()).toContain('0 of 2 selected');
    await wrapper
      .get('input[aria-label="Select Tumor: Axial 1"]')
      .trigger('click');
    expect(wrapper.text()).toContain('1 of 2 selected');
    expect(checkboxes()).toEqual([true, false]);
    expect(selectAll.element.checked).toBe(false);
    expect(selectAll.element.indeterminate).toBe(true);

    await selectAll.trigger('click');
    expect(wrapper.text()).toContain('2 of 2 selected');
    expect(checkboxes()).toEqual([true, true]);
    expect(selectAll.element.checked).toBe(true);
    expect(selectAll.element.indeterminate).toBe(false);

    await selectAll.trigger('click');
    expect(wrapper.text()).toContain('0 of 2 selected');
    expect(checkboxes()).toEqual([false, false]);
    expect(selectAll.element.checked).toBe(false);
    expect(
      actionLabelled(wrapper, /^Hide selected/)
        .get('button')
        .attributes('disabled')
    ).toBeDefined();
    expect(
      actionLabelled(wrapper, /^Delete selected/)
        .get('button')
        .attributes('disabled')
    ).toBeDefined();
  });

  it('hides and shows selected measurements without changing hidden-segment children or unselected rows', async () => {
    const { segments } = useSegmentStore();
    const tumor = segments.mintSegment({ name: 'Tumor' });
    const node = segments.mintSegment({ name: 'Node', visible: false });
    const other = segments.mintSegment({ name: 'Other' });
    drawRuler(tumor);
    drawRuler(tumor, { slice: 1, hidden: true });
    drawRuler(node, { slice: 2 });
    drawRuler(node, { slice: 3, hidden: true });
    drawRuler(other, { slice: 4 });
    const wrapper = mountList();
    const eyes = () =>
      wrapper
        .findAll('[data-testid="segment-shape-row"]')
        .map((row) =>
          row
            .get('button[aria-label^="Hide "], button[aria-label^="Show "]')
            .get('.icon')
            .text()
        );

    for (const label of [
      'Select Tumor: Axial 1',
      'Select Tumor: Axial 2',
      'Select Node: Axial 3',
      'Select Node: Axial 4',
    ]) {
      await wrapper.get(`input[aria-label="${label}"]`).trigger('click');
    }
    expect(wrapper.text()).toContain('4 of 5 selected');
    await actionLabelled(wrapper, /^Hide selected/)
      .get('button')
      .trigger('click');
    expect(eyes()).toEqual([
      'mdi-eye-off',
      'mdi-eye-off',
      'mdi-eye-off',
      'mdi-eye-off',
      'mdi-eye',
    ]);

    // Showing the parent exposes whether the bulk action changed its child flags.
    segments.updateSegment(node, { visible: true });
    await nextTick();
    expect(eyes()).toEqual([
      'mdi-eye-off',
      'mdi-eye-off',
      'mdi-eye',
      'mdi-eye-off',
      'mdi-eye',
    ]);
    segments.updateSegment(node, { visible: false });
    await nextTick();

    await actionLabelled(wrapper, /^Show selected/)
      .get('button')
      .trigger('click');
    expect(eyes()).toEqual([
      'mdi-eye',
      'mdi-eye',
      'mdi-eye-off',
      'mdi-eye-off',
      'mdi-eye',
    ]);
    segments.updateSegment(node, { visible: true });
    await nextTick();
    expect(eyes()).toEqual([
      'mdi-eye',
      'mdi-eye',
      'mdi-eye',
      'mdi-eye-off',
      'mdi-eye',
    ]);
    expect(wrapper.text()).toContain('4 of 5 selected');
  });

  it('explains why a selection under hidden segments cannot be shown or hidden', async () => {
    drawRuler(
      useSegmentStore().segments.mintSegment({ name: 'Tumor', visible: false })
    );
    const wrapper = mountList();
    await wrapper
      .get('input[aria-label="Select Tumor: Axial 1"]')
      .trigger('click');

    expect(wrapper.text()).toContain('1 of 1 selected');
    const visibility = actionLabelled(wrapper, /^Hide selected/);
    expect(visibility.get('button').attributes('disabled')).toBeDefined();
    expect(visibility.get('[role="tooltip"]').text()).toBe(
      'Show the segments of the selected measurements first'
    );
    expect(
      actionLabelled(wrapper, /^Delete selected/)
        .get('button')
        .attributes('disabled')
    ).toBeUndefined();
  });

  it('deletes selected rulers and rectangles while keeping an unselected measurement', async () => {
    const { segments } = useSegmentStore();
    drawRuler(segments.mintSegment({ name: 'Tumor' }));
    drawRuler(segments.mintSegment({ name: 'Other' }));
    useRectangleStore().addTool({
      imageID: IMAGE_ID,
      segmentId: segments.mintSegment({ name: 'Node' }),
      slice: 0,
      frameOfReference: AXIAL_FRAME_OF_REFERENCE,
    });
    const wrapper = mountList();
    await wrapper
      .get('input[aria-label="Select Tumor: Axial 1"]')
      .trigger('click');
    await wrapper
      .get('input[aria-label="Select Node: Axial 1"]')
      .trigger('click');
    expect(wrapper.text()).toContain('2 of 3 selected');

    await actionLabelled(wrapper, /^Delete selected/)
      .get('button')
      .trigger('click');

    const rows = wrapper.findAll('[data-testid="segment-shape-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].get('input').attributes('aria-label')).toBe(
      'Select Other: Axial 1'
    );
    expect(wrapper.text()).toContain('0 of 1 selected');
    expect(
      actionLabelled(wrapper, /^Delete selected/)
        .get('button')
        .attributes('disabled')
    ).toBeDefined();
  });

  it('shows a cine ruler with a one-based frame caption and its measured length', () => {
    drawRuler(useSegmentStore().segments.mintSegment({ name: 'Tumor' }), {
      frame: 7,
      firstPoint: [0, 0, 0],
      secondPoint: [3, 4, 0],
    });

    const row = mountList().get('[data-testid="segment-shape-row"]');
    expect(row.get('.row-subtitle').text()).toBe('Frame 8 5.00mm');
    expect(
      row.get('[data-testid="reveal-shape-button"]').attributes('aria-label')
    ).toBe('Reveal frame for Tumor: Frame 8');
  });

  it('reassigns only the measurement whose segment picker is used', async () => {
    const registry = useSegmentStore().segments;
    const first = registry.mintSegment({ name: 'Tumor' });
    registry.mintSegment({ name: 'Node' });
    drawRuler(first);
    drawRuler(first);
    const wrapper = mountList();
    const rows = wrapper.findAll('[data-testid="segment-shape-row"]');
    const choices = rows[1]
      .findAll('.row-title')
      .filter((title) => title.text() === 'Node');
    expect(choices).toHaveLength(1);
    await choices[0].trigger('click');
    expect(
      rows.map((row) =>
        row.get('.segment-picker-button').attributes('aria-label')
      )
    ).toEqual([
      'Change segment for Tumor: Axial 1',
      'Change segment for Node: Axial 1',
    ]);
  });
});
