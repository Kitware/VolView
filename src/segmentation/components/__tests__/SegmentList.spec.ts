import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  type Index3,
  maskOn,
  lockSegment,
  boundMasks,
  seedVoxel,
  markedVoxels,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { defineComponent, nextTick, ref } from 'vue';
import { enableAutoUnmount, mount, VueWrapper } from '@vue/test-utils';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import SegmentList from '@/src/segmentation/components/SegmentList.vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { DEFAULT_SEGMENTATION_FILL_OPACITY } from '@/src/segmentation/model';
import { extentSize, maskOffset } from '@/src/segmentation/geometry';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { seatCineImage } from '@/src/core/cine/__tests__/cineFixtures';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  useCurrentTools,
  usePlacingAnnotationTool,
} from '@/src/composables/annotationTool';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';
import useCinePlaybackStore from '@/src/store/view-configs/cine-playback';
import useViewCameraStore from '@/src/store/view-configs/camera';

enableAutoUnmount(afterEach);

// ---------------------------------------------------------------------------
// One flat list of segment types: rows are the shared registry's segments, keyed
// on type id, offered whether or not this image has a mask for them. The
// visibility and lock controls belong to the shared segment, the
// display sliders to its segmentation, and adding a row allocates nothing.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;

const store = () => useSegmentationStore();
const segments = () => useSegmentStore().segments;

async function seatImage(
  id: string,
  name = 'CT',
  dimensions: readonly [number, number, number] = DIMENSIONS
) {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(dimensions as unknown as [number, number, number]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]),
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
const makeMask = (imageId: string, name: string) => {
  const segmentId = segments().mintSegment({ name });
  const record = maskOn(imageId, segmentId);
  return { id: segmentId, segmentId, maskId: record.id, record };
};

/** A type with no mask anywhere, which the list still offers. */
const makeSegment = (name: string) => segments().mintSegment({ name });

// The item list stands in for the real one so the per-row slot renders without
// Vuetify: rows carry their segment id, and the row buttons keep the icon names
// the list uses today.
const ItemListStub = defineComponent({
  name: 'EditableItemList',
  props: [
    'items',
    'itemKey',
    'itemTitle',
    'modelValue',
    'createText',
    'hideCreate',
  ],
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
      <button v-if="!hideCreate" class="create-row" @click="$emit('create')" />
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

const mountList = () => mount(SegmentList, { global: globalOptions });

const itemList = (wrapper: VueWrapper) => wrapper.findComponent(ItemListStub);

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
    await seatImage('img-1');
    await seatImage('img-2');
    await viewImage('img-1');
  });

  it('lists the registry in creation order, keyed by type id', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([first.id, second.id]);
    expect(itemList(wrapper).props('itemKey')).toBe('id');
    expect(
      itemList(wrapper)
        .props('items')
        .map((item: { name: string }) => item.name)
    ).toEqual(['Tumor', 'Node']);
  });

  it('lists a type that has no voxels yet', async () => {
    const unbound = makeMask('img-1', 'Tumor');

    const wrapper = mountList();
    await nextTick();

    expect(unbound.record.representations.labelmap).toBeUndefined();
    expect(rowIds(wrapper)).toEqual([unbound.id]);
  });

  it('offers a type with no mask on this image', async () => {
    const onTwo = makeMask('img-2', 'Node');
    const everywhere = makeSegment('Tumor');

    const wrapper = mountList();
    await nextTick();

    expect(rowIds(wrapper)).toEqual([onTwo.id, everywhere]);
    expect(store().getSegmentationForImage('img-1')).toBeUndefined();
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

  it('creates no segmentation for an image it renders', async () => {
    const onOne = makeMask('img-1', 'Tumor');
    segments().selectSegment(onOne.segmentId);
    await viewImage('img-2');

    mountList();
    await nextTick();

    expect(store().getSegmentationForImage('img-2')).toBeUndefined();
    // Rendering an empty list is not a deselection.
    expect(segments().selectedSegmentId.value).toBe(onOne.segmentId);
  });

  it('leaves the selected type alone when it mounts', async () => {
    const first = makeMask('img-1', 'Tumor');
    makeMask('img-1', 'Node');
    segments().selectSegment(first.segmentId);

    mountList();
    await nextTick();

    expect(segments().selectedSegmentId.value).toBe(first.segmentId);
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
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    segments().selectSegment(second.segmentId);

    const wrapper = mountList();
    await nextTick();

    expect(itemList(wrapper).props('modelValue')).toBe(second.segmentId);
  });

  it('selects a type by id when a row is picked', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    segments().selectSegment(first.segmentId);
    const wrapper = mountList();
    await nextTick();

    itemList(wrapper).vm.$emit('update:model-value', second.segmentId);
    await nextTick();

    expect(segments().selectedSegmentId.value).toBe(second.segmentId);
    // Selecting creates nothing on any image.
    expect(store().getSegmentationForImage('img-2')).toBeUndefined();
  });

  it('keeps the selected row on an image the type has no mask on', async () => {
    const onOne = makeMask('img-1', 'Tumor');
    segments().selectSegment(onOne.segmentId);
    await viewImage('img-2');

    const wrapper = mountList();
    await nextTick();

    expect(itemList(wrapper).props('modelValue')).toBe(onOne.segmentId);
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

    itemList(wrapper).vm.$emit('create');
    await nextTick();

    expect(segments().segmentList.value).toHaveLength(1);
    expect(store().getSegmentationForImage('img-1')).toBeUndefined();
    expect(boundMasks()).toEqual([]);
    expect(rowIds(wrapper)).toEqual([segments().segmentList.value[0].id]);
  });

  it('selects the row it adds', async () => {
    const wrapper = mountList();
    await nextTick();

    itemList(wrapper).vm.$emit('create');
    await nextTick();

    expect(segments().selectedSegmentId.value).toBe(
      segments().segmentList.value[0].id
    );
  });

  it('adds the row for every image at once', async () => {
    await seatImage('img-2');
    makeMask('img-2', 'Elsewhere');
    const wrapper = mountList();
    await nextTick();

    itemList(wrapper).vm.$emit('create');
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
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, second.id, ['mdi-eye', 'mdi-eye-off']).trigger(
      'click'
    );

    expect(segments().appearanceOf(second.segmentId).visible).toBe(false);
    expect(segments().appearanceOf(first.segmentId).visible).toBe(true);
  });

  it('toggles one segment’s lock by id', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, second.id, ['mdi-lock', 'mdi-lock-open']).trigger(
      'click'
    );

    expect(segments().appearanceOf(second.segmentId).locked).toBe(true);
    expect(segments().appearanceOf(first.segmentId).locked).toBe(false);
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
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = mountWithTooltips();
    await nextTick();

    expect(lockTooltip(wrapper, segment.id)).toMatch(/^Lock\b/);
    expect(lockTooltip(wrapper, segment.id)).toMatch(/shares its voxels/i);

    lockSegment(segment.maskId, true);
    await nextTick();

    expect(lockTooltip(wrapper, segment.id)).toMatch(/^Unlock\b/);
    expect(lockTooltip(wrapper, segment.id)).toMatch(/takes its voxels/i);
  });

  it('deletes one type, with the masks it had, by id', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = mountList();
    await nextTick();

    await rowButton(wrapper, first.id, ['mdi-delete']).trigger('click');
    await nextTick();

    expect(store().getSegmentationForImage('img-1')!.order).toEqual([
      second.maskId,
    ]);
    expect(segments().getSegment(first.segmentId)).toBeUndefined();
    expect(rowIds(wrapper)).toEqual([second.id]);
  });

  it('offers visibility and lock on every row, mask here or not', async () => {
    const withMask = makeMask('img-1', 'Tumor');
    const withoutMask = makeSegment('Elsewhere');
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

    expect(segments().appearanceOf(withoutMask).visible).toBe(false);
  });

  it('hides every type at once, on every image', async () => {
    const first = makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    await seatImage('img-2');
    const elsewhere = makeMask('img-2', 'Elsewhere');
    const wrapper = mountList();
    await nextTick();

    await wrapper
      .find('[data-testid="toggle-segments-visible-button"]')
      .trigger('click');

    expect(segments().appearanceOf(first.segmentId).visible).toBe(false);
    expect(segments().appearanceOf(second.segmentId).visible).toBe(false);
    expect(segments().appearanceOf(elsewhere.segmentId).visible).toBe(false);
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
    makeMask('img-1', 'Tumor');
    const second = makeMask('img-1', 'Node');
    const wrapper = await openEditor(second.id);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(segments().appearanceOf(second.segmentId).name).toBe('Lesion');
    expect(store().getMask(second.maskId).segmentId).toBe(second.segmentId);
  });

  it('recolors the row’s type by id', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    editor(wrapper).vm.$emit('update:color', '#0000ff');
    editor(wrapper).vm.$emit('done');
    await nextTick();

    expect(
      [...segments().appearanceOf(segment.segmentId).color].slice(0, 3)
    ).toEqual([0, 0, 255]);
  });

  it('edits the type’s fill opacity, outline opacity and stroke width', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    expect(editor(wrapper).props('fillOpacity')).toBe(1);
    expect(editor(wrapper).props('outlineOpacity')).toBe(1);

    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('update:outlineOpacity', 0.25);
    editor(wrapper).vm.$emit('update:strokeWidth', 3);
    editor(wrapper).vm.$emit('done');
    await nextTick();

    const appearance = segments().appearanceOf(segment.segmentId);
    expect(appearance.fillOpacity).toBe(0.5);
    expect(appearance.outlineOpacity).toBe(0.25);
    expect(appearance.strokeWidth).toBe(3);
  });

  it('discards the edit when the dialog is cancelled', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = await openEditor(segment.id);

    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('update:fillOpacity', 0.5);
    editor(wrapper).vm.$emit('cancel');
    await nextTick();

    const appearance = segments().appearanceOf(segment.segmentId);
    expect(appearance.name).toBe('Tumor');
    expect(appearance.fillOpacity).toBe(1);
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

  it('creates and edits distinct measurement segments without allocating masks', async () => {
    const wrapper = mountList();
    const rulers = useRulerStore();
    const placed = [];
    for (const [name, color] of [
      ['Long axis', '#ff0000'],
      ['Short axis', '#0000ff'],
    ]) {
      await wrapper.get('.create-row').trigger('click');
      const segmentId = segments().selectedSegmentId.value!;
      await rowButton(wrapper, segmentId, ['mdi-pencil']).trigger('click');
      editor(wrapper).vm.$emit('update:name', name);
      editor(wrapper).vm.$emit('update:color', color);
      editor(wrapper).vm.$emit('done');
      await nextTick();
      const id = rulers.addTool({
        imageID: 'cine-1',
        frame: 1,
        slice: 0,
        frameOfReference: AXIAL_FRAME_OF_REFERENCE,
        placing: true,
      });
      rulers.placeTool(id);
      placed.push(id);
    }

    expect(segments().segmentList.value).toHaveLength(2);
    expect(placed.map((id) => rulers.appearanceOfTool(id).name)).toEqual([
      'Long axis',
      'Short axis',
    ]);
    expect(
      placed.map((id) => [...rulers.appearanceOfTool(id).color].slice(0, 3))
    ).toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
    expect(
      new Set(placed.map((id) => rulers.toolByID[id].segmentId)).size
    ).toBe(2);
    expect(store().getSegmentationForImage('cine-1')).toBeUndefined();
    expect(boundMasks()).toEqual([]);
    expect(
      wrapper.get('[data-testid="save-segments-button"]').attributes('disabled')
    ).toBeDefined();
  });

  it.each([[1], [0, 1]])(
    'reveals an occupied cine frame for annotations on frames %j',
    async (...frames) => {
      const segmentId = segments().addSegment({ name: 'Measurement' });
      const rulers = useRulerStore();
      const ids = frames.map((frame) =>
        rulers.addTool({
          imageID: 'cine-1',
          segmentId,
          frame,
          slice: 0,
          frameOfReference: AXIAL_FRAME_OF_REFERENCE,
        })
      );
      const playback = useCinePlaybackStore();
      const viewId = useViewStore().activeView!;
      playback.updateConfig(viewId, 'cine-1', {
        frame: frames[0] === 0 ? 1 : 0,
      });
      const camera = useViewCameraStore();
      const pose = {
        position: [4, 6, 10] as [number, number, number],
        focalPoint: [4, 6, 0] as [number, number, number],
        parallelScale: 25,
      };
      camera.updateConfig(viewId, 'cine-1', pose);
      const wrapper = mountList();

      expect(
        revealButton(wrapper, segmentId).attributes('disabled')
      ).toBeUndefined();
      await revealButton(wrapper, segmentId).trigger('click');

      expect(playback.getConfig(viewId, 'cine-1').frame).toBe(frames[0]);
      expect(camera.getConfig(viewId, 'cine-1')).toMatchObject(pose);
      // The shape action retains the same temporal navigation semantics.
      rulers.jumpToTool(ids[ids.length - 1]);
      expect(playback.getConfig(viewId, 'cine-1').frame).toBe(
        frames[frames.length - 1]
      );
    }
  );

  it('keeps an empty segment reveal disabled and leaves the frame alone', async () => {
    const segmentId = segments().addSegment();
    const wrapper = mountList();
    const viewId = useViewStore().activeView!;
    useCinePlaybackStore().updateConfig(viewId, 'cine-1', { frame: 1 });
    expect(
      revealButton(wrapper, segmentId).attributes('disabled')
    ).toBeDefined();
    await revealButton(wrapper, segmentId).trigger('click');
    expect(useCinePlaybackStore().getConfig(viewId, 'cine-1').frame).toBe(1);
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

  it('creates display state when a default control is changed', async () => {
    const wrapper = mountList();

    await setSlider(wrapper, 'Fill Opacity', 0.25);

    expect(store().getSegmentationForImage('img-1')?.fillOpacity).toBe(0.25);
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
    ['Fill Opacity', 'fillOpacity', 0.25],
    ['Outline Opacity', 'outlineOpacity', 0.5],
    ['Outline Thickness', 'outlineThickness', 4],
  ] as const)(
    'writes %s onto the viewed image’s segmentation',
    async (label, key, value) => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      store().createMask(
        segmentation.id,
        segments().mintSegment({ name: 'Tumor' })
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
    store().createMask(first.id, segments().mintSegment({ name: 'Tumor' }));
    const second = store().ensureSegmentationForImage('img-2');
    store().createMask(second.id, segments().mintSegment({ name: 'Node' }));
    const wrapper = mountList();
    await nextTick();

    await setSlider(wrapper, 'Fill Opacity', 0.25);

    expect(store().getSegmentationForImage('img-1')!.fillOpacity).toBe(0.25);
    expect(store().getSegmentationForImage('img-2')!.fillOpacity).toBe(
      DEFAULT_SEGMENTATION_FILL_OPACITY
    );
  });
});

// Reveal Slice is the only row control that reads the viewed image's storage,
// so it is the one that has to say when this image holds nothing for the row.
describe('Reveal Slice on a segment row', () => {
  const REVEAL_DIMENSIONS = [4, 4, 8] as const;

  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', 'CT', REVEAL_DIMENSIONS);
    await viewImage('img-1');
  });

  const viewFor = (orientation: string) => {
    const view = useViewStore()
      .getAllViews()
      .find(
        (candidate) =>
          candidate.type === '2D' &&
          candidate.options.orientation === orientation
      );
    if (!view) throw new Error(`No ${orientation} view`);
    return view;
  };

  const sliceOn = (orientation: string) =>
    useViewSliceStore().getConfig(viewFor(orientation).id, 'img-1')!.slice;

  const setSliceOn = (orientation: string, slice: number) =>
    useViewSliceStore().updateConfig(viewFor(orientation).id, 'img-1', {
      slice,
    });

  // Paint grows the allocation with padding and clips it to the volume, so the
  // binding's extent is wider than what is marked and its middle is not the
  // segment's. Marking through that same path is what keeps the reveal honest.
  const STROKE_PADDING = 16;

  const paintVoxel = (maskId: string, index: Index3) => {
    const voxels = store().maskVoxels(maskId);
    voxels.materialize();
    const labelValue = SEGMENT_VALUE;
    const [i, j, k] = index;
    voxels.ensureContains([i, i, j, j, k, k], STROKE_PADDING);
    const { extent } = voxels.binding()!;
    const [mi, mj] = extentSize(extent);
    voxels.scalars()[maskOffset({ extent, mi, mj }, i, j, k)] = labelValue;
    voxels.image().modified();
  };

  it('is offered disabled, saying why, on a row this image stores nothing for', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = mountList();
    await nextTick();

    expect(
      revealButton(wrapper, segment.id).attributes('disabled')
    ).toBeDefined();
  });

  it('says on the disabled control that this image holds nothing for the row', async () => {
    const segment = makeMask('img-1', 'Tumor');
    const wrapper = mount(SegmentList, {
      global: {
        stubs: {
          ...globalOptions.stubs,
          VTooltip: { template: '<span class="tooltip"><slot /></span>' },
        },
      },
    });
    await nextTick();

    expect(
      revealButton(wrapper, segment.id).element.parentElement?.textContent
    ).toMatch(/nothing on this image/i);
  });

  it('puts each 2D view on the middle of what the segment marks here', async () => {
    const segment = makeMask('img-1', 'Tumor');
    paintVoxel(segment.maskId, [1, 1, 6]);
    const wrapper = mountList();
    await nextTick();

    // The padded allocation spans the whole volume, so its own middle is the
    // slice each view already shows.
    expect(sliceOn('Axial')).toBe(4);
    expect(sliceOn('Sagittal')).toBe(2);

    await revealButton(wrapper, segment.id).trigger('click');

    expect(sliceOn('Axial')).toBe(6);
    expect(sliceOn('Sagittal')).toBe(1);
    expect(sliceOn('Coronal')).toBe(1);
  });

  it('moves outward from the center to the nearest occupied slice', async () => {
    const segment = makeMask('img-1', 'Tumor');
    paintVoxel(segment.maskId, [1, 1, 1]);
    paintVoxel(segment.maskId, [1, 1, 5]);
    const wrapper = mountList();
    await nextTick();

    await revealButton(wrapper, segment.id).trigger('click');

    expect(sliceOn('Axial')).toBe(1);
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

  it('leaves the views where they are when the mask marks nothing', async () => {
    const segment = makeMask('img-1', 'Tumor');
    paintVoxel(segment.maskId, [1, 1, 6]);
    const voxels = store().maskVoxels(segment.maskId);
    voxels.scalars().fill(0);
    voxels.image().modified();
    const wrapper = mountList();
    await nextTick();
    setSliceOn('Axial', 7);

    await revealButton(wrapper, segment.id).trigger('click');

    expect(sliceOn('Axial')).toBe(7);
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
      await seatImage('img-1');
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
      const hidden = addShape('img-1', true);
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
      expect(tools.toolByID[hidden].hidden).toBe(true);
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
    await seatImage('img-1');
    await seatImage('img-2');
    await viewImage('img-1');
  });

  const protectedContent = () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });
    const rulers = useRulerStore();
    const content = ['img-1', 'img-2'].map((imageID) => {
      const mask = maskOn(imageID, segmentId);
      seedVoxel(mask.id, [1, 1, 0]);
      const ruler = rulers.addTool({
        imageID,
        segmentId,
        slice: 0,
        frameOfReference: AXIAL_FRAME_OF_REFERENCE,
      });
      return { imageID, maskId: mask.id, ruler };
    });
    const expectPreserved = () => {
      expect(segments().appearanceOf(segmentId).name).toBe('Tumor');
      content.forEach(({ imageID, maskId, ruler }) => {
        expect(store().maskFor(imageID, segmentId)?.id).toBe(maskId);
        expect(markedVoxels(maskId)).toEqual([[1, 1, 0, SEGMENT_VALUE]]);
        expect(rulers.toolByID[ruler].segmentId).toBe(segmentId);
      });
    };
    return { segmentId, expectPreserved };
  };

  it('disables color, edit and delete consistently and restores editing after unlocking', async () => {
    const { segmentId, expectPreserved } = protectedContent();
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
      expectPreserved();
    }
    segments().updateSegment(segmentId, { locked: false });
    await nextTick();
    await wrapper.get('[data-testid="segment-color-button"]').trigger('click');
    expect(editor(wrapper).exists()).toBe(true);
    editor(wrapper).vm.$emit('update:name', 'Lesion');
    editor(wrapper).vm.$emit('done');
    await nextTick();
    expect(segments().appearanceOf(segmentId).name).toBe('Lesion');
  });

  it.each(['done', 'delete'])(
    'refuses %s if the segment becomes locked while its editor is open',
    async (action) => {
      const { segmentId, expectPreserved } = protectedContent();
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
      expectPreserved();
    }
  );
});
