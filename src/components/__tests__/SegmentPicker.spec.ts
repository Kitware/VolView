import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';

import SegmentList from '@/src/components/SegmentList.vue';
import { useSegmentStore } from '@/src/store/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRulerStore } from '@/src/store/tools/rulers';
import type { SegmentRegistry } from '@/src/store/tools/segmentRegistry';

// ---------------------------------------------------------------------------
// The same list drives either registry. Without per-image masks behind it, the
// controls scoped to the viewed image are absent rather than disabled: lock,
// Reveal Slice, the display sliders and save.
// ---------------------------------------------------------------------------

const ItemListStub = defineComponent({
  name: 'EditableItemList',
  props: ['items', 'modelValue', 'createText'],
  emits: ['update:model-value', 'create'],
  template: `
    <div>
      <div v-for="item in items" :key="item.id" :data-id="item.id">
        <span class="row-name">{{ item.name }}</span>
        <slot name="item-append" :key="item.id" :item="item" />
      </div>
      <button class="create-row" @click="$emit('create')" />
    </div>
  `,
});

const EditorStub = defineComponent({
  name: 'SegmentEditor',
  props: [
    'name',
    'original',
    'color',
    'fillOpacity',
    'outlineOpacity',
    'strokeWidth',
    'invalidNames',
  ],
  emits: ['done', 'cancel', 'delete', 'update:name'],
  template: '<div class="segment-editor" />',
});

const global = {
  stubs: {
    EditableItemList: ItemListStub,
    IsolatedDialog: { template: '<div><slot /></div>' },
    CloseableDialog: {
      props: ['modelValue'],
      template: '<div v-if="modelValue"><slot :close="() => {}" /></div>',
    },
    SaveSegmentGroupDialog: { props: ['id'], template: '<div />' },
    SegmentEditor: EditorStub,
    VSlider: { props: ['label'], template: '<input class="slider" />' },
    VBtn: {
      props: ['icon'],
      template: '<button :data-icon="icon"><slot /></button>',
    },
    VIcon: { template: '<i class="icon"><slot /></i>' },
    VTooltip: { template: '<span />' },
  },
};

const mountPicker = (registry: SegmentRegistry) =>
  mount(SegmentList, { props: { registry, noun: 'ruler' }, global });

describe('the segment list without per-image masks', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('lists every segment in the registry it was given', async () => {
    const segments = useSegmentStore().segments;
    const tumor = segments.addSegment({ name: 'Tumor' });
    const node = segments.addSegment({ name: 'Node' });
    await nextTick();

    const wrapper = mountPicker(usePolygonStore().segments);

    expect(
      wrapper.findAll('[data-id]').map((row) => row.attributes('data-id'))
    ).toEqual([tumor, node]);
    expect(wrapper.findAll('.row-name').map((row) => row.text())).toEqual([
      'Tumor',
      'Node',
    ]);
  });

  it('offers editing for every segment', () => {
    const segments = usePolygonStore().segments;
    segments.addSegment({ name: 'Tumor' });

    const wrapper = mountPicker(segments);

    expect(wrapper.find('[data-testid="edit-segment-button"]').exists()).toBe(
      true
    );
  });

  it('adds a segment without touching any image', async () => {
    const segments = usePolygonStore().segments;
    const wrapper = mountPicker(segments);

    await wrapper.find('.create-row').trigger('click');

    expect(segments.segmentList.value).toHaveLength(1);
    expect(segments.selectedSegmentId.value).toBe(
      segments.segmentList.value[0].id
    );
  });

  it('names the create affordance after the noun it was given', () => {
    const wrapper = mountPicker(useRulerStore().segments);

    expect(wrapper.findComponent(ItemListStub).props('createText')).toBe(
      'New ruler'
    );
  });

  it('shows the ruler registry when given it, and only that', () => {
    useSegmentStore().segments.addSegment({ name: 'Tumor' });
    const rulers = useRulerStore().segments;

    const wrapper = mountPicker(rulers);

    expect(wrapper.findAll('.row-name').map((row) => row.text())).toEqual([
      'Ruler 1',
    ]);
  });

  it('leaves out everything scoped to the viewed image', () => {
    const rulers = useRulerStore().segments;

    const wrapper = mountPicker(rulers);

    expect(wrapper.find('[data-testid="reveal-segment-button"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="save-segments-button"]').exists()).toBe(
      false
    );
    expect(wrapper.findAll('.slider')).toHaveLength(0);
    expect(
      wrapper
        .findAll('i.icon')
        .map((icon) => icon.text().trim())
        .filter((name) => name.startsWith('mdi-lock'))
    ).toEqual([]);
  });

  it('renders without a viewed image, having nothing image-scoped to show', () => {
    const wrapper = mountPicker(useRulerStore().segments);

    expect(wrapper.find('[data-testid="ruler-list"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('No selected image');
  });

  it('deletes a segment by id', async () => {
    const rulers = useRulerStore().segments;
    const extra = rulers.addSegment({ name: 'Long axis' });
    const wrapper = mountPicker(rulers);
    await nextTick();

    const row = wrapper.find(`[data-id="${extra}"]`);
    const remove = row
      .findAll('button')
      .find((button) => button.attributes('data-icon') === 'mdi-delete');
    await remove!.trigger('click');

    expect(rulers.getSegment(extra)).toBeUndefined();
  });
});
