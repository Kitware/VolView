/* eslint-disable no-param-reassign */
import useHistoryStore from '@/src/store/history';
import { expect } from 'chai';
import { createPinia, setActivePinia } from 'pinia';
import { it, beforeEach, describe } from 'vitest';

interface Collection {
  [x: string]: string;
}

function createOperation(target: Collection, key: string, value: string) {
  const notApplied = Symbol('not applied');
  let old: any = notApplied;

  const isApplied = () => old !== notApplied;

  const apply = () => {
    if (isApplied()) return;
    old = target[key];
    target[key] = value;
  };

  const revert = () => {
    if (!isApplied()) return;
    if (old === undefined) {
      delete target[key];
    } else {
      target[key] = old;
    }
    old = notApplied;
  };

  return { isApplied, apply, revert };
}

describe('History store', () => {
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
  });

  it('should record history', () => {
    const store = useHistoryStore();
    const collection: Collection = Object.create(null);

    const ops = [
      createOperation(collection, 'fowl', 'dove'),
      createOperation(collection, 'dinosaur', 'stegosaurus'),
    ];

    ops.forEach((op) => store.pushOperation({ datasetID: '1' }, op, true));

    expect(collection).to.deep.equal({
      fowl: 'dove',
      dinosaur: 'stegosaurus',
    });

    store.undo({ datasetID: '1' });
    expect(collection).to.deep.equal({
      fowl: 'dove',
    });

    store.redo({ datasetID: '2' });
    store.undo({ datasetID: '2' });
    expect(collection).to.deep.equal({
      fowl: 'dove',
    });
  });
});
