import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { createVuetify } from 'vuetify';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';
import WindowLevelControls from '@/src/components/tools/windowing/WindowLevelControls.vue';
import { useViewStore } from '@/src/store/views';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('visualViewport', null);
});
afterEach(() => vi.unstubAllGlobals());
enableAutoUnmount(afterEach);

it('lets keyboard users read the unavailable En face reason', async () => {
  const views = useViewStore();
  const view = views.layoutViews[0];
  const wrapper = mount(ViewTypeSwitcher, {
    attachTo: document.body,
    props: { viewId: view.id, imageId: null },
    global: { plugins: [createVuetify()] },
  });
  await wrapper.get('.v-field').trigger('mousedown');
  await nextTick();
  const option = Array.from(document.querySelectorAll('[role="option"]')).find(
    (element) => element.textContent?.trim() === 'En face'
  )!;
  expect(option.classList.contains('v-list-item--disabled')).toBe(true);
  const activator = option.parentElement!;
  expect(activator.tabIndex).toBe(0);
  expect(activator.hasAttribute('title')).toBe(false);
  activator.focus();
  await vi.waitFor(() => {
    const tooltip = document.getElementById(
      activator.getAttribute('aria-describedby')!
    );
    expect(tooltip?.textContent).toBe(
      'Load a grayscale 3D volume to use En face.'
    );
  });
  option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await nextTick();
  expect(wrapper.get('.v-select__selection-text').text()).toBe(view.name);
});

it('explains Reset contrast when its image is removed while controls are open', async () => {
  const views = useViewStore();
  const view = views.layoutViews[0];
  views.setActiveView(view.id);
  views.setDataForView(view.id, 'image');
  const wrapper = mount(WindowLevelControls, {
    attachTo: document.body,
    global: { plugins: [createVuetify()] },
  });
  const reset = wrapper.get('[data-testid="reset-contrast"]');
  expect(reset.attributes('disabled')).toBeUndefined();
  views.setDataForView(view.id, null);
  await nextTick();
  expect(reset.attributes('disabled')).toBeDefined();
  const activator = reset.element.parentElement!;
  expect(activator.tabIndex).toBe(0);
  activator.focus();
  await vi.waitFor(() => {
    const tooltip = document.getElementById(
      activator.getAttribute('aria-describedby')!
    );
    expect(tooltip?.textContent).toBe(
      'Load an image in this view to reset contrast.'
    );
  });
});
