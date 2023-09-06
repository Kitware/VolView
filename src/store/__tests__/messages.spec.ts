import { describe, it, beforeEach } from 'vitest';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { setActivePinia, createPinia } from 'pinia';

import { MessageType, useMessageStore } from '@/src/store/messages';

chai.use(chaiAsPromised);

describe('Message store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('supports adding, accessing, and deleting messages', () => {
    const messageStore = useMessageStore();

    const innerError = new Error('inner error');
    const ids = [
      messageStore.addError('an error', innerError),
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
          details: String(innerError),
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
      expect(messageStore.byID[id]).to.deep.equal(expected[index]);
    });

    messageStore.clearOne(ids[1]);
    expect(messageStore.byID).to.not.have.property(ids[1]);

    messageStore.clearAll();
    expect(messageStore.messages).to.be.empty;
  });
});
