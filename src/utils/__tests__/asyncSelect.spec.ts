import { asyncSelect } from '@/src/utils/asyncSelect';
import { it, describe, expect } from 'vitest';

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('asyncSelect', () => {
  it('should act similar to Promise.race()', async () => {
    const promises = [sleep(11), sleep(1), sleep(111)];
    const { promise, index } = await asyncSelect(promises);
    await expect(promise).toEqual(promises[1]);
    expect(index).to.equal(1);
  });

  it('should return the rest of the unselected promises', async () => {
    const promises = [sleep(1), sleep(11), sleep(111)];
    const { rest } = await asyncSelect(promises);
    expect(rest).to.deep.equal(promises.slice(1));
  });

  it('should handle rejected promises', async () => {
    const promises = [
      sleep(11),
      sleep(1),
      sleep(111),
      new Promise((resolve, reject) => {
        reject(new Error('Error'));
      }),
    ];
    const { promise, index } = await asyncSelect(promises);
    await expect(promise).rejects.toBeInstanceOf(Error);
    expect(index).to.equal(3);
  });
});
