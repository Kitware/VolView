import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  type Index3,
  maskOn,
  lockSegment,
  seedVoxel,
  seatImage,
  seatSpecImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { defineComponent, nextTick, ref } from 'vue';
import { enableAutoUnmount, mount, VueWrapper } from '@vue/test-utils';

import SegmentList from '@/src/segmentation/components/SegmentList.vue';
import { useMessageStore } from '@/src/store/messages';
import useLoadDataStore from '@/src/store/load-data';
import { useSegmentStore } from '@/src/segmentation/segments';
import { DEFAULT_SEGMENTATION_FILL_OPACITY } from '@/src/segmentation/model';
import { useViewStore } from '@/src/store/views';
import { seatCineImage } from '@/src/core/cine/__tests__/cineFixtures';
import {
  useCurrentTools,
  usePlacingAnnotationTool,
} from '@/src/composables/annotationTool';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';

enableAutoUnmount(afterEach);

// ---------------------------------------------------------------------------
// One flat list of segments: rows are the shared registry's segments, keyed
// on segment id, offered whether or not this image has a mask for them. The
// visibility and lock controls belong to the shared segment, and the
// display sliders to the viewed image's segmentation.
// ---------------------------------------------------------------------------

const segments = () => useSegmentStore().segments;

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const makeMask = (imageId: string, name: string) => {
  const segmentId = segments().mintSegment({ name });
  const record = maskOn(imageId, segmentId);
  return { id: segmentId, segmentId, maskId: record.id, record };
};

const makeSegment = (name: string) => segments().mintSegment({ name });

// The item list stands in for the real one so the per-row slot renders without
// Vuetify: rows carry their segment id, and the row buttons keep the icon names
// the list uses today.
const ItemListStub = defineComponent({
  name: 'EditableItemList',
  props: ['items', 'modelValue', 'createText'],
  emits: ['update:model-value', 'create', 'select', 'edit'],
  template: `
    <div class="item-list">
      <div
        v-for="item in items"
        :key="item.id"
        class="item-row"
        :data-id="item.id"
      >
        <slot name="item-prepend" :key="item.id" :item="item" />
        <slot name="item-append" :key="item.id" :item="item" />
      </div>
      <button class="create-row" @click="$emit('create')" />
    </div>
  `,
});

const BtnStub = defineComponent({
  name: 'VBtn',
  props: ['icon', 'disabled'],
  template: `<button :data-icon="icon" :disabled="disabled || undefined"><slot name="prepend" /><slot /></button>`,
});

const IconStub = defineComponent({
  name: 'VIcon',
  template: `<i class="icon"><slot /></i>`,
});

const SegmentEditorStub = defineComponent({
  name: 'SegmentEditor',
  props: [
    'name',
    'original',
    'color',
    'fillOpacity',
    'outlineOpacity',
    'strokeWidth',
    'invalidNames',
    'locked',
  ],
  emits: [
    'done',
    'cancel',
    'delete',
    'update:name',
    'update:color',
    'update:fillOpacity',
    'update:outlineOpacity',
    'update:strokeWidth',
  ],
  template: `<div class="segment-editor" />`,
});

// Sliders are found by the name their thumbs announce.
const SliderStub = defineComponent({
  name: 'VSlider',
  props: ['name', 'modelValue', 'min', 'max', 'step', 'disabled'],
  emits: ['update:modelValue'],
  template: `<input
    class="slider"
    :disabled="disabled || undefined"
    :data-name="name"
    :data-value="modelValue"
    :data-min="min"
    :data-max="max"
    :data-step="step"
  />`,
});

const globalOptions = {
  stubs: {
    VSlider: SliderStub,
    VExpansionPanels: { template: '<div><slot /></div>' },
    VExpansionPanel: { template: '<div><slot /></div>' },
    VExpansionPanelTitle: { template: '<button><slot /></button>' },
    VExpansionPanelText: { template: '<div><slot /></div>' },
    EditableItemList: ItemListStub,
    SegmentEditor: SegmentEditorStub,
    IsolatedDialog: { template: '<div class="dialog"><slot /></div>' },
    CloseableDialog: {
      props: ['modelValue'],
      template:
        '<div v-if="modelValue" class="dialog"><slot :close="() => {}" /></div>',
    },
    SaveSegmentationDialog: { props: ['id'], template: '<div />' },
    VBtn: BtnStub,
    VIcon: IconStub,
    VSpacer: { template: '<span />' },
    VTooltip: { template: '<span />' },
  },
};

const mountList = (props: { reveal?: () => void } = {}) =>
  mount(SegmentList, { props, global: globalOptions });

const mountListWithTooltips = () =>
  mount(SegmentList, {
    global: {
      stubs: {
        ...globalOptions.stubs,
        VTooltip: { template: '<span class="tooltip"><slot /></span>' },
      },
    },
  });

const itemList = (wrapper: VueWrapper) => wrapper.findComponent(ItemListStub);

const selectedRow = (wrapper: VueWrapper) =>
  itemList(wrapper).props('modelValue');

// The fields the list hands the item list to draw a row with.
const rowShown = (wrapper: VueWrapper, id: string) => {
  const items = itemList(wrapper).props('items') as Array<{
    id: string;
    name: string;
    color: string;
  }>;
  const row = items.find((item) => item.id === id);
  if (!row) throw new Error(`No row for segment ${id}`);
  return row;
};

const rowIds = (wrapper: VueWrapper) =>
  wrapper.findAll('.item-row').map((row) => row.attributes('data-id'));

const rowButton = (wrapper: VueWrapper, id: string, icons: string[]) => {
  const row = wrapper.find(`[data-id="${id}"]`);
  if (!row.exists()) throw new Error(`No row for segment ${id}`);
  const button = row
    .findAll('button')
    .find((candidate) =>
      icons.includes(
        candidate.attributes('data-icon') || candidate.text().trim()
      )
    );
  if (!button) throw new Error(`No ${icons.join('/')} button on row ${id}`);
  return button;
};

const eyeOf = (wrapper: VueWrapper, id: string) =>
  rowButton(wrapper, id, ['mdi-eye', 'mdi-eye-off']).text();

const lockOf = (wrapper: VueWrapper, id: string) =>
  rowButton(wrapper, id, ['mdi-lock', 'mdi-lock-open']).text();

const editor = (wrapper: VueWrapper) =>
  wrapper.findComponent(SegmentEditorStub);

// Reveal carries its icon in the slot beside its tooltip, so the icon-name
// lookup the other row buttons use does not reach it.
const revealButton = (wrapper: VueWrapper, id: string) => {
  const button = wrapper.find(
    `[data-id="${id}"] [data-testid="reveal-segment-button"]`
  );
  if (!button.exists()) throw new Error(`No reveal button on row ${id}`);
  return button;
};

describe('flat segment list', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await viewImage('img-1');
  });

  it('lists the registry in creation order, keyed by segment id', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([first.id, second.id]);
    expect(
      itemList(wrapper)
        .props('items')
        .map((item: { name: string }) => item.name)
    ).toEqual(['Tumor', 'Node']);
  });

  it('lists a segment that has no voxels yet', async () => {
    const unbound = makeMask('img-1', 'Tumor');
    expect(unbound.record.representations.labelmap).toBeUndefined();

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([unbound.id]);
  });

  it('offers a segment with no mask on this image', async () => {
    const onTwo = makeMask('img-2', 'Node');
    const everywhere = makeSegment('Tumor');

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([onTwo.id, everywhere]);
  });

  it('keeps the same rows when the viewed image changes', async () => {
    const onOne = makeMask('img-1', 'Tumor');
    const onTwo = makeMask('img-2', 'Node');

    const wrapper = mountList();
    await nextTick();
    expect(rowIds(wrapper)).toEqual([onOne.id, onTwo.id]);

    await viewImage('img-2');

    expect(rowIds(wrapper)).toEqual([onOne.id, onTwo.id]);
  });
});

describe('flat segment list with no viewed image', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
  });

  it('offers no list and no toggles until an image is viewed', async () => {
    const wrapper = mountList();
    await nextTick();

    expect(wrapper.find('[data-testid="segment-list"]').exists()).toBe(false);
    expect(wrapper.findAll('button')).toEqual([]);
    expect(wrapper.text()).toContain('No selected image');
  });

  it('renders the list once an image is viewed', async () => {
    const wrapper = mountList();
    await nextTick();

    await viewImage('img-1');

    expect(wrapper.find('[data-testid="segment-list"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('No selected image');
  });
});

describe('flat segment list selection', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await viewImage('img-1');
  });

  it('marks the selected segment as the selected row', async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    segments().selectSegment(second.segmentId);

    const wrapper = mountList();
    await nextTick();

    expect(itemList(wrapper).props('modelValue')).toBe(second.segmentId);
  });

  it('marks the first row selected while no segment has been chosen', async () => {
    const first = makeMask('img-1', 'Tumor');
    makeMask('img-1', 'Node');

    const wrapper = mountList();
    await nextTick();

    expect(itemList(wrapper).props('modelValue')).toBe(first.segmentId);
  });

  it('keeps the selected row when the list picks nothing', async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    segments().selectSegment(second.segmentId);
    const wrapper = mountList();
    await nextTick();

    itemList(wrapper).vm.$emit('update:model-value', null);
    await nextTick();

    expect(itemList(wrapper).props('modelValue')).toBe(second.segmentId);
  });

  it('selects a segment by id when a row is picked', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    segments().selectSegment(first.segmentId);
    const wrapper = mountList();
    await nextTick();

    itemList(wrapper).vm.$emit('update:model-value', second.segmentId);
    await nextTick();

    expect(selectedRow(wrapper)).toBe(second.segmentId);
  });

  it('keeps the selected row on an image the segment has no mask on', async () => {
    const onOne = makeMask('img-1', 'Tumor');
    segments().selectSegment(onOne.segmentId);
    await viewImage('img-2');

    const wrapper = mountList();
    await nextTick();

    expect(itemList(wrapper).props('modelValue')).toBe(onOne.segmentId);
  });
});

describe('flat segment list row creation', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await viewImage('img-1');
  });

  it('adds a row', async () => {
    const wrapper = mountList();
    await nextTick();

    itemList(wrapper).vm.$emit('create');
    await nextTick();

    expect(rowIds(wrapper)).toHaveLength(1);
  });

  it('selects the row it adds', async () => {
    segments().selectSegment(makeSegment('Tumor'));
    const wrapper = mountList();
    await nextTick();

    itemList(wrapper).vm.$emit('create');
    await nextTick();

    expect(selectedRow(wrapper)).toBe(rowIds(wrapper)[1]);
  });

  it('adds the row for every image at once', async () => {
    await seatSpecImage('img-2');
    makeMask('img-2', 'Elsewhere');
    const wrapper = mountList();
    await nextTick();

    itemList(wrapper).vm.$emit('create');
    await nextTick();
    await viewImage('img-2');

    expect(rowIds(wrapper)).toHaveLength(2);
  });
});

describe('flat segment list row actions', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await viewImage('img-1');
  });

  it('toggles one segment’s visibility by id', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, second.id, ['mdi-eye', 'mdi-eye-off']).trigger(
      'click'
    );

    expect(eyeOf(wrapper, second.id)).toBe('mdi-eye-off');
    expect(eyeOf(wrapper, first.id)).toBe('mdi-eye');
  });

  it('toggles one segment’s lock by id', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, second.id, ['mdi-lock', 'mdi-lock-open']).trigger(
      'click'
    );

    expect(lockOf(wrapper, second.id)).toBe('mdi-lock');
    expect(lockOf(wrapper, first.id)).toBe('mdi-lock-open');
  });

  // The tooltip is the only place the panel can say what locking does, and the
  // shared stub drops its content, so this mounts one that renders it.
  const mountWithTooltips = () =>
    mount(SegmentList, {
      global: {
        stubs: {
          ...globalOptions.stubs,
          VTooltip: { template: '<span class="tooltip"><slot /></span>' },
        },
      },
    });

  const lockTooltip = (wrapper: VueWrapper, id: string) => {
    const button = wrapper
      .find(`[data-id="${id}"]`)
      .findAll('button')
      .find((candidate) =>
        candidate
          .findAll('i.icon')
          .some((icon) => icon.text().trim().startsWith('mdi-lock'))
      );
    if (!button) throw new Error(`No lock button on row ${id}`);
    return button.find('.tooltip').text();
  };

  it('says on the lock that other segments paint around it', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = mountWithTooltips();
    await nextTick();

    expect(lockTooltip(wrapper, segment.id)).toMatch(/^Lock\b/);
    expect(lockTooltip(wrapper, segment.id)).toMatch(/goes around it/i);

    lockSegment(segment.maskId, true);
    await nextTick();

    expect(lockTooltip(wrapper, segment.id)).toMatch(/^Unlock\b/);
    expect(lockTooltip(wrapper, segment.id)).toMatch(/takes its voxels/i);
  });

  it('deletes one segment by id', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, first.id, ['mdi-delete']).trigger('click');
    await nextTick();

    expect(rowIds(wrapper)).toEqual([second.id]);
  });

  it('offers visibility and lock on every row, mask here or not', async () => {
    const withMask = makeMask('img-1', 'Tumor');
    const withoutMask = makeSegment('Elsewhere');
    const wrapper = mountList();
    await nextTick();

    // Both describe the segment, so they hold on every image and are offered on
    // a row this image has painted nothing for.
    [withMask.id, withoutMask].forEach((id) => {
      expect(rowButton(wrapper, id, ['mdi-eye', 'mdi-eye-off']).exists()).toBe(
        true
      );
      expect(
        rowButton(wrapper, id, ['mdi-lock', 'mdi-lock-open']).exists()
      ).toBe(true);
    });

    await rowButton(wrapper, withoutMask, ['mdi-eye', 'mdi-eye-off']).trigger(
      'click'
    );

    expect(eyeOf(wrapper, withoutMask)).toBe('mdi-eye-off');
  });

  it('offers the header toggles disabled, saying why, while no segment exists', async () => {
    const wrapper = mountListWithTooltips();
    await nextTick();
    const lock = () =>
      wrapper.get('[data-testid="toggle-segments-locked-button"]');
    const eye = () =>
      wrapper.get('[data-testid="toggle-segments-visible-button"]');

    [lock(), eye()].forEach((button) => {
      expect(button.attributes('disabled')).toBeDefined();
      expect(button.element.parentElement?.textContent).toMatch(
        /no segments yet/i
      );
    });
    expect(lock().text()).toBe('mdi-lock-open');
    expect(eye().text()).toBe('mdi-eye');

    makeSegment('Tumor');
    await nextTick();

    [lock(), eye()].forEach((button) => {
      expect(button.attributes('disabled')).toBeUndefined();
      expect(button.element.parentElement?.textContent).toMatch(
        /every segment/i
      );
    });
  });

  it('hides every segment at once, on every image', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    await seatSpecImage('img-2');
    const elsewhere = makeMask('img-2', 'Elsewhere');
    const wrapper = mountList();
    await nextTick();

    await wrapper
      .find('[data-testid="toggle-segments-visible-button"]')
      .trigger('click');

    [first.id, second.id, elsewhere.id].forEach((id) =>
      expect(eyeOf(wrapper, id)).toBe('mdi-eye-off')
    );
    await viewImage('img-2');
    expect(eyeOf(wrapper, elsewhere.id)).toBe('mdi-eye-off');
  });
});

describe('flat segment list row editing', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await viewImage('img-1');
  });

  const reopenEditor = async (wrapper: VueWrapper, id: string) => {
    await rowButton(wrapper, id, ['mdi-pencil']).trigger('click');
    await nextTick();
  };

  const openEditor = async (id: string) => {
    const wrapper = mountList();
    await nextTick();
    await reopenEditor(wrapper, id);
    return wrapper;
  };

  it('renames the row’s segment by id, keeping that id', async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = await openEditor(second.id);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(rowShown(wrapper, second.id).name).toBe('Lesion');
  });

  it('recolors the row’s segment by id', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    editor(wrapper).vm.$emit('update:color', '#0000ff');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(rowShown(wrapper, segment.id).color).toBe('#0000ff');
  });

  it('edits the segment’s fill opacity, outline opacity and stroke width', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    expect(editor(wrapper).props('fillOpacity')).toBe(1);
    expect(editor(wrapper).props('outlineOpacity')).toBe(1);

    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('update:outlineOpacity', 0.25);
    editor(wrapper).vm.$emit('update:strokeWidth', 3);
    editor(wrapper).vm.$emit('done');
    await nextTick();
    await reopenEditor(wrapper, segment.id);

    expect(editor(wrapper).props()).toMatchObject({
      fillOpacity: 0.5,
      outlineOpacity: 0.25,
      strokeWidth: 3,
    });
  });

  it('discards the edit when the dialog is cancelled', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('cancel');
    await nextTick();
    await reopenEditor(wrapper, segment.id);

    expect(rowShown(wrapper, segment.id).name).toBe('Tumor');
    expect(editor(wrapper).props()).toMatchObject({
      name: 'Tumor',
      fillOpacity: 1,
    });
  });

  it('offers the other rows’ names as taken', async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = await openEditor(second.id);

    expect([...editor(wrapper).props('invalidNames')]).toEqual(['Tumor']);
  });

  it('passes the unedited name to the editor', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    expect(editor(wrapper).props('original')).toBe('Tumor');
  });
});

// Cine annotations use registry identities without requiring voxel storage.
describe('flat segment list on a cine image', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    seatCineImage('cine-1');
    await viewImage('cine-1');
  });

  it('creates and edits distinct measurement segments', async () => {
    const wrapper = mountList();
    for (const [name, color] of [
      ['Long axis', '#ff0000'],
      ['Short axis', '#0000ff'],
    ]) {
      await wrapper.get('.create-row').trigger('click');
      await rowButton(wrapper, selectedRow(wrapper), ['mdi-pencil']).trigger(
        'click'
      );
      editor(wrapper).vm.$emit('update:name', name);
      editor(wrapper).vm.$emit('update:color', color);
      editor(wrapper).vm.$emit('done');
      await nextTick();
    }

    expect(rowIds(wrapper).map((id) => rowShown(wrapper, id!))).toMatchObject([
      { name: 'Long axis', color: '#ff0000' },
      { name: 'Short axis', color: '#0000ff' },
    ]);
    expect(
      wrapper.get('[data-testid="save-segments-button"]').attributes('disabled')
    ).toBeDefined();
  });

  it.each([[1], [0, 1]])(
    'hands the reveal the cine frames annotated on %j',
    async (...frames) => {
      const segmentId = segments().addSegment({ name: 'Measurement' });
      frames.forEach((frame) =>
        useRulerStore().addTool({
          imageID: 'cine-1',
          segmentId,
          frame,
          slice: 0,
          frameOfReference: AXIAL_FRAME_OF_REFERENCE,
        })
      );
      const reveal = vi.fn();
      const wrapper = mountList({ reveal });

      expect(
        revealButton(wrapper, segmentId).attributes('disabled')
      ).toBeUndefined();
      await revealButton(wrapper, segmentId).trigger('click');

      expect(reveal.mock.calls).toEqual([
        ['cine-1', { paintedSlicesByIJK: undefined, slicesByAxis: {}, frames }],
      ]);
    }
  );

  it('offers the display controls disabled, saying why, on a clip', async () => {
    const wrapper = mountListWithTooltips();
    await nextTick();

    const sliders = wrapper.findAll('.slider');
    expect(sliders).toHaveLength(3);
    sliders.forEach((control) =>
      expect(control.attributes('disabled')).toBeDefined()
    );
    expect(wrapper.get('.display-controls').text()).toMatch(
      /a clip has no segmentation to display/i
    );
  });

  it('keeps an empty segment’s reveal disabled', async () => {
    const segmentId = segments().addSegment();
    const wrapper = mountList();
    expect(
      revealButton(wrapper, segmentId).attributes('disabled')
    ).toBeDefined();
  });
});

describe('segmentation display section', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await viewImage('img-1');
  });

  const slider = (wrapper: VueWrapper, label: string) => {
    const found = wrapper
      .findAllComponents(SliderStub)
      .find((candidate) => candidate.props('name') === label);
    if (!found) throw new Error(`No "${label}" slider`);
    return found;
  };

  const setSlider = async (
    wrapper: VueWrapper,
    label: string,
    value: number
  ) => {
    slider(wrapper, label).vm.$emit('update:modelValue', value);
    await nextTick();
  };

  it('places display controls before the segment list', () => {
    const wrapper = mountList();
    const sectionOrder = wrapper
      .findAll('[data-testid$="-section"]')
      .map((section) => section.attributes('data-testid'));

    expect(sectionOrder.indexOf('segment-display-section')).toBeLessThan(
      sectionOrder.indexOf('segments-section')
    );
  });

  it('offers the default display controls before the image has a segmentation', async () => {
    const wrapper = mountList();
    await nextTick();

    expect(slider(wrapper, 'Fill Opacity').attributes('data-value')).toBe(
      String(DEFAULT_SEGMENTATION_FILL_OPACITY)
    );
    expect(slider(wrapper, 'Outline Opacity').attributes('data-value')).toBe(
      '1'
    );
    expect(slider(wrapper, 'Outline Thickness').attributes('data-value')).toBe(
      '2'
    );
  });

  it('keeps a change made before the image has a segmentation', async () => {
    const wrapper = mountList();

    await setSlider(wrapper, 'Fill Opacity', 0.25);

    expect(slider(wrapper, 'Fill Opacity').attributes('data-value')).toBe(
      '0.25'
    );
  });

  it('seats each control at the segmentation’s current value', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createMask(
      segmentation.id,
      segments().mintSegment({ name: 'Tumor' })
    );
    store().updateSegmentationDisplay(segmentation.id, {
      fillOpacity: 0.4,
      outlineOpacity: 0.6,
      outlineThickness: 5,
    });

    const wrapper = mountList();
    await nextTick();

    expect(slider(wrapper, 'Fill Opacity').attributes('data-value')).toBe(
      '0.4'
    );
    expect(slider(wrapper, 'Outline Opacity').attributes('data-value')).toBe(
      '0.6'
    );
    expect(slider(wrapper, 'Outline Thickness').attributes('data-value')).toBe(
      '5'
    );
  });

  it.each([
    ['Fill Opacity', 0.25],
    ['Outline Opacity', 0.5],
    ['Outline Thickness', 4],
  ] as const)(
    'writes %s onto the viewed image’s segmentation',
    async (label, value) => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      store().createMask(
        segmentation.id,
        segments().mintSegment({ name: 'Tumor' })
      );
      const wrapper = mountList();
      await nextTick();

      await setSlider(wrapper, label, value);

      expect(slider(wrapper, label).attributes('data-value')).toBe(
        String(value)
      );
    }
  );

  it('writes only the viewed image’s segmentation', async () => {
    await seatSpecImage('img-2', 'MR');
    const first = store().ensureSegmentationForImage('img-1');
    store().createMask(first.id, segments().mintSegment({ name: 'Tumor' }));
    const second = store().ensureSegmentationForImage('img-2');
    store().createMask(second.id, segments().mintSegment({ name: 'Node' }));
    const wrapper = mountList();
    await nextTick();

    await setSlider(wrapper, 'Fill Opacity', 0.25);
    await viewImage('img-2');

    expect(slider(wrapper, 'Fill Opacity').attributes('data-value')).toBe(
      String(DEFAULT_SEGMENTATION_FILL_OPACITY)
    );
    await viewImage('img-1');
    expect(slider(wrapper, 'Fill Opacity').attributes('data-value')).toBe(
      '0.25'
    );
  });
});

// Reveal Slice is the only row control that reads the viewed image's storage,
// so it is the one that has to say when this image holds nothing for the row.
describe('Reveal Slice on a segment row', () => {
  const REVEAL_DIMENSIONS: Index3 = [4, 4, 8];

  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { name: 'CT', dimensions: REVEAL_DIMENSIONS });
    await viewImage('img-1');
  });

  // Padded like a stroke, so the allocation is wider than what is marked.
  const STROKE_PADDING = 16;

  const paintVoxel = (maskId: string, [i, j, k]: Index3) => {
    const voxels = store().maskVoxels(maskId);
    voxels.materialize();
    voxels.ensureContains([i, i, j, j, k, k], STROKE_PADDING);
    seedVoxel(maskId, [i, j, k]);
  };

  it('is offered disabled, saying why, on a row this image stores nothing for', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = mountList();
    await nextTick();

    expect(
      revealButton(wrapper, segment.id).attributes('disabled')
    ).toBeDefined();
  });

  it('does not call a row empty while a load is still running', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = mountListWithTooltips();
    const list = () => wrapper.find('[data-testid="segment-list"]');
    const reason = () =>
      revealButton(wrapper, segment.id).element.parentElement?.textContent;

    useLoadDataStore().startLoading();
    await nextTick();
    expect(list().attributes('aria-busy')).toBe('true');
    expect(reason()).toMatch(/still loading/i);

    useLoadDataStore().stopLoading();
    await nextTick();
    expect(list().attributes('aria-busy')).toBe('false');
    expect(reason()).toMatch(/nothing on this image/i);
  });

  it('says on the disabled control that this image holds nothing for the row', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = mountListWithTooltips();
    await nextTick();

    expect(
      revealButton(wrapper, segment.id).element.parentElement?.textContent
    ).toMatch(/nothing on this image/i);
  });

  it('hands the reveal the slices the segment marks, not its padded allocation', async () => {
    const segment = makeMask('img-1', 'Tumor');
    paintVoxel(segment.maskId, [1, 1, 1]);
    paintVoxel(segment.maskId, [2, 1, 6]);
    const reveal = vi.fn();
    const wrapper = mountList({ reveal });
    await nextTick();

    await revealButton(wrapper, segment.id).trigger('click');

    expect(reveal.mock.calls).toEqual([
      [
        'img-1',
        {
          paintedSlicesByIJK: [[1, 2], [1], [1, 6]],
          slicesByAxis: {},
          frames: [],
        },
      ],
    ]);
  });

  it('enables reveal when painting creates storage after the list mounts', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = mountList();
    await nextTick();
    expect(
      revealButton(wrapper, segment.id).attributes('disabled')
    ).toBeDefined();

    paintVoxel(segment.maskId, [1, 1, 1]);
    await nextTick();
    expect(
      revealButton(wrapper, segment.id).attributes('disabled')
    ).toBeUndefined();
  });

  it('hands the reveal no painted slices when the mask marks nothing', async () => {
    const segment = makeMask('img-1', 'Tumor');
    paintVoxel(segment.maskId, [1, 1, 6]);
    const voxels = store().maskVoxels(segment.maskId);
    voxels.scalars().fill(0);
    voxels.image().modified();
    const reveal = vi.fn();
    const wrapper = mountList({ reveal });
    await nextTick();

    await revealButton(wrapper, segment.id).trigger('click');

    expect(reveal.mock.calls).toEqual([
      [
        'img-1',
        { paintedSlicesByIJK: undefined, slicesByAxis: {}, frames: [] },
      ],
    ]);
  });
});

const ANNOTATION_STORES = [
  ['ruler', useRulerStore],
  ['rectangle', useRectangleStore],
  ['polygon', usePolygonStore],
] as const;

describe.each(ANNOTATION_STORES)(
  'shared segment visibility for a %s',
  (_name, useStore) => {
    beforeEach(async () => {
      setActivePinia(createPinia());
      await seatSpecImage('img-1');
      await viewImage('img-1');
    });

    it('composes row and global visibility with independent child flags across images and cine frames', async () => {
      const tools = useStore();
      const segmentId = segments().addSegment();
      const addShape = (imageID: string, hidden = false, frame?: number) =>
        tools.addTool({
          imageID,
          segmentId,
          slice: 0,
          frameOfReference: AXIAL_FRAME_OF_REFERENCE,
          hidden,
          frame,
        });
      const shown = addShape('img-1');
      addShape('img-1', true);
      seatCineImage('cine-1');
      const cineFirst = addShape('cine-1', false, 0);
      const cineSecond = addShape('cine-1', false, 1);
      const viewFrame = ref<number | undefined>();
      const rendered = useCurrentTools(tools, ref('Axial'), ref([]), viewFrame);
      const ids = () => rendered.value.map((tool) => tool.id);
      const wrapper = mountList();
      expect(ids()).toEqual([shown]);

      await rowButton(wrapper, segmentId, ['mdi-eye', 'mdi-eye-off']).trigger(
        'click'
      );
      expect(ids()).toEqual([]);
      await viewImage('cine-1');
      viewFrame.value = 0;
      expect(ids()).toEqual([]);
      await wrapper
        .get('[data-testid="toggle-segments-visible-button"]')
        .trigger('click');
      expect(ids()).toEqual([cineFirst]);
      viewFrame.value = 1;
      expect(ids()).toEqual([cineSecond]);
      await wrapper
        .get('[data-testid="toggle-segments-visible-button"]')
        .trigger('click');
      expect(ids()).toEqual([]);
      await rowButton(wrapper, segmentId, ['mdi-eye', 'mdi-eye-off']).trigger(
        'click'
      );
      await viewImage('img-1');
      viewFrame.value = undefined;
      expect(ids()).toEqual([shown]);
    });

    it('keeps the active placement alive through hiding, committing and starting again', () => {
      const tools = useStore();
      const segmentId = segments().addSegment();
      const metadata = ref({
        imageID: 'img-1',
        segmentId,
        slice: 0,
        frameOfReference: AXIAL_FRAME_OF_REFERENCE,
      });
      const placing = usePlacingAnnotationTool(tools, metadata);
      placing.add();
      const first = placing.id.value!;
      const whitelist = ref([first]);
      const rendered = useCurrentTools(tools, ref('Axial'), whitelist);
      const otherViewStub = tools.addTool({ ...metadata.value, placing: true });
      placing.beginPlacement();
      segments().updateSegment(segmentId, { visible: false });
      expect(rendered.value.map((tool) => tool.id)).toEqual([first]);
      expect(tools.toolByID[otherViewStub]).toBeDefined();

      placing.commit();
      expect(rendered.value).toEqual([]);
      expect(tools.toolByID[first].placing).toBe(false);
      placing.add();
      whitelist.value = [placing.id.value!];
      expect(rendered.value.map((tool) => tool.id)).toEqual([placing.id.value]);
      segments().updateSegment(segmentId, { visible: true });
      expect(rendered.value.map((tool) => tool.id)).toEqual([
        first,
        placing.id.value,
      ]);
      placing.remove();
      expect(rendered.value.map((tool) => tool.id)).toEqual([first]);
    });
  }
);

describe('locked segment editor routes', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await viewImage('img-1');
  });

  const protectedContent = () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    ['img-1', 'img-2'].forEach((imageID) => {
      seedVoxel(maskOn(imageID, segmentId).id, [1, 1, 0]);
      useRulerStore().addTool({
        imageID,
        segmentId,
        slice: 0,
        frameOfReference: AXIAL_FRAME_OF_REFERENCE,
      });
    });
    return segmentId;
  };

  // The row keeps its name and still reveals what it holds on both images.
  const expectPreserved = async (wrapper: VueWrapper, segmentId: string) => {
    for (const imageID of ['img-2', 'img-1']) {
      await viewImage(imageID);
      expect(rowShown(wrapper, segmentId).name).toBe('Tumor');
      expect(
        revealButton(wrapper, segmentId).attributes('disabled')
      ).toBeUndefined();
    }
  };

  it('disables color, edit and delete consistently and restores editing after unlocking', async () => {
    const segmentId = protectedContent();
    segments().updateSegment(segmentId, { locked: true });
    const wrapper = mountList();
    for (const action of [
      'segment-color-button',
      'edit-segment-button',
      'delete-segment-button',
    ]) {
      const button = wrapper.get(
        `[data-id="${segmentId}"] [data-testid="${action}"]`
      );
      expect(button.attributes('disabled')).toBeDefined();
      await button.trigger('click');
      expect(editor(wrapper).exists()).toBe(false);
      await expectPreserved(wrapper, segmentId);
    }
    segments().updateSegment(segmentId, { locked: false });
    await nextTick();
    await wrapper.get('[data-testid="segment-color-button"]').trigger('click');
    expect(editor(wrapper).exists()).toBe(true);
    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('done');
    await nextTick();
    expect(rowShown(wrapper, segmentId).name).toBe('Lesion');
  });

  it.each(['done', 'delete'])(
    'refuses %s if the segment becomes locked while its editor is open',
    async (action) => {
      const segmentId = protectedContent();
      const wrapper = mountList();
      await wrapper
        .get('[data-testid="segment-color-button"]')
        .trigger('click');
      editor(wrapper).vm.$emit('update:name', 'Changed');
      await nextTick();
      segments().updateSegment(segmentId, { locked: true });
      await nextTick();
      expect(editor(wrapper).props('locked')).toBe(true);
      editor(wrapper).vm.$emit(action);
      await nextTick();
      await expectPreserved(wrapper, segmentId);
    }
  );
});

// ---------------------------------------------------------------------------
// Deleting a segment cascades to its mask on every image and to every
// annotation naming it, none of which need be visible here, and there is no
// undo. No dialog asks first, as everywhere else in the app, so the list says
// afterwards what went, the way removeSelectedTools does.
// ---------------------------------------------------------------------------

describe('deleting a segment says what went with it', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await viewImage('img-1');
  });

  const titles = () =>
    useMessageStore().messages.map((message) => message.title);

  const spreadSegment = (imageIDs: string[], name = 'Tumor') => {
    const segmentId = segments().addSegment({ name });
    const rulers = useRulerStore();
    imageIDs.forEach((imageID) => {
      const mask = maskOn(imageID, segmentId);
      seedVoxel(mask.id, [1, 1, 0]);
      rulers.addTool({
        imageID,
        segmentId,
        slice: 0,
        frameOfReference: AXIAL_FRAME_OF_REFERENCE,
      });
    });
    return segmentId;
  };

  const deleteRow = async (wrapper: VueWrapper, id: string) => {
    await rowButton(wrapper, id, ['mdi-delete']).trigger('click');
    await nextTick();
  };

  it('counts the masks, the images they were on, and the annotations', async () => {
    const segmentId = spreadSegment(['img-1', 'img-2']);
    const wrapper = mountList();
    await nextTick();

    await deleteRow(wrapper, segmentId);

    expect(titles()).toEqual(['Deleted 2 masks on 2 images and 2 annotations']);
  });

  it('says one of each in the singular', async () => {
    const segmentId = spreadSegment(['img-2']);
    const wrapper = mountList();
    await nextTick();

    await deleteRow(wrapper, segmentId);

    expect(titles()).toEqual(['Deleted 1 mask on 1 image and 1 annotation']);
  });

  it('names only what the segment had', async () => {
    const painted = makeMask('img-1', 'Painted');
    seedVoxel(painted.maskId, [1, 1, 0]);
    const shaped = segments().addSegment({ name: 'Shaped' });
    useRulerStore().addTool({
      imageID: 'img-1',
      segmentId: shaped,
      slice: 0,
      frameOfReference: AXIAL_FRAME_OF_REFERENCE,
    });
    const wrapper = mountList();
    await nextTick();

    await deleteRow(wrapper, painted.id);
    await deleteRow(wrapper, shaped);

    expect(titles()).toEqual([
      'Deleted 1 mask on 1 image',
      'Deleted 1 annotation',
    ]);
  });

  // A record is minted the moment a segment is resolved as an edit target, so
  // an image can hold one for a segment that was never painted there. Deleting
  // drops the record, but there was nothing on that image to lose.
  it('counts no mask on an image the segment was only resolved on', async () => {
    const recorded = makeMask('img-1', 'Resolved');
    const allocated = maskOn('img-2', recorded.id);
    store().maskVoxels(allocated.id).materialize();
    const wrapper = mountList();
    await nextTick();

    await deleteRow(wrapper, recorded.id);

    expect(rowIds(wrapper)).toEqual([]);
    expect(titles()).toEqual([]);
  });

  it('stays quiet when the segment held nothing', async () => {
    const empty = makeSegment('Empty');
    const wrapper = mountList();
    await nextTick();

    await deleteRow(wrapper, empty);

    expect(rowIds(wrapper)).toEqual([]);
    expect(titles()).toEqual([]);
  });

  it('reports the same cascade when the editor deletes', async () => {
    const segmentId = spreadSegment(['img-1', 'img-2']);
    const wrapper = mountList();
    await nextTick();
    await wrapper
      .get(`[data-id="${segmentId}"] [data-testid="segment-color-button"]`)
      .trigger('click');

    editor(wrapper).vm.$emit('delete');
    await nextTick();

    expect(rowIds(wrapper)).toEqual([]);
    expect(titles()).toEqual(['Deleted 2 masks on 2 images and 2 annotations']);
  });
});

// ---------------------------------------------------------------------------
// A row is rebuilt from every annotation in the scene, and dragging one ruler
// is a store write per pointer move. The list hands back the row object it
// built last time when nothing the row shows has changed, so the item list's
// per-row memo holds and only the rows that changed re-render.
// ---------------------------------------------------------------------------

describe('segment row identity', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await viewImage('img-1');
  });

  const rulerOn = (segmentId: string, slice = 0) =>
    useRulerStore().addTool({
      imageID: 'img-1',
      segmentId,
      slice,
      frameOfReference: AXIAL_FRAME_OF_REFERENCE,
    });

  const rowsOf = (wrapper: VueWrapper) =>
    itemList(wrapper).props('items') as Array<{ id: string }>;

  it('keeps every row when an annotation moves', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const ruler = rulerOn(first.segmentId);
    const wrapper = mountList();
    await nextTick();
    const before = rowsOf(wrapper);

    useRulerStore().updateTool(ruler, { slice: 1 });
    await nextTick();

    const after = rowsOf(wrapper);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after.map((row) => row.id)).toEqual([first.id, second.id]);
  });

  it('replaces only the row whose annotation count changed', async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();
    const before = rowsOf(wrapper);

    rulerOn(second.segmentId);
    await nextTick();

    const after = rowsOf(wrapper);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('replaces only the row whose own fields changed', async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();
    const before = rowsOf(wrapper);

    segments().updateSegment(second.segmentId, { name: 'Lesion' });
    await nextTick();

    const after = rowsOf(wrapper);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('still offers reveal for a segment that only has annotations', async () => {
    const shaped = makeSegment('Shaped');
    rulerOn(shaped);
    const wrapper = mountList();
    await nextTick();

    expect(
      revealButton(wrapper, shaped).attributes('disabled')
    ).toBeUndefined();
  });
});
