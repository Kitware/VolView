import { mount } from '@vue/test-utils';
import { getActivePinia } from 'pinia';
import { onTestFinished } from 'vitest';
import MessageCenter from '@/src/components/MessageCenter.vue';
import MessageItem from '@/src/components/MessageItem.vue';

const slot = { template: '<div><slot /></div>' };

export const mountMessageCenter = () => {
  const wrapper = mount(MessageCenter, {
    global: {
      plugins: [getActivePinia()!],
      stubs: {
        VCard: slot,
        VCardTitle: slot,
        VCardText: slot,
        VExpansionPanels: slot,
        VExpansionPanel: slot,
        VExpansionPanelTitle: slot,
        VExpansionPanelText: slot,
        VCheckbox: true,
        VBtn: { template: '<button><slot /></button>' },
        VIcon: slot,
      },
    },
  });
  onTestFinished(() => wrapper.unmount());
  return wrapper;
};

export const messageTitles = () =>
  mountMessageCenter()
    .findAll('.header > span')
    .map((title) => title.text());

export const messageDetails = (title: string) =>
  mountMessageCenter()
    .findAllComponents(MessageItem)
    .find((item) => item.get('.header > span').text() === title)
    ?.get('.details')
    .text();
