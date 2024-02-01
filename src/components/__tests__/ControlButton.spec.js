import { describe, it } from 'vitest';
import { expect } from 'chai';
import { shallowMount } from '@vue/test-utils';

import ControlButton from '@/src/components/ControlButton.vue';

describe('ControlButton.vue', () => {
  const propsData = {
    size: '80',
    name: 'TEST BUTTON',
    icon: 'test-icon',
  };

  it('computes icon size', () => {
    const wrapper = shallowMount(ControlButton, { propsData });
    expect(wrapper.vm.iconSize).to.equal(48);
  });

  it('computes the button class spec correctly', () => {
    let props;
    let wrapper;

    props = { ...propsData, buttonClass: 'c1 c2 c3' };
    wrapper = shallowMount(ControlButton, { propsData: props });
    expect(wrapper.vm.classV).to.equal('c1 c2 c3');

    props = { ...propsData, buttonClass: ['c1', 'c2', 'c3'] };
    wrapper = shallowMount(ControlButton, { propsData: props });
    expect(wrapper.vm.classV).to.equal('c1 c2 c3');

    props = {
      ...propsData,
      buttonClass: {
        c1: true,
        c2: true,
        c3: false,
      },
    };
    wrapper = shallowMount(ControlButton, { propsData: props });
    expect(wrapper.vm.classV).to.equal('c1 c2');
  });
});
