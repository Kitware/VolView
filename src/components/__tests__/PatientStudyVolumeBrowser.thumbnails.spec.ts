import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import PatientStudyVolumeBrowser from '@/src/components/PatientStudyVolumeBrowser.vue';
import { Chunk } from '@/packages/dicom/core';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import type { DicomChunkImageInit } from '@/src/core/streaming/dicomChunkImage';
import { LoadedVtkImage } from '@/src/core/progressiveImage';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import { seatVolume } from '@/src/store/__tests__/datasetFixtures';
import { datasetFromTags } from '@/tests/dicomDataset';
import { defer } from '@/src/utils';

const messageTitles = () =>
  useMessageStore().messages.map((message) => message.title);

enableAutoUnmount(afterEach);

const Slot = defineComponent({ template: '<div><slot /></div>' });
const stubs = {
  GroupableItem: {
    template: '<div><slot :active="false" :select="() => {}" /></div>',
  },
  PersistentOverlay: Slot,
  VImg: {
    props: ['src'],
    template:
      '<div><img v-if="src" :src="src" /><slot v-else name="placeholder" /><slot /></div>',
  },
  VProgressCircular: { template: '<div role="progressbar" />' },
  VContainer: Slot,
  VRow: Slot,
  VCol: Slot,
  VCard: Slot,
  VCardText: Slot,
  VCheckbox: true,
  VBtn: Slot,
  VMenu: Slot,
  VList: Slot,
  VListItem: { template: '<button><slot /></button>' },
  VIcon: true,
  VTooltip: true,
  VSpacer: true,
};

function mountBrowser() {
  const dicom = useDICOMStore();
  const Host = defineComponent(() => () => {
    const volumeKeys = Object.keys(dicom.volumeInfo);
    return volumeKeys.length
      ? h(PatientStudyVolumeBrowser, { volumeKeys })
      : h('p', 'No volumes');
  });
  return mount(Host, { global: { stubs } });
}

const decoded = () => ({
  image: {
    size: [1, 1, 1],
    data: new Uint16Array([1]),
    imageType: { components: 1 },
  },
});

async function loadedChunk(z = 0) {
  const chunk = new Chunk({
    metaLoader: {
      meta: datasetFromTags(
        Object.entries({
          '00080060': 'CT',
          '00080018': `1.2.3.${z}`,
          '00200032': `0\\0\\${z}`,
          '0008103E': 'Pending volume',
          '00200011': '1',
          '0020000D': '1.2.3.4',
          '0020000E': '1.2.3.5',
          '00100020': 'patient',
          '00200037': '1\\0\\0\\0\\1\\0',
          '00280010': '1',
          '00280011': '1',
          '00280030': '1\\1',
          '00280101': '16',
          '00280103': '0',
        })
      ),
      load() {},
      stop() {},
    },
    dataLoader: { data: new Blob(['pixels']), load() {}, stop() {} },
  });
  await chunk.loadMeta();
  await chunk.loadData();
  return chunk;
}

async function importPendingThumbnail() {
  const chunk = await loadedChunk();
  type DecodeResult = Awaited<
    ReturnType<DicomChunkImageInit['readDicomImage']>
  >;
  const volume = defer<DecodeResult>();
  const thumbnail = defer<DecodeResult>();
  const started = defer<void>();
  const image = new DicomChunkImage({
    readDicomImage: (file) => {
      if (file.name === 'thumbnail.dcm') {
        started.resolve();
        return thumbnail.promise;
      }
      return volume.promise;
    },
    encodeThumbnail: () => 'data:image/png;base64,current',
  });
  const result = await useDICOMStore().importChunks([chunk], {
    createChunkImage: () => image,
  });
  onTestFinished(() => {
    volume.resolve(decoded());
    thumbnail.resolve(decoded());
  });
  return { id: Object.keys(result.volumes)[0], image, thumbnail, started };
}

function cacheImage(id: string) {
  const image = new LoadedVtkImage(vtkImageData.newInstance(), id);
  useImageCacheStore().addProgressiveImage(image, { id });
  return image;
}

describe('volume browser thumbnail lifetime', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(async () => {
    const cache = useImageCacheStore();
    [...cache.imageIds].forEach((id) => cache.removeImage(id));
    await flushPromises();
    vi.restoreAllMocks();
  });

  it('shows a decoded thumbnail', async () => {
    const { started, thumbnail } = await importPendingThumbnail();
    const wrapper = mountBrowser();
    await started.promise;
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true);

    thumbnail.resolve(decoded());
    await flushPromises();

    expect(wrapper.get('img').attributes('src')).toBe(
      'data:image/png;base64,current'
    );
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    expect(messageTitles()).toEqual([]);
  });

  it('shows the modality when no thumbnail is available', async () => {
    seatVolume('empty', { Modality: 'MR' });
    cacheImage('empty');
    const wrapper = mountBrowser();
    await flushPromises();

    expect(wrapper.get('.thumbnail-container').text()).toContain('MR');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    expect(messageTitles()).toEqual([]);
  });

  it('reports a current decode error and shows the modality', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { started, thumbnail } = await importPendingThumbnail();
    const wrapper = mountBrowser();
    await started.promise;

    thumbnail.reject(new Error('Decoder failed'));
    await flushPromises();

    expect(wrapper.get('.thumbnail-container').text()).toContain('CT');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    expect(messageTitles()).toEqual(['Failed to generate thumbnails']);
  });

  it.each([false, true])(
    'keeps Delete quiet during decoding when another volume remains: %s',
    async (keepBrowser) => {
      const { id, started, thumbnail } = await importPendingThumbnail();
      if (keepBrowser) {
        seatVolume('remaining');
        cacheImage('remaining');
      }
      const wrapper = mountBrowser();
      await started.promise;

      const card = wrapper
        .findAll('.volume-card')
        .find((item) => item.text().includes('Pending volume'))!;
      const deleteButton = card
        .findAll('button')
        .find((button) => button.text() === 'Delete')!;
      await deleteButton.trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('Pending volume');
      expect(wrapper.findComponent(PatientStudyVolumeBrowser).exists()).toBe(
        keepBrowser
      );
      expect(useDICOMStore().volumeInfo[id]).toBeUndefined();
      expect(useImageCacheStore().imageById[id]).toBeUndefined();
      expect(messageTitles()).toEqual([]);

      thumbnail.resolve(decoded());
      await flushPromises();
      expect(wrapper.find('img').exists()).toBe(false);
      expect(messageTitles()).toEqual([]);
    }
  );

  it.each(['stop', 'restore membership'])(
    'settles a thumbnail after %s cancels its original request',
    async (cancellation) => {
      const { image, started, thumbnail } = await importPendingThumbnail();
      const wrapper = mountBrowser();
      await started.promise;

      if (cancellation === 'stop') {
        image.stopLoad();
      } else {
        const chunks = image.getChunks().slice();
        const orientation = image.getOrientation();
        const reconstruction = image.getReconstruction() ?? undefined;
        await image.setChunks([...chunks, await loadedChunk(1)], orientation);
        await image.setChunks(chunks, orientation, reconstruction);
      }
      await flushPromises();

      if (cancellation === 'stop') {
        expect(wrapper.get('.thumbnail-container').text()).toContain('CT');
      } else {
        thumbnail.resolve(decoded());
        await flushPromises();
        expect(wrapper.get('img').attributes('src')).toBe(
          'data:image/png;base64,current'
        );
      }
      expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
      expect(messageTitles()).toEqual([]);
    }
  );

  it('ignores a decode failure after the browser unmounts', async () => {
    const { started, thumbnail } = await importPendingThumbnail();
    const wrapper = mountBrowser();
    await started.promise;

    wrapper.unmount();
    thumbnail.reject(new Error('Late decoder failure'));
    await flushPromises();

    expect(messageTitles()).toEqual([]);
  });

  it.each([
    ['image', 'success'],
    ['image', 'empty'],
    ['image', 'failure'],
    ['record', 'success'],
    ['record', 'empty'],
    ['record', 'failure'],
  ])(
    'keeps the replacement %s thumbnail after a late %s',
    async (replacement, outcome) => {
      seatVolume('volume');
      const image = cacheImage('volume');
      const pending = defer<string | null>();
      vi.spyOn(image, 'getThumbnail')
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue('data:image/png;base64,replacement');
      const wrapper = mountBrowser();

      if (replacement === 'image') {
        useImageCacheStore().removeImage('volume');
        vi.spyOn(cacheImage('volume'), 'getThumbnail').mockResolvedValue(
          'data:image/png;base64,replacement'
        );
      } else {
        seatVolume('volume', { Modality: 'MR' });
      }
      await flushPromises();
      expect(wrapper.get('img').attributes('src')).toBe(
        'data:image/png;base64,replacement'
      );

      if (outcome === 'failure') {
        pending.reject(new Error('Obsolete thumbnail failed'));
      } else {
        pending.resolve(
          outcome === 'empty' ? null : 'data:image/png;base64,obsolete'
        );
      }
      await flushPromises();
      expect(wrapper.get('img').attributes('src')).toBe(
        'data:image/png;base64,replacement'
      );
      expect(messageTitles()).toEqual([]);
    }
  );

  it('refreshes a completed thumbnail when its volume record changes', async () => {
    seatVolume('volume', { Modality: 'CT' });
    const image = cacheImage('volume');
    const thumbnail = vi
      .spyOn(image, 'getThumbnail')
      .mockResolvedValue('data:image/png;base64,previous');
    const wrapper = mountBrowser();
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe(
      'data:image/png;base64,previous'
    );

    thumbnail.mockResolvedValue(null);
    seatVolume('volume', { Modality: 'MR' });
    await flushPromises();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('.thumbnail-container').text()).toContain('MR');
  });
});
