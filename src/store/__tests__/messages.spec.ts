import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { setActivePinia, createPinia } from 'pinia';

import {
  MessageType,
  PendingMessage,
  useMessageStore,
} from '@src/store/messages';

chai.use(chaiAsPromised);

describe('Message store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('supports adding, accessing, and deleting messages', () => {
    const messageStore = useMessageStore();

    const innerError = new Error('inner error');
    const ids = [
      messageStore.addError('explicit error'),
      messageStore.addError('an error', innerError),
      messageStore.addWarning('warning'),
      messageStore.addPending('pending'),
      messageStore.addInfo('info'),
    ];

    const expected = [
      {
        id: '1',
        type: MessageType.Error,
        contents: 'explicit error',
        error: null,
      },
      {
        id: '2',
        type: MessageType.Error,
        contents: 'an error',
        error: innerError,
      },
      {
        id: '3',
        type: MessageType.Warning,
        contents: 'warning',
      },
      {
        id: '4',
        type: MessageType.Pending,
        contents: 'pending',
        progress: Infinity,
      },
      {
        id: '5',
        type: MessageType.Info,
        contents: 'info',
      },
    ];

    expect(messageStore.messages).to.have.length(5);

    ids.forEach((id, index) => {
      expect(messageStore.byID[id]).to.deep.equal(expected[index]);
    });

    messageStore.clearOne(ids[1]);
    expect(messageStore.byID).to.not.have.property(ids[1]);

    messageStore.clearAll();
    expect(messageStore.messages).to.be.empty;
  });

  it('supports updating pending progress', () => {
    const messageStore = useMessageStore();

    const id = messageStore.addPending('pending', 0);
    expect((messageStore.byID[id] as PendingMessage).progress).to.equal(0);

    messageStore.updatePendingProgress(id, 0.5);
    expect((messageStore.byID[id] as PendingMessage).progress).to.equal(0.5);

    messageStore.updatePendingProgress(id, 1);
    expect((messageStore.byID[id] as PendingMessage).progress).to.equal(1);
  });

  it('has a runTask helper', async () => {
    const messageStore = useMessageStore();

    const result = await messageStore.runTaskWithMessage(
      'tasks message',
      async () =>
        new Promise((resolve) => {
          setTimeout(() => {
            expect(messageStore.messages).to.have.length(1);
            expect(messageStore.messages[0]).to.deep.equal({
              id: '1',
              type: MessageType.Pending,
              progress: Infinity,
              contents: 'tasks message',
            });

            resolve('result');
          }, 5);
        })
    );

    expect(result).to.equal('result');
  });
});
