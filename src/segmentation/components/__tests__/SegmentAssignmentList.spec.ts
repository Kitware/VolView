import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { enableAutoUnmount, mount } from '@vue/test-utils';

import SegmentAssignmentList from '@/src/segmentation/components/SegmentAssignmentList.vue';
import { useSegmentStore } from '@/src/segmentation/segments';
import { NO_NAME } from '@/src/constants';

enableAutoUnmount(afterEach);

const globalOptions = {
  stubs: {
    VList: { template: '<ul><slot /></ul>' },
    VListItem: {
      props: ['active'],
      template:
        '<li class="item" :aria-selected="active"><slot name="prepend" /><slot /></li>',
    },
    VListItemTitle: { template: '<span class="title"><slot /></span>' },
  },
};

describe('segment assignment list', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('titles an unnamed segment the way the segment list does', () => {
    const registry = useSegmentStore().segments;
    registry.mintSegment({ name: 'Tumor' });
    registry.mintSegment({ name: '' });

    const wrapper = mount(SegmentAssignmentList, { global: globalOptions });

    expect(wrapper.findAll('.title').map((title) => title.text())).toEqual([
      'Tumor',
      NO_NAME,
    ]);
  });

  it('marks the current segment and emits the chosen segment id', async () => {
    const registry = useSegmentStore().segments;
    const first = registry.mintSegment({ name: 'Tumor' });
    const second = registry.mintSegment({ name: 'Node' });
    const wrapper = mount(SegmentAssignmentList, {
      props: { segmentId: first },
      global: globalOptions,
    });
    const items = wrapper.findAll('.item');
    expect(items.map((item) => item.attributes('aria-selected'))).toEqual([
      'true',
      'false',
    ]);
    await items[1].trigger('click');
    expect(wrapper.emitted('select')).toEqual([[second]]);
  });
});
