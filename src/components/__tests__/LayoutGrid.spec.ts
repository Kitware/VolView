import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, onMounted, onUnmounted } from 'vue';
import LayoutGrid from '@/src/components/LayoutGrid.vue';
import { useViewStore } from '@/src/store/views';

describe('LayoutGrid viewer identity', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('keeps existing viewers mounted through nested splits and closing a peer', async () => {
    const mounted: string[] = [];
    const unmounted: string[] = [];
    const Viewer = defineComponent({
      props: { viewId: { type: String, required: true } },
      setup(props) {
        onMounted(() => mounted.push(props.viewId));
        onUnmounted(() => unmounted.push(props.viewId));
      },
      template: '<div :data-view-id="viewId" />',
    });
    const store = useViewStore();
    store.setLayoutFromGrid([2, 1]);
    const [left, right] = store.layoutViews;
    const wrapper = mount(LayoutGrid, {
      props: { layout: store.visibleLayout },
      global: { stubs: { LayoutGridItem: Viewer } },
    });
    const update = () => wrapper.setProps({ layout: store.visibleLayout });
    const originals = wrapper
      .findAll('[data-view-id]')
      .map((view) => view.element);
    const extra = store.splitView(right.id, 'column')!;
    await update();
    expect(mounted).toEqual([left.id, right.id, extra]);
    expect(unmounted).toEqual([]);
    expect(
      wrapper
        .findAll('[data-view-id]')
        .slice(0, 2)
        .map((view) => view.element)
    ).toEqual(originals);
    expect(
      wrapper.find(`[data-view-id="${extra}"]`).attributes('style')
    ).toContain('top: 50%');
    const nested = store.splitView(extra, 'row')!;
    await update();
    expect(mounted).toContain(nested);
    expect(unmounted).toEqual([]);
    store.closeView(extra);
    await update();
    expect(unmounted).toEqual([extra]);
    expect(
      wrapper
        .findAll('[data-view-id]')
        .map((view) => view.attributes('data-view-id'))
    ).toEqual([left.id, right.id, nested]);
    await nextTick();
    wrapper.unmount();
  });
});
