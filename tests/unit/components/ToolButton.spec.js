import { expect } from 'chai';
import { shallowMount } from '@vue/test-utils';

import ToolButton from '@/src/components/ToolButton.vue';

describe('ToolButton.vue', () => {
  const propsData = {
    size: '80',
    name: 'TEST BUTTON',
    icon: 'test-icon',
  };

  it('renders in name', () => {
    const wrapper = shallowMount(ToolButton, { propsData });
    expect(wrapper.text()).to.equal(propsData.name);
  });

  it('computes icon size', () => {
    const wrapper = shallowMount(ToolButton, { propsData });
    expect(wrapper.vm.iconSize).to.equal(48);
  });

  it('computes the button class spec correctly', () => {
    let props; let
      wrapper;

    props = { ...propsData, buttonClass: 'c1 c2 c3' };
    wrapper = shallowMount(ToolButton, { propsData: props });
    expect(wrapper.vm.classV).to.equal('c1 c2 c3');

    props = { ...propsData, buttonClass: ['c1', 'c2', 'c3'] };
    wrapper = shallowMount(ToolButton, { propsData: props });
    expect(wrapper.vm.classV).to.equal('c1 c2 c3');

    props = {
      ...propsData,
      buttonClass: {
        c1: true,
        c2: true,
        c3: false,
      },
    };
    wrapper = shallowMount(ToolButton, { propsData: props });
    expect(wrapper.vm.classV).to.equal('c1 c2');
  });
});
