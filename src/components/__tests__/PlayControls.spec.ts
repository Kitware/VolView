import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentPublicInstance, nextTick, ref } from 'vue';
import PlayControls from '@/src/components/PlayControls.vue';

type PlayControlsProps = { viewId: string; imageId: string | null };
type PlayControlsWrapper = VueWrapper<
  ComponentPublicInstance<PlayControlsProps>
>;

vi.mock('@/src/core/cine/isCineImage', () => ({
  getCineImage: (imageId: string | null) => {
    const frameTimesByImageId: Record<string, number> = {
      'image-1': 50,
      'image-2': 25,
    };

    return imageId
      ? {
          header: {
            frameTimeMs: frameTimesByImageId[imageId] ?? 40,
          },
        }
      : null;
  },
}));

vi.mock('@/src/composables/useSliceConfig', () => ({
  useSliceConfig: () => ({
    slice: ref(0),
    range: ref([0, 2]),
  }),
}));

describe('PlayControls', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves playback state when the controls remount', async () => {
    const props = {
      viewId: 'view-1',
      imageId: 'image-1',
    };
    const mountControls = () =>
      mount(PlayControls, {
        props,
        global: {
          stubs: {
            'v-icon': true,
          },
        },
      });

    const wrapper = mountControls();
    await wrapper.get('button').trigger('click');
    await wrapper.get('input').setValue('17');

    expect(wrapper.get('button').attributes('aria-pressed')).toBe('true');
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('17');

    wrapper.unmount();

    const remounted = mountControls();
    await nextTick();

    expect(remounted.get('button').attributes('aria-pressed')).toBe('true');
    expect((remounted.get('input').element as HTMLInputElement).value).toBe(
      '17'
    );

    remounted.unmount();
  });

  it('preserves frame-time-derived FPS defaults when switching images', async () => {
    const wrapper = mount(PlayControls, {
      props: {
        viewId: 'view-1',
        imageId: 'image-1',
      },
      global: {
        stubs: {
          'v-icon': true,
        },
      },
    }) as unknown as PlayControlsWrapper;

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('20');

    await wrapper.setProps({ imageId: 'image-2' });

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('40');

    await wrapper.setProps({ imageId: 'image-1' });

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('20');

    wrapper.unmount();
  });
});
