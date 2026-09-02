import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import SegmentList from '@/src/components/SegmentList.vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useViewStore } from '@/src/store/views';
import { seatCineImage } from '@/src/core/cine/__tests__/cineFixtures';

// ---------------------------------------------------------------------------
// One flat segment list per image: rows are the viewed image's segments, keyed
// on segment id, and a row exists whether or not the segment has voxels yet.
// The list follows the viewed image, never the active segment's group, and
// adding a row allocates no storage.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();

async function seatImage(id: string, name = 'CT') {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS as unknown as [number, number, number]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(VOXEL_COUNT),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, name, { id });
  await nextTick();
  return id;
}

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const makeSegment = (imageId: string, name: string) => {
  const segmentation = store().ensureSegmentationForImage(imageId);
  return store().createSegment(segmentation.id, { name });
};

// The chip list stands in for the real one so the per-row slot renders without
// Vuetify: rows carry their segment id, and the row buttons keep the icon names
// the list uses today.
const ChipListStub = defineComponent({
  name: 'EditableChipList',
  props: [
    'items',
    'itemKey',
    'itemTitle',
    'modelValue',
    'createLabelText',
    'hideCreate',
  ],
  emits: ['update:model-value', 'create', 'select', 'edit'],
  template: `
    <div class="chip-list">
      <div
        v-for="item in items"
        :key="item.id"
        class="chip-row"
        :data-id="item.id"
      >
        <slot name="item-prepend" :key="item.id" :item="item" />
        <slot name="item-append" :key="item.id" :item="item" />
      </div>
      <button v-if="!hideCreate" class="create-chip" @click="$emit('create')" />
    </div>
  `,
});

const BtnStub = defineComponent({
  name: 'VBtn',
  props: ['icon'],
  template: `<button :data-icon="icon"><slot name="prepend" /><slot /></button>`,
});

const IconStub = defineComponent({
  name: 'VIcon',
  template: `<i class="icon"><slot /></i>`,
});

const SegmentEditorStub = defineComponent({
  name: 'SegmentEditor',
  props: ['name', 'color', 'fillOpacity', 'outlineOpacity', 'invalidNames'],
  emits: [
    'done',
    'cancel',
    'delete',
    'update:name',
    'update:color',
    'update:fillOpacity',
    'update:outlineOpacity',
  ],
  template: `<div class="segment-editor" />`,
});

// Sliders are found by the label the user reads.
const SliderStub = defineComponent({
  name: 'VSlider',
  props: ['label', 'modelValue', 'min', 'max', 'step'],
  emits: ['update:modelValue'],
  template: `<input
    class="slider"
    :data-label="label"
    :data-value="modelValue"
    :data-min="min"
    :data-max="max"
    :data-step="step"
  />`,
});

const globalOptions = {
  stubs: {
    VSlider: SliderStub,
    EditableChipList: ChipListStub,
    SegmentEditor: SegmentEditorStub,
    IsolatedDialog: { template: '<div class="dialog"><slot /></div>' },
    CloseableDialog: {
      props: ['modelValue'],
      template:
        '<div v-if="modelValue" class="dialog"><slot :close="() => {}" /></div>',
    },
    SaveSegmentGroupDialog: { props: ['id'], template: '<div />' },
    ColorDot: { props: ['color'], template: '<span class="color-dot" />' },
    VBtn: BtnStub,
    VIcon: IconStub,
    VTooltip: { template: '<span />' },
  },
};

const mountList = () => mount(SegmentList, { global: globalOptions });

const chipList = (wrapper: VueWrapper) => wrapper.findComponent(ChipListStub);

const rowIds = (wrapper: VueWrapper) =>
  wrapper.findAll('.chip-row').map((row) => row.attributes('data-id'));

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

const editor = (wrapper: VueWrapper) =>
  wrapper.findComponent(SegmentEditorStub);

describe('flat segment list', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await seatImage('img-2');
    await viewImage('img-1');
  });

  it('lists the viewed image’s segments in segmentation order, keyed by id', async () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([first.id, second.id]);
    expect(chipList(wrapper).props('itemKey')).toBe('id');
    expect(
      chipList(wrapper)
        .props('items')
        .map((item: { name: string }) => item.name)
    ).toEqual(['Tumor', 'Node']);
  });

  it('lists a segment that has no voxels yet', async () => {
    const unbound = makeSegment('img-1', 'Tumor');

    const wrapper = mountList();
    await nextTick();

    expect(unbound.representations.labelmap).toBeUndefined();
    expect(rowIds(wrapper)).toEqual([unbound.id]);
  });

  it('follows the viewed image rather than the active segment', async () => {
    const onOne = makeSegment('img-1', 'Tumor');
    const onTwo = makeSegment('img-2', 'Node');
    store().setActiveSegment(onOne.id);

    const wrapper = mountList();
    await nextTick();
    expect(rowIds(wrapper)).toEqual([onOne.id]);

    await viewImage('img-2');

    expect(rowIds(wrapper)).toEqual([onTwo.id]);
  });

  it('shows no rows for an image with no segmentation and creates none', async () => {
    const onOne = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(onOne.id);
    await viewImage('img-2');

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([]);
    expect(store().getSegmentationForImage('img-2')).toBeUndefined();
    // Rendering an empty list is not a deselection.
    expect(store().activeSegmentId).toBe(onOne.id);
  });

  it('leaves the active segment alone when it mounts', async () => {
    const first = makeSegment('img-1', 'Tumor');
    makeSegment('img-1', 'Node');
    store().setActiveSegment(first.id);

    mountList();
    await nextTick();

    expect(store().activeSegmentId).toBe(first.id);
  });
});

describe('flat segment list with no viewed image', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
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
    await seatImage('img-1');
    await seatImage('img-2');
    await viewImage('img-1');
  });

  it('marks the store’s active segment as the selected row', async () => {
    makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    store().setActiveSegment(second.id);

    const wrapper = mountList();
    await nextTick();

    expect(chipList(wrapper).props('modelValue')).toBe(second.id);
  });

  it('selects a segment by id when a row is picked', async () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    store().setActiveSegment(first.id);
    const wrapper = mountList();
    await nextTick();

    chipList(wrapper).vm.$emit('update:model-value', second.id);
    await nextTick();

    expect(store().activeSegmentId).toBe(second.id);
  });

  it('selects no row when the active segment belongs to another image', async () => {
    const onOne = makeSegment('img-1', 'Tumor');
    makeSegment('img-2', 'Node');
    store().setActiveSegment(onOne.id);
    await viewImage('img-2');

    const wrapper = mountList();
    await nextTick();

    expect(chipList(wrapper).props('modelValue')).toBeFalsy();
    expect(store().activeSegmentId).toBe(onOne.id);
  });
});

describe('flat segment list row creation', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await viewImage('img-1');
  });

  it('adds a row without allocating any storage', async () => {
    const wrapper = mountList();
    await nextTick();

    chipList(wrapper).vm.$emit('create');
    await nextTick();

    const segmentation = store().getSegmentationForImage('img-1')!;
    expect(segmentation.order).toHaveLength(1);
    const added = segmentation.segments[segmentation.order[0]];
    expect(added.representations.labelmap).toBeUndefined();
    expect(Object.keys(store().artifactIndex)).toEqual([]);
    expect(rowIds(wrapper)).toEqual([added.id]);
  });

  it('selects the row it adds', async () => {
    const wrapper = mountList();
    await nextTick();

    chipList(wrapper).vm.$emit('create');
    await nextTick();

    const segmentation = store().getSegmentationForImage('img-1')!;
    expect(store().activeSegmentId).toBe(segmentation.order[0]);
  });

  it('adds the row to the viewed image', async () => {
    await seatImage('img-2');
    makeSegment('img-2', 'Elsewhere');
    const wrapper = mountList();
    await nextTick();

    chipList(wrapper).vm.$emit('create');
    await nextTick();

    expect(store().getSegmentationForImage('img-1')!.order).toHaveLength(1);
    expect(store().getSegmentationForImage('img-2')!.order).toHaveLength(1);
  });
});

describe('flat segment list row actions', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await viewImage('img-1');
  });

  it('toggles one segment’s visibility by id', async () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, second.id, ['mdi-eye', 'mdi-eye-off']).trigger(
      'click'
    );

    expect(store().getSegment(second.id).visible).toBe(false);
    expect(store().getSegment(first.id).visible).toBe(true);
  });

  it('toggles one segment’s lock by id', async () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, second.id, ['mdi-lock', 'mdi-lock-open']).trigger(
      'click'
    );

    expect(store().getSegment(second.id).locked).toBe(true);
    expect(store().getSegment(first.id).locked).toBe(false);
  });

  it('deletes one segment by id', async () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, first.id, ['mdi-delete']).trigger('click');
    await nextTick();

    expect(store().getSegmentationForImage('img-1')!.order).toEqual([
      second.id,
    ]);
    expect(rowIds(wrapper)).toEqual([second.id]);
  });

  it('hides every segment on the viewed image at once', async () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    await seatImage('img-2');
    const elsewhere = makeSegment('img-2', 'Elsewhere');
    const wrapper = mountList();
    await nextTick();

    const toggleAll = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Toggle Segments'));
    await toggleAll!.trigger('click');

    expect(store().getSegment(first.id).visible).toBe(false);
    expect(store().getSegment(second.id).visible).toBe(false);
    expect(store().getSegment(elsewhere.id).visible).toBe(true);
  });
});

describe('flat segment list row editing', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await viewImage('img-1');
  });

  const openEditor = async (id: string) => {
    const wrapper = mountList();
    await nextTick();
    await rowButton(wrapper, id, ['mdi-pencil']).trigger('click');
    await nextTick();
    return wrapper;
  };

  it('renames the row’s segment by id', async () => {
    makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    const wrapper = await openEditor(second.id);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(store().getSegment(second.id).name).toBe('Lesion');
  });

  it('recolors the row’s segment by id', async () => {
    const segment = makeSegment('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    editor(wrapper).vm.$emit('update:color', '#0000ff');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(store().getSegment(segment.id).color.slice(0, 3)).toEqual([
      0, 0, 255,
    ]);
  });

  it('edits the segment’s fill and outline opacity', async () => {
    const segment = makeSegment('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    expect(editor(wrapper).props('fillOpacity')).toBe(1);
    expect(editor(wrapper).props('outlineOpacity')).toBe(1);

    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('update:outlineOpacity', 0.25);
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(store().getSegment(segment.id).fillOpacity).toBe(0.5);
    expect(store().getSegment(segment.id).outlineOpacity).toBe(0.25);
  });

  it('discards the edit when the dialog is cancelled', async () => {
    const segment = makeSegment('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('cancel');
    await nextTick();

    expect(store().getSegment(segment.id).name).toBe('Tumor');
    expect(store().getSegment(segment.id).fillOpacity).toBe(1);
  });

  it('offers the other rows’ names as taken', async () => {
    makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    const wrapper = await openEditor(second.id);

    expect([...editor(wrapper).props('invalidNames')]).toEqual(['Tumor']);
  });
});

// A cine clip is a stack of unrelated frames, so a segmentation drawn across it
// means nothing and saves as an empty 2D file.
describe('flat segment list on a cine image', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    seatCineImage('cine-1');
    await seatImage('img-1');
    await nextTick();
  });

  it('creates no segment when the create affordance is driven anyway', async () => {
    await viewImage('cine-1');
    const wrapper = mountList();
    await nextTick();

    chipList(wrapper).vm.$emit('create');
    await nextTick();

    expect(store().getSegmentationForImage('cine-1')).toBeUndefined();
    expect(rowIds(wrapper)).toEqual([]);
  });

  it('offers no create affordance', async () => {
    await viewImage('cine-1');
    const wrapper = mountList();
    await nextTick();

    expect(wrapper.find('.create-chip').exists()).toBe(false);
  });

  it('still offers the create affordance on a plain image', async () => {
    await viewImage('img-1');
    const wrapper = mountList();
    await nextTick();

    expect(wrapper.find('.create-chip').exists()).toBe(true);

    await wrapper.find('.create-chip').trigger('click');
    await nextTick();

    expect(store().getSegmentationForImage('img-1')).toBeDefined();
    expect(rowIds(wrapper)).toHaveLength(1);
  });
});

// The segmentation display section owns the multipliers that scale every
// segment at once, and the outline thickness they share.
describe('segmentation display section', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await viewImage('img-1');
  });

  const slider = (wrapper: VueWrapper, label: string) => {
    const found = wrapper.find(`.slider[data-label="${label}"]`);
    if (!found.exists()) throw new Error(`No "${label}" slider`);
    return found;
  };

  const setSlider = async (
    wrapper: VueWrapper,
    label: string,
    value: number
  ) => {
    const stub = wrapper
      .findAllComponents(SliderStub)
      .find((candidate) => candidate.props('label') === label);
    if (!stub) throw new Error(`No "${label}" slider`);
    stub.vm.$emit('update:modelValue', value);
    await nextTick();
  };

  it('offers no display controls until the image has a segmentation', async () => {
    const wrapper = mountList();
    await nextTick();

    expect(wrapper.findAll('.slider')).toHaveLength(0);
  });

  it('seats each control at the segmentation’s current value', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createSegment(segmentation.id, { name: 'Tumor' });
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

  it('writes the fill multiplier onto the viewed image’s segmentation', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createSegment(segmentation.id, { name: 'Tumor' });
    const wrapper = mountList();
    await nextTick();

    await setSlider(wrapper, 'Fill Opacity', 0.25);

    expect(store().getSegmentationForImage('img-1')!.fillOpacity).toBe(0.25);
  });

  it('writes the outline multiplier onto the viewed image’s segmentation', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createSegment(segmentation.id, { name: 'Tumor' });
    const wrapper = mountList();
    await nextTick();

    await setSlider(wrapper, 'Outline Opacity', 0.5);

    expect(store().getSegmentationForImage('img-1')!.outlineOpacity).toBe(0.5);
  });

  it('writes the outline thickness onto the viewed image’s segmentation', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createSegment(segmentation.id, { name: 'Tumor' });
    const wrapper = mountList();
    await nextTick();

    await setSlider(wrapper, 'Outline Thickness', 4);

    expect(store().getSegmentationForImage('img-1')!.outlineThickness).toBe(4);
  });

  it('writes only the viewed image’s segmentation', async () => {
    await seatImage('img-2', 'MR');
    const first = store().ensureSegmentationForImage('img-1');
    store().createSegment(first.id, { name: 'Tumor' });
    const second = store().ensureSegmentationForImage('img-2');
    store().createSegment(second.id, { name: 'Node' });
    const wrapper = mountList();
    await nextTick();

    await setSlider(wrapper, 'Fill Opacity', 0.25);

    expect(store().getSegmentationForImage('img-1')!.fillOpacity).toBe(0.25);
    expect(store().getSegmentationForImage('img-2')!.fillOpacity).toBe(1);
  });
});
