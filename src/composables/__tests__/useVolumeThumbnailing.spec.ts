import { describe, expect, it, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useVolumeThumbnailing } from '@/src/composables/useVolumeThumbnailing';
import type { createVolumeThumbnailer } from '@/src/core/thumbnailers/volume-thumbnailer';

type Thumbnailer = ReturnType<typeof createVolumeThumbnailer>;

// the real thumbnailer needs a WebGL context the test DOM cannot provide; none
// of its rendering surface is reached until an image loads, which this does not
function createStubThumbnailer() {
  let deleted = false;
  const thumbnailer = {
    delete() {
      deleted = true;
    },
  };
  return {
    thumbnailer: thumbnailer as unknown as Thumbnailer,
    isDeleted: () => deleted,
  };
}

describe('useVolumeThumbnailing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('disposes the thumbnailer when the component unmounts', () => {
    const stub = createStubThumbnailer();
    const component = defineComponent({
      setup() {
        useVolumeThumbnailing(64, () => stub.thumbnailer);
        return () => h('div');
      },
    });

    const wrapper = mount(component);
    expect(stub.isDeleted()).toBe(false);

    wrapper.unmount();

    expect(stub.isDeleted()).toBe(true);
  });
});
