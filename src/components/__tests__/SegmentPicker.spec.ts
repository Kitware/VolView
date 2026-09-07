import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';

import SegmentPicker from '@/src/components/SegmentPicker.vue';
import { useSegmentStore } from '@/src/store/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRulerStore } from '@/src/store/tools/rulers';
import type { SegmentRegistry } from '@/src/store/tools/segmentRegistry';

const ChipListStub = defineComponent({
  name: 'EditableChipList',
  props: ['items', 'modelValue'],
  emits: ['update:model-value', 'create'],
  template: `
    <div>
      <div v-for="item in items" :key="item.id" :data-id="item.id">
        <span class="row-name">{{ item.name }}</span>
        <slot name="item-append" :key="item.id" :item="item" />
      </div>
      <button class="create-chip" @click="$emit('create')" />
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
  template: '<div class="type-editor" />',
});

const global = {
  stubs: {
    EditableChipList: ChipListStub,
    IsolatedDialog: { template: '<div><slot /></div>' },
    SegmentEditor: EditorStub,
    VCard: { template: '<div><slot /></div>' },
    VCardSubtitle: { template: '<div><slot /></div>' },
    VContainer: { template: '<div><slot /></div>' },
    VBtn: {
      props: ['icon'],
      template: '<button :data-icon="icon" />',
    },
  },
};

const mountList = (registry: SegmentRegistry) =>
  mount(SegmentPicker, { props: { registry }, global });

describe('the segment type picker', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('lists every type in the registry it was given', async () => {
    const segments = useSegmentStore().segments;
    const tumor = segments.addSegment({ name: 'Tumor' });
    const node = segments.addSegment({ name: 'Node' });
    await nextTick();

    const wrapper = mountList(usePolygonStore().segments);

    expect(
      wrapper.findAll('[data-id]').map((row) => row.attributes('data-id'))
    ).toEqual([tumor, node]);
    expect(wrapper.findAll('.row-name').map((row) => row.text())).toEqual([
      'Tumor',
      'Node',
    ]);
  });

  it('offers editing for every type', () => {
    const segments = usePolygonStore().segments;
    segments.addSegment({ name: 'Tumor' });

    const wrapper = mountList(segments);

    expect(wrapper.find('[data-testid="edit-label-button"]').exists()).toBe(
      true
    );
  });

  it('adds a type without touching any image', async () => {
    const segments = usePolygonStore().segments;
    const wrapper = mountList(segments);

    await wrapper.find('.create-chip').trigger('click');

    expect(segments.segmentList.value).toHaveLength(1);
    expect(segments.selectedSegmentId.value).toBe(
      segments.segmentList.value[0].id
    );
  });

  it('shows the ruler registry when given it, and only that', () => {
    useSegmentStore().segments.addSegment({ name: 'Tumor' });
    const rulers = useRulerStore().segments;

    const wrapper = mountList(rulers);

    expect(wrapper.findAll('.row-name').map((row) => row.text())).toEqual([
      'Label 1',
    ]);
  });
});
