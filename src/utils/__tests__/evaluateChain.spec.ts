import { describe, it, expect } from 'vitest';
import { ChainHandler, Skip, evaluateChain } from '@/src/utils/evaluateChain';

function delayedMul(a: number, b: number) {
  return new Promise<number>((resolve) => {
    setTimeout(() => {
      resolve(a * b);
    }, 10);
  });
}

describe('evaluateChain', () => {
  it('should evaluate a chain of sync handlers', async () => {
    const chain: Array<ChainHandler<number, number>> = [
      (n) => (n < 5 ? n * 2 : Skip),
      (n) => (n < 10 ? n * 4 : Skip),
      (n) => (n < 15 ? n * 8 : Skip),
    ];

    await expect(evaluateChain(3, chain)).resolves.toEqual(6);
    await expect(evaluateChain(8, chain)).resolves.toEqual(32);
    await expect(evaluateChain(11, chain)).resolves.toEqual(88);
  });

  it('should evaluate a chain of async handlers', async () => {
    const chain: Array<ChainHandler<number, number>> = [
      (n) => (n < 5 ? delayedMul(n, 2) : Skip),
      (n) => (n < 10 ? delayedMul(n, 4) : Skip),
      (n) => (n < 15 ? delayedMul(n, 8) : Skip),
    ];

    await expect(evaluateChain(3, chain)).resolves.toEqual(6);
    await expect(evaluateChain(8, chain)).resolves.toEqual(32);
    await expect(evaluateChain(11, chain)).resolves.toEqual(88);
  });

  it('should throw if all handlers skip', async () => {
    const chain: Array<ChainHandler<number, number>> = [
      (n) => (n < 5 ? delayedMul(n, 2) : Skip),
      (n) => (n < 10 ? delayedMul(n, 4) : Skip),
      (n) => (n < 15 ? delayedMul(n, 8) : Skip),
    ];

    await expect(evaluateChain(20, chain)).rejects.toBeInstanceOf(Error);
  });
});
