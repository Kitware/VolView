import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  recordFor,
  lockSegment,
} from '@/src/store/__tests__/segmentMaskFixtures';
import { defineComponent, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import SegmentList from '@/src/components/SegmentList.vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { DEFAULT_SEGMENTATION_FILL_OPACITY } from '@/src/types/segmentation';
import { useViewStore } from '@/src/store/views';
import { seatCineImage } from '@/src/core/cine/__tests__/cineFixtures';

// ---------------------------------------------------------------------------
// One flat list of segment types: rows are the shared registry's types, keyed
// on type id, offered whether or not this image has a mask for them. The
// visibility and lock controls belong to the viewed image's record, the
// display sliders to its segmentation, and adding a row allocates nothing.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();
const types = () => useSegmentTypeStore().types;

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

/** A type with a mask on one image: what a painted segment looks like. */
const makeSegment = (imageId: string, name: string) => {
  const typeId = types().mintType({ name });
  const record = recordFor(imageId, typeId);
  return { id: typeId, typeId, recordId: record.id, record };
};

/** A type with no mask anywhere, which the list still offers. */
const makeType = (name: string) => types().mintType({ name });

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
  name: 'SegmentTypeEditor',
  props: [
    'name',
    'original',
    'color',
    'fillOpacity',
    'outlineOpacity',
    'strokeWidth',
    'invalidNames',
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
    SegmentTypeEditor: SegmentEditorStub,
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

  it('lists the registry in creation order, keyed by type id', async () => {
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

  it('lists a type that has no voxels yet', async () => {
    const unbound = makeSegment('img-1', 'Tumor');

    const wrapper = mountList();
    await nextTick();

    expect(unbound.record.representations.labelmap).toBeUndefined();
    expect(rowIds(wrapper)).toEqual([unbound.id]);
  });

  it('offers a type with no mask on this image', async () => {
    const onTwo = makeSegment('img-2', 'Node');
    const everywhere = makeType('Tumor');

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([onTwo.id, everywhere]);
    expect(store().getSegmentationForImage('img-1')).toBeUndefined();
  });

  it('keeps the same rows when the viewed image changes', async () => {
    const onOne = makeSegment('img-1', 'Tumor');
    const onTwo = makeSegment('img-2', 'Node');

    const wrapper = mountList();
    await nextTick();
    expect(rowIds(wrapper)).toEqual([onOne.id, onTwo.id]);

    await viewImage('img-2');

    expect(rowIds(wrapper)).toEqual([onOne.id, onTwo.id]);
  });

  it('creates no segmentation for an image it renders', async () => {
    const onOne = makeSegment('img-1', 'Tumor');
    types().selectType(onOne.typeId);
    await viewImage('img-2');

    mountList();
    await nextTick();

    expect(store().getSegmentationForImage('img-2')).toBeUndefined();
    // Rendering an empty list is not a deselection.
    expect(types().selectedTypeId.value).toBe(onOne.typeId);
  });

  it('leaves the selected type alone when it mounts', async () => {
    const first = makeSegment('img-1', 'Tumor');
    makeSegment('img-1', 'Node');
    types().selectType(first.typeId);

    mountList();
    await nextTick();

    expect(types().selectedTypeId.value).toBe(first.typeId);
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

  it('marks the selected type as the selected row', async () => {
    makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    types().selectType(second.typeId);

    const wrapper = mountList();
    await nextTick();

    expect(chipList(wrapper).props('modelValue')).toBe(second.typeId);
  });

  it('selects a type by id when a row is picked', async () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    types().selectType(first.typeId);
    const wrapper = mountList();
    await nextTick();

    chipList(wrapper).vm.$emit('update:model-value', second.typeId);
    await nextTick();

    expect(types().selectedTypeId.value).toBe(second.typeId);
    // Selecting creates nothing on any image.
    expect(store().getSegmentationForImage('img-2')).toBeUndefined();
  });

  it('keeps the selected row on an image the type has no mask on', async () => {
    const onOne = makeSegment('img-1', 'Tumor');
    types().selectType(onOne.typeId);
    await viewImage('img-2');

    const wrapper = mountList();
    await nextTick();

    expect(chipList(wrapper).props('modelValue')).toBe(onOne.typeId);
    expect(store().getSegmentationForImage('img-2')).toBeUndefined();
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

    expect(types().typeList.value).toHaveLength(1);
    expect(store().getSegmentationForImage('img-1')).toBeUndefined();
    expect(Object.keys(store().artifactIndex)).toEqual([]);
    expect(rowIds(wrapper)).toEqual([types().typeList.value[0].id]);
  });

  it('selects the row it adds', async () => {
    const wrapper = mountList();
    await nextTick();

    chipList(wrapper).vm.$emit('create');
    await nextTick();

    expect(types().selectedTypeId.value).toBe(types().typeList.value[0].id);
  });

  it('adds the row for every image at once', async () => {
    await seatImage('img-2');
    makeSegment('img-2', 'Elsewhere');
    const wrapper = mountList();
    await nextTick();

    chipList(wrapper).vm.$emit('create');
    await nextTick();

    expect(rowIds(wrapper)).toHaveLength(2);
    // The other image keeps the one mask it had; the new type has none.
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

    expect(types().appearanceOf(second.typeId).visible).toBe(false);
    expect(types().appearanceOf(first.typeId).visible).toBe(true);
  });

  it('toggles one segment’s lock by id', async () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, second.id, ['mdi-lock', 'mdi-lock-open']).trigger(
      'click'
    );

    expect(types().appearanceOf(second.typeId).locked).toBe(true);
    expect(types().appearanceOf(first.typeId).locked).toBe(false);
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

  it('says on the lock that it is what lets two segments share voxels', async () => {
    const segment = makeSegment('img-1', 'Tumor');
    const wrapper = mountWithTooltips();
    await nextTick();

    expect(lockTooltip(wrapper, segment.id)).toMatch(/^Lock\b/);
    expect(lockTooltip(wrapper, segment.id)).toMatch(/shares its voxels/i);

    lockSegment(segment.recordId, true);
    await nextTick();

    expect(lockTooltip(wrapper, segment.id)).toMatch(/^Unlock\b/);
    expect(lockTooltip(wrapper, segment.id)).toMatch(/takes its voxels/i);
  });

  it('deletes one type, with the masks it had, by id', async () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, first.id, ['mdi-delete']).trigger('click');
    await nextTick();

    expect(store().getSegmentationForImage('img-1')!.order).toEqual([
      second.recordId,
    ]);
    expect(types().getType(first.typeId)).toBeUndefined();
    expect(rowIds(wrapper)).toEqual([second.id]);
  });

  it('offers visibility and lock on every row, mask here or not', async () => {
    const withMask = makeSegment('img-1', 'Tumor');
    const withoutMask = makeType('Elsewhere');
    const wrapper = mountList();
    await nextTick();

    // Both describe the type, so they hold on every image and are offered on
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

    expect(types().appearanceOf(withoutMask).visible).toBe(false);
  });

  it('hides every type at once, on every image', async () => {
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

    expect(types().appearanceOf(first.typeId).visible).toBe(false);
    expect(types().appearanceOf(second.typeId).visible).toBe(false);
    expect(types().appearanceOf(elsewhere.typeId).visible).toBe(false);
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

  it('renames the row’s type by id, keeping that id', async () => {
    makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    const wrapper = await openEditor(second.id);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(types().appearanceOf(second.typeId).name).toBe('Lesion');
    expect(store().getSegment(second.recordId).typeId).toBe(second.typeId);
  });

  it('recolors the row’s type by id', async () => {
    const segment = makeSegment('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    editor(wrapper).vm.$emit('update:color', '#0000ff');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect([...types().appearanceOf(segment.typeId).color].slice(0, 3)).toEqual(
      [0, 0, 255]
    );
  });

  it('edits the type’s fill opacity, outline opacity and stroke width', async () => {
    const segment = makeSegment('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    expect(editor(wrapper).props('fillOpacity')).toBe(1);
    expect(editor(wrapper).props('outlineOpacity')).toBe(1);

    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('update:outlineOpacity', 0.25);
    editor(wrapper).vm.$emit('update:strokeWidth', 3);
    editor(wrapper).vm.$emit('done');
    await nextTick();

    const appearance = types().appearanceOf(segment.typeId);
    expect(appearance.fillOpacity).toBe(0.5);
    expect(appearance.outlineOpacity).toBe(0.25);
    expect(appearance.strokeWidth).toBe(3);
  });

  it('discards the edit when the dialog is cancelled', async () => {
    const segment = makeSegment('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('cancel');
    await nextTick();

    const appearance = types().appearanceOf(segment.typeId);
    expect(appearance.name).toBe('Tumor');
    expect(appearance.fillOpacity).toBe(1);
  });

  it('offers the other rows’ names as taken', async () => {
    makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    const wrapper = await openEditor(second.id);

    expect([...editor(wrapper).props('invalidNames')]).toEqual(['Tumor']);
  });

  it('passes the unedited name to the editor', async () => {
    const segment = makeSegment('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    expect(editor(wrapper).props('original')).toBe('Tumor');
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

  it('creates no type when the create affordance is driven anyway', async () => {
    await viewImage('cine-1');
    const wrapper = mountList();
    await nextTick();

    chipList(wrapper).vm.$emit('create');
    await nextTick();

    expect(store().getSegmentationForImage('cine-1')).toBeUndefined();
    expect(types().typeList.value).toEqual([]);
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

    expect(types().typeList.value).toHaveLength(1);
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
    const found = wrapper
      .findAllComponents(SliderStub)
      .find((candidate) => candidate.props('label') === label);
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

  it('offers no display controls until the image has a segmentation', async () => {
    const wrapper = mountList();
    await nextTick();

    expect(wrapper.findAll('.slider')).toHaveLength(0);
  });

  it('seats each control at the segmentation’s current value', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createSegment(segmentation.id, types().mintType({ name: 'Tumor' }));
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
    ['Fill Opacity', 'fillOpacity', 0.25],
    ['Outline Opacity', 'outlineOpacity', 0.5],
    ['Outline Thickness', 'outlineThickness', 4],
  ] as const)(
    'writes %s onto the viewed image’s segmentation',
    async (label, key, value) => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      store().createSegment(
        segmentation.id,
        types().mintType({ name: 'Tumor' })
      );
      const wrapper = mountList();
      await nextTick();

      await setSlider(wrapper, label, value);

      expect(store().getSegmentationForImage('img-1')![key]).toBe(value);
    }
  );

  it('writes only the viewed image’s segmentation', async () => {
    await seatImage('img-2', 'MR');
    const first = store().ensureSegmentationForImage('img-1');
    store().createSegment(first.id, types().mintType({ name: 'Tumor' }));
    const second = store().ensureSegmentationForImage('img-2');
    store().createSegment(second.id, types().mintType({ name: 'Node' }));
    const wrapper = mountList();
    await nextTick();

    await setSlider(wrapper, 'Fill Opacity', 0.25);

    expect(store().getSegmentationForImage('img-1')!.fillOpacity).toBe(0.25);
    expect(store().getSegmentationForImage('img-2')!.fillOpacity).toBe(
      DEFAULT_SEGMENTATION_FILL_OPACITY
    );
  });
});
