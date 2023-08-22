/* eslint-disable no-param-reassign */
import { HistoryManager } from '@/src/core/history';
import { expect } from 'chai';
import { describe, it } from 'vitest';

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

describe('History', () => {
  it('should apply a series of pushed operations', () => {
    const collection: Collection = Object.create(null);

    const op1 = createOperation(collection, 'dog', 'border collie');
    const op2 = createOperation(collection, 'cat', 'orange');
    const op3 = createOperation(collection, 'tree', 'willow');

    const manager = new HistoryManager();
    manager.pushOperation(op1, true);
    manager.pushOperation(op2, true);
    manager.pushOperation(op3, true);

    expect(collection).to.deep.equal({
      dog: 'border collie',
      cat: 'orange',
      tree: 'willow',
    });

    manager.undo();
    manager.undo();
    expect(collection).to.deep.equal({
      dog: 'border collie',
    });

    manager.redo();
    expect(collection).to.deep.equal({
      dog: 'border collie',
      cat: 'orange',
    });

    manager.undo();
    const op4 = createOperation(collection, 'cloud', 'cumulus');
    manager.pushOperation(op4, true);
    expect(collection).to.deep.equal({
      dog: 'border collie',
      cloud: 'cumulus',
    });

    manager.redo();
    expect(collection).to.deep.equal({
      dog: 'border collie',
      cloud: 'cumulus',
    });
  });

  it('should support finite history', () => {
    const collection: Collection = Object.create(null);

    const op1 = createOperation(collection, 'dog', 'border collie');
    const op2 = createOperation(collection, 'cat', 'orange');
    const op3 = createOperation(collection, 'tree', 'willow');

    const manager = new HistoryManager(2);
    manager.pushOperation(op1, true);
    manager.pushOperation(op2, true);
    manager.pushOperation(op3, true);

    expect(collection).to.deep.equal({
      dog: 'border collie',
      cat: 'orange',
      tree: 'willow',
    });

    manager.undo();
    manager.undo();
    expect(collection).to.deep.equal({
      dog: 'border collie',
    });

    // no more history past 2 undos
    manager.undo();
    expect(collection).to.deep.equal({
      dog: 'border collie',
    });
  });
});
