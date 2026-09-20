import { describe, it, beforeEach, expect } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useImageStore } from '@/src/store/datasets-images';
import { useImageCacheStore } from '@/src/store/image-cache';
import { MessageType, useMessageStore } from '@/src/store/messages';

describe('Message store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('supports adding, accessing, and deleting messages', () => {
    const messageStore = useMessageStore();

    const innerError = new Error('inner error');
    const ids = [
      messageStore.addError('an error', { error: innerError }),
      messageStore.addWarning('warning'),
      messageStore.addInfo('info'),
      messageStore.addInfo('loading', {
        details: 'Loading files',
        persist: true,
      }),
    ];

    const expected = [
      {
        type: MessageType.Error,
        title: 'an error',
        options: {
          details: innerError.stack ?? String(innerError),
          persist: false,
        },
      },
      {
        type: MessageType.Warning,
        title: 'warning',
        options: {
          persist: false,
        },
      },
      {
        type: MessageType.Info,
        title: 'info',
        options: {
          persist: false,
        },
      },
      {
        type: MessageType.Info,
        title: 'loading',
        options: {
          details: 'Loading files',
          persist: true,
        },
      },
    ].map((ex, i) => ({ ...ex, id: String(i + 1) }));

    expect(messageStore.messages).to.have.length(4);

    ids.forEach((id, index) => {
      expect(messageStore.byID[id]).toMatchObject(expected[index]);
    });

    messageStore.clearOne(ids[1]);
    expect(messageStore.byID).to.not.have.property(ids[1]);

    messageStore.clearAll();
    expect(messageStore.messages).to.be.empty;
  });

  it('still reports an error when a dataset image was disposed', async () => {
    // addError builds a bug report from the image cache, so a dataset the
    // cache can no longer read must not cost the user the message itself.
    const image = vtkImageData.newInstance();
    image.setDimensions(2, 2, 2);
    image.getPointData().setScalars(
      vtkDataArray.newInstance({
        name: 'scalars',
        numberOfComponents: 1,
        values: new Uint8Array(8),
      })
    );
    useImageStore().addVTKImageData('CT', image, { id: 'img-1' });
    await nextTick();
    useImageCacheStore().imageById['img-1'].dispose();

    const messageStore = useMessageStore();
    messageStore.addError('an error', { error: new Error('boom') });

    expect(messageStore.messages).toHaveLength(1);
    expect(messageStore.messages[0].title).toBe('an error');
  });
});
