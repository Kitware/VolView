import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';

import SegmentTypeList from '@/src/components/SegmentTypeList.vue';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRulerStore } from '@/src/store/tools/rulers';
import type { SegmentTypeRegistry } from '@/src/store/tools/segmentTypeRegistry';

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
  emits: ['done', 'cancel', 'delete', 'update:name'],
  template: '<div class="type-editor" />',
});

const global = {
  stubs: {
    EditableChipList: ChipListStub,
    IsolatedDialog: { template: '<div><slot /></div>' },
    SegmentTypeEditor: EditorStub,
    VCard: { template: '<div><slot /></div>' },
    VCardSubtitle: { template: '<div><slot /></div>' },
    VContainer: { template: '<div><slot /></div>' },
    VBtn: {
      props: ['icon'],
      template: '<button :data-icon="icon" />',
    },
  },
};

const mountList = (registry: SegmentTypeRegistry) =>
  mount(SegmentTypeList, { props: { registry }, global });

describe('the segment type picker', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('lists every type in the registry it was given', async () => {
    const types = useSegmentTypeStore().types;
    const tumor = types.addType({ name: 'Tumor' });
    const node = types.addType({ name: 'Node' });
    await nextTick();

    const wrapper = mountList(usePolygonStore().types);

    expect(
      wrapper.findAll('[data-id]').map((row) => row.attributes('data-id'))
    ).toEqual([tumor, node]);
    expect(wrapper.findAll('.row-name').map((row) => row.text())).toEqual([
      'Tumor',
      'Node',
    ]);
  });

  it('offers editing for every type', () => {
    const types = usePolygonStore().types;
    types.addType({ name: 'Tumor' });

    const wrapper = mountList(types);

    expect(wrapper.find('[data-testid="edit-label-button"]').exists()).toBe(
      true
    );
  });

  it('adds a type without touching any image', async () => {
    const types = usePolygonStore().types;
    const wrapper = mountList(types);

    await wrapper.find('.create-chip').trigger('click');

    expect(types.typeList.value).toHaveLength(1);
    expect(types.selectedTypeId.value).toBe(types.typeList.value[0].id);
  });

  it('shows the ruler registry when given it, and only that', () => {
    useSegmentTypeStore().types.addType({ name: 'Tumor' });
    const rulers = useRulerStore().types;

    const wrapper = mountList(rulers);

    expect(wrapper.findAll('.row-name').map((row) => row.text())).toEqual([
      'Label 1',
    ]);
  });
});
