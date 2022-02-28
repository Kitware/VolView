import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { setActivePinia, createPinia } from 'pinia';

import {
  MessageType,
  PendingMessage,
  useMessageStore,
} from '@src/storex/messages';

chai.use(chaiAsPromised);

describe('Message store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('supports different kinds of messages', () => {
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
        type: MessageType.Error,
        contents: 'explicit error',
        error: null,
      },
      {
        type: MessageType.Error,
        contents: 'an error',
        error: innerError,
      },
      {
        type: MessageType.Warning,
        contents: 'warning',
      },
      {
        type: MessageType.Pending,
        contents: 'pending',
        progress: -1,
      },
      {
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
        new Promise((resolve) =>
          setTimeout(() => {
            expect(messageStore.messages).to.have.length(1);
            expect(messageStore.messages[0]).to.deep.equal({
              type: MessageType.Pending,
              progress: -1,
              contents: 'tasks message',
            });

            resolve('result');
          }, 5)
        )
    );

    expect(result).to.equal('result');
  });
});
