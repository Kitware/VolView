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
      template: '<li class="item"><slot name="prepend" /><slot /></li>',
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
});
