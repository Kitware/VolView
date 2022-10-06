import Vue from 'vue';
import Vuetify from 'vuetify';
import { expect } from 'chai';
import { createLocalVue, mount } from '@vue/test-utils';

import ResizableNavDrawer, {
  RESIZE_CURSOR,
} from '@/src/components/ResizableNavDrawer.vue';

Vue.use(Vuetify);

const localVue = createLocalVue();

describe('ResizableNavDrawer.vue', () => {
  let vuetify;

  beforeEach(() => {
    vuetify = new Vuetify();
  });

  it('Body styles are applied correctly on resize', () => {
    const wrapper = mount(ResizableNavDrawer, { localVue, vuetify });

    wrapper.vm.startResize();
    expect(document.body.style.cursor).to.equal(RESIZE_CURSOR);
    expect(document.body.style.userSelect).to.equal('none');

    wrapper.vm.stopResize();
    expect(document.body.style.cursor).to.be.empty;
    expect(document.body.style.userSelect).to.be.empty;
  });
});
