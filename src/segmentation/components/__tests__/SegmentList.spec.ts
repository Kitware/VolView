import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  type Index3,
  maskOn,
  lockSegment,
  seedVoxel,
  seatImage,
  showImage,
  mintSegment,
  seatSpecImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { defineComponent, nextTick } from 'vue';
import { enableAutoUnmount, mount, VueWrapper } from '@vue/test-utils';

import SegmentList from '@/src/segmentation/components/SegmentList.vue';
import { messageTitles } from '@/src/components/__tests__/messageDisplay';
import useLoadDataStore from '@/src/store/load-data';
import { useSegmentStore } from '@/src/segmentation/segments';
import { DEFAULT_SEGMENTATION_DISPLAY } from '@/src/segmentation/model';
import { seatCineImage } from '@/src/core/cine/__tests__/cineFixtures';
import { useRulerStore } from '@/src/store/tools/rulers';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';

enableAutoUnmount(afterEach);

const segments = () => useSegmentStore().segments;

const makeMask = (imageId: string, name: string) => {
  const segmentId = segments().mintSegment({ name });
  const record = maskOn(imageId, segmentId);
  return { segmentId, maskId: record.id };
};

const makeSegment = (name: string) => segments().mintSegment({ name });

// Slots expose row controls without mounting the Vuetify list.
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

const SaveDialogStub = defineComponent({
  name: 'SaveSegmentationDialog',
  props: ['id'],
  emits: ['done'],
  template: '<div class="save-dialog-body" />',
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
    SaveSegmentationDialog: SaveDialogStub,
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
    await showImage('img-1');
  });

  it('lists the registry in creation order, keyed by segment id', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([first.segmentId, second.segmentId]);
    expect(
      itemList(wrapper)
        .props('items')
        .map((item: { name: string }) => item.name)
    ).toEqual(['Tumor', 'Node']);
  });

  it('lists a segment that has no voxels yet', async () => {
    const unbound = makeMask('img-1', 'Tumor');
    expect(
      store().getMask(unbound.maskId).representations.labelmap
    ).toBeUndefined();

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([unbound.segmentId]);
  });

  it('offers a segment with no mask on this image', async () => {
    const onTwo = makeMask('img-2', 'Node');
    const everywhere = makeSegment('Tumor');

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([onTwo.segmentId, everywhere]);
  });

  it('keeps the same rows when the viewed image changes', async () => {
    const onOne = makeMask('img-1', 'Tumor');
    const onTwo = makeMask('img-2', 'Node');

    const wrapper = mountList();
    await nextTick();
    expect(rowIds(wrapper)).toEqual([onOne.segmentId, onTwo.segmentId]);

    await showImage('img-2');

    expect(rowIds(wrapper)).toEqual([onOne.segmentId, onTwo.segmentId]);
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

    await showImage('img-1');

    expect(wrapper.find('[data-testid="segment-list"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('No selected image');
  });
});

describe('flat segment list selection', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await showImage('img-1');
  });

  it('marks the selected segment as the selected row', async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    segments().selectSegment(second.segmentId);

    const wrapper = mountList();
    await nextTick();

    expect(selectedRow(wrapper)).toBe(second.segmentId);
  });

  it('marks the first row selected while no segment has been chosen', async () => {
    const first = makeMask('img-1', 'Tumor');
    makeMask('img-1', 'Node');

    const wrapper = mountList();
    await nextTick();

    expect(selectedRow(wrapper)).toBe(first.segmentId);
  });

  it('keeps the selected row when the list picks nothing', async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    segments().selectSegment(second.segmentId);
    const wrapper = mountList();
    await nextTick();

    itemList(wrapper).vm.$emit('update:model-value', null);
    await nextTick();

    expect(selectedRow(wrapper)).toBe(second.segmentId);
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
    await showImage('img-2');

    const wrapper = mountList();
    await nextTick();

    expect(selectedRow(wrapper)).toBe(onOne.segmentId);
  });
});

describe('flat segment list row creation', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await showImage('img-1');
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
    await showImage('img-2');

    expect(rowIds(wrapper)).toHaveLength(2);
  });
});

describe('flat segment list row actions', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await showImage('img-1');
  });

  it("toggles one segment's visibility by id", async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, second.segmentId, [
      'mdi-eye',
      'mdi-eye-off',
    ]).trigger('click');

    expect(eyeOf(wrapper, second.segmentId)).toBe('mdi-eye-off');
    expect(eyeOf(wrapper, first.segmentId)).toBe('mdi-eye');
  });

  it("toggles one segment's lock by id", async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, second.segmentId, [
      'mdi-lock',
      'mdi-lock-open',
    ]).trigger('click');

    expect(lockOf(wrapper, second.segmentId)).toBe('mdi-lock');
    expect(lockOf(wrapper, first.segmentId)).toBe('mdi-lock-open');
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
    const wrapper = mountListWithTooltips();
    await nextTick();

    expect(lockTooltip(wrapper, segment.segmentId)).toMatch(/^Lock\b/);
    expect(lockTooltip(wrapper, segment.segmentId)).toMatch(/goes around it/i);

    lockSegment(segment.maskId, true);
    await nextTick();

    expect(lockTooltip(wrapper, segment.segmentId)).toMatch(/^Unlock\b/);
    expect(lockTooltip(wrapper, segment.segmentId)).toMatch(
      /replaces its voxels/i
    );
  });

  it('deletes one segment by id', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, first.segmentId, ['mdi-delete']).trigger('click');
    await nextTick();

    expect(rowIds(wrapper)).toEqual([second.segmentId]);
  });

  it('offers visibility and lock on every row, mask here or not', async () => {
    const withMask = makeMask('img-1', 'Tumor');
    const withoutMask = makeSegment('Elsewhere');
    const wrapper = mountList();
    await nextTick();

    // Both describe the segment, so they hold on every image and are offered on
    // a row this image has painted nothing for.
    [withMask.segmentId, withoutMask].forEach((id) => {
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

    [first.segmentId, second.segmentId, elsewhere.segmentId].forEach((id) =>
      expect(eyeOf(wrapper, id)).toBe('mdi-eye-off')
    );
    await showImage('img-2');
    expect(eyeOf(wrapper, elsewhere.segmentId)).toBe('mdi-eye-off');
  });
});

describe('flat segment list row editing', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await showImage('img-1');
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

  it("renames the row's segment by id, keeping that id", async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = await openEditor(second.segmentId);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(rowShown(wrapper, second.segmentId).name).toBe('Lesion');
  });

  it("recolors the row's segment by id", async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.segmentId);

    editor(wrapper).vm.$emit('update:color', '#0000ff');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(rowShown(wrapper, segment.segmentId).color).toBe('#0000ff');
  });

  it("edits the segment's fill opacity, outline opacity and stroke width", async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.segmentId);

    expect(editor(wrapper).props('fillOpacity')).toBe(1);
    expect(editor(wrapper).props('outlineOpacity')).toBe(1);

    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('update:outlineOpacity', 0.25);
    editor(wrapper).vm.$emit('update:strokeWidth', 3);
    editor(wrapper).vm.$emit('done');
    await nextTick();
    await reopenEditor(wrapper, segment.segmentId);

    expect(editor(wrapper).props()).toMatchObject({
      fillOpacity: 0.5,
      outlineOpacity: 0.25,
      strokeWidth: 3,
    });
  });

  it('discards the edit when the dialog is cancelled', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.segmentId);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('cancel');
    await nextTick();
    await reopenEditor(wrapper, segment.segmentId);

    expect(rowShown(wrapper, segment.segmentId).name).toBe('Tumor');
    expect(editor(wrapper).props()).toMatchObject({
      name: 'Tumor',
      fillOpacity: 1,
    });
  });

  it("offers the other rows' names as taken", async () => {
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = await openEditor(second.segmentId);

    expect([...editor(wrapper).props('invalidNames')]).toEqual(['Tumor']);
  });

  it('passes the unedited name to the editor', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.segmentId);

    expect(editor(wrapper).props('original')).toBe('Tumor');
  });
});

// Cine annotations use registry identities without requiring voxel storage.
describe('flat segment list on a cine image', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    seatCineImage('cine-1');
    await showImage('cine-1');
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

  it("keeps an empty segment's reveal disabled", async () => {
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
    await showImage('img-1');
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

    expect(
      ['Fill Opacity', 'Outline Opacity', 'Outline Thickness'].map((label) =>
        slider(wrapper, label).attributes('data-value')
      )
    ).toEqual(
      [
        DEFAULT_SEGMENTATION_DISPLAY.fillOpacity,
        DEFAULT_SEGMENTATION_DISPLAY.outlineOpacity,
        DEFAULT_SEGMENTATION_DISPLAY.outlineThickness,
      ].map(String)
    );
  });

  it('keeps a change made before the image has a segmentation', async () => {
    const wrapper = mountList();

    await setSlider(wrapper, 'Fill Opacity', 0.25);

    expect(slider(wrapper, 'Fill Opacity').attributes('data-value')).toBe(
      '0.25'
    );
  });

  it("seats each control at the segmentation's current value", async () => {
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
    "writes %s onto the viewed image's segmentation",
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

  it("writes only the viewed image's segmentation", async () => {
    await seatSpecImage('img-2', 'MR');
    const first = store().ensureSegmentationForImage('img-1');
    store().createMask(first.id, segments().mintSegment({ name: 'Tumor' }));
    const second = store().ensureSegmentationForImage('img-2');
    store().createMask(second.id, segments().mintSegment({ name: 'Node' }));
    const wrapper = mountList();
    await nextTick();

    await setSlider(wrapper, 'Fill Opacity', 0.25);
    await showImage('img-2');

    expect(slider(wrapper, 'Fill Opacity').attributes('data-value')).toBe(
      String(DEFAULT_SEGMENTATION_DISPLAY.fillOpacity)
    );
    await showImage('img-1');
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
    await showImage('img-1');
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
      revealButton(wrapper, segment.segmentId).attributes('disabled')
    ).toBeDefined();
  });

  it('does not call a row empty while a load is still running', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = mountListWithTooltips();
    const list = () => wrapper.find('[data-testid="segment-list"]');
    const reason = () =>
      revealButton(wrapper, segment.segmentId).element.parentElement
        ?.textContent;

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
      revealButton(wrapper, segment.segmentId).element.parentElement
        ?.textContent
    ).toMatch(/nothing on this image/i);
  });

  it('hands the reveal the slices the segment marks, not its padded allocation', async () => {
    const segment = makeMask('img-1', 'Tumor');
    paintVoxel(segment.maskId, [1, 1, 1]);
    paintVoxel(segment.maskId, [2, 1, 6]);
    const reveal = vi.fn();
    const wrapper = mountList({ reveal });
    await nextTick();

    await revealButton(wrapper, segment.segmentId).trigger('click');

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

  it('offers reveal for a segment that only has annotations, at their slices', async () => {
    const shaped = makeSegment('Shaped');
    useRulerStore().addTool({
      imageID: 'img-1',
      segmentId: shaped,
      slice: 3,
      frameOfReference: AXIAL_FRAME_OF_REFERENCE,
    });
    const reveal = vi.fn();
    const wrapper = mountList({ reveal });
    await nextTick();

    await revealButton(wrapper, shaped).trigger('click');

    expect(reveal.mock.calls).toEqual([
      [
        'img-1',
        {
          paintedSlicesByIJK: undefined,
          slicesByAxis: { Axial: [3] },
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
      revealButton(wrapper, segment.segmentId).attributes('disabled')
    ).toBeDefined();

    paintVoxel(segment.maskId, [1, 1, 1]);
    await nextTick();
    expect(
      revealButton(wrapper, segment.segmentId).attributes('disabled')
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

    await revealButton(wrapper, segment.segmentId).trigger('click');

    expect(reveal.mock.calls).toEqual([
      [
        'img-1',
        { paintedSlicesByIJK: undefined, slicesByAxis: {}, frames: [] },
      ],
    ]);
  });
});

describe('locked segment editor routes', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await showImage('img-1');
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
      await showImage(imageID);
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

describe('deleting a segment says what went with it', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    await showImage('img-1');
  });

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

    expect(messageTitles()).toEqual([
      'Deleted 2 masks on 2 images and 2 annotations',
    ]);
  });

  it('says one of each in the singular', async () => {
    const segmentId = spreadSegment(['img-2']);
    const wrapper = mountList();
    await nextTick();

    await deleteRow(wrapper, segmentId);

    expect(messageTitles()).toEqual([
      'Deleted 1 mask on 1 image and 1 annotation',
    ]);
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

    await deleteRow(wrapper, painted.segmentId);
    await deleteRow(wrapper, shaped);

    expect(messageTitles()).toEqual([
      'Deleted 1 mask on 1 image',
      'Deleted 1 annotation',
    ]);
  });

  // A record is minted the moment a segment is resolved as an edit target, so
  // an image can hold one for a segment that was never painted there. Deleting
  // drops the record, but there was nothing on that image to lose.
  it('counts no mask on an image the segment was only resolved on', async () => {
    const recorded = makeMask('img-1', 'Resolved');
    const allocated = maskOn('img-2', recorded.segmentId);
    store().maskVoxels(allocated.id).materialize();
    const wrapper = mountList();
    await nextTick();

    await deleteRow(wrapper, recorded.segmentId);

    expect(rowIds(wrapper)).toEqual([]);
    expect(messageTitles()).toEqual([]);
  });

  it('stays quiet when the segment held nothing', async () => {
    const empty = makeSegment('Empty');
    const wrapper = mountList();
    await nextTick();

    await deleteRow(wrapper, empty);

    expect(rowIds(wrapper)).toEqual([]);
    expect(messageTitles()).toEqual([]);
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
    expect(messageTitles()).toEqual([
      'Deleted 2 masks on 2 images and 2 annotations',
    ]);
  });
});

describe('segment row identity', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await showImage('img-1');
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
    expect(after.map((row) => row.id)).toEqual([
      first.segmentId,
      second.segmentId,
    ]);
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
});

const saveButton = (wrapper: VueWrapper) =>
  wrapper.find('[data-testid="save-segments-button"]');

const saveDialog = (wrapper: VueWrapper) =>
  wrapper.findComponent(SaveDialogStub);

const paintMask = (imageId: string, name: string) => {
  const segmentation = store().ensureSegmentationForImage(imageId);
  const mask = store().createMask(segmentation.id, mintSegment({ name }));
  seedVoxel(mask.id, [1, 1, 0]);
  return segmentation;
};

describe('saving from the flat segment panel', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
    await seatSpecImage('img-2', 'MR');
    await showImage('img-1');
  });

  it('offers the save affordance disabled, saying why, until something is painted', async () => {
    const wrapper = mountListWithTooltips();
    await nextTick();

    expect(saveButton(wrapper).exists()).toBe(true);
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Nothing is painted on this image yet');
  });

  it('offers one save affordance once the viewed image has segments', async () => {
    paintMask('img-1', 'Tumor');
    const wrapper = mountListWithTooltips();
    await nextTick();

    expect(
      wrapper.findAll('[data-testid="save-segments-button"]')
    ).toHaveLength(1);
  });

  // A segment resolved as an edit target mints a record, and allocating its
  // storage does not put a voxel in it: neither is anything to write out.
  it('keeps the save affordance disabled for masks that hold nothing', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createMask(segmentation.id, mintSegment({ name: 'Resolved' }));
    const allocated = store().createMask(
      segmentation.id,
      mintSegment({ name: 'Allocated' })
    );
    store().maskVoxels(allocated.id).materialize();
    const wrapper = mountListWithTooltips();
    await nextTick();

    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Nothing is painted on this image yet');
  });

  it('opens the save dialog on the viewed image segmentation', async () => {
    const segmentation = paintMask('img-1', 'Tumor');
    const wrapper = mountListWithTooltips();
    await nextTick();

    expect(saveDialog(wrapper).exists()).toBe(false);
    expect(saveButton(wrapper).exists()).toBe(true);

    await saveButton(wrapper).trigger('click');
    await nextTick();

    expect(saveDialog(wrapper).props('id')).toBe(segmentation.id);
  });

  // The create affordance names the row it adds, and it reads as an expression
  // rather than a literal attribute, so the source scan below cannot see it.
  it('names what the create affordance adds without a storage word', async () => {
    const wrapper = mountListWithTooltips();
    await nextTick();

    expect(wrapper.findComponent(ItemListStub).props('createText')).toBe(
      'New segment'
    );
  });

  it('follows the viewed image rather than the selected segment', async () => {
    const first = paintMask('img-1', 'Tumor');
    const second = store().ensureSegmentationForImage('img-2');
    const onSecond = store().createMask(
      second.id,
      mintSegment({ name: 'Node' })
    );
    // The selected segment has its mask on the image that is NOT being viewed.
    useSegmentStore().segments.selectSegment(onSecond.segmentId);
    const wrapper = mountListWithTooltips();
    await nextTick();

    expect(saveButton(wrapper).exists()).toBe(true);
    await saveButton(wrapper).trigger('click');
    await nextTick();

    expect(saveDialog(wrapper).props('id')).toBe(first.id);
  });
});
