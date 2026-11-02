import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createVuetify } from 'vuetify';

import EditableItemList from '@/src/components/EditableItemList.vue';

enableAutoUnmount(afterEach);

describe('creating an item', () => {
  it('uses a disabled native button until the blocking reason clears', async () => {
    const wrapper = mount(EditableItemList, {
      props: {
        items: [],
        modelValue: undefined,
        createText: 'New segment',
        createReason: 'Select an image to edit segments',
        reorderHint: 'Drag to reorder',
      },
      global: { plugins: [createVuetify()] },
    });
    const button = wrapper.get<HTMLButtonElement>('.create-row');

    expect(button.element.tagName).toBe('BUTTON');
    expect(button.element.disabled).toBe(true);
    button.element.click();
    button.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted('create')).toBeUndefined();

    await wrapper.setProps({ createReason: '' });
    expect(button.element.disabled).toBe(false);
    button.element.click();
    expect(wrapper.emitted('create')).toEqual([[]]);
  });
});
