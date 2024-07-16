import { describe, it } from 'vitest';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import Chai, { expect } from 'chai';
import { ChainHandler, Skip, evaluateChain } from '@/src/utils/evaluateChain';

Chai.use(chaiAsPromised);
Chai.use(sinonChai);

function delayedMul(a: number, b: number) {
  return new Promise<number>((resolve) => {
    setTimeout(() => {
      resolve(a * b);
    }, 10);
  });
}

describe('evaluateChain', () => {
  it('should evaluate a chain of sync handlers', () => {
    const chain: Array<ChainHandler<number, number>> = [
      (n) => (n < 5 ? n * 2 : Skip),
      (n) => (n < 10 ? n * 4 : Skip),
      (n) => (n < 15 ? n * 8 : Skip),
    ];

    expect(evaluateChain(3, chain)).to.eventually.equal(6);
    expect(evaluateChain(8, chain)).to.eventually.equal(32);
    expect(evaluateChain(11, chain)).to.eventually.equal(88);
  });

  it('should evaluate a chain of async handlers', () => {
    const chain: Array<ChainHandler<number, number>> = [
      (n) => (n < 5 ? delayedMul(n, 2) : Skip),
      (n) => (n < 10 ? delayedMul(n, 4) : Skip),
      (n) => (n < 15 ? delayedMul(n, 8) : Skip),
    ];

    expect(evaluateChain(3, chain)).to.eventually.equal(6);
    expect(evaluateChain(8, chain)).to.eventually.equal(32);
    expect(evaluateChain(11, chain)).to.eventually.equal(88);
  });

  it('should throw if all handlers skip', () => {
    const chain: Array<ChainHandler<number, number>> = [
      (n) => (n < 5 ? delayedMul(n, 2) : Skip),
      (n) => (n < 10 ? delayedMul(n, 4) : Skip),
      (n) => (n < 15 ? delayedMul(n, 8) : Skip),
    ];

    expect(evaluateChain(20, chain)).to.eventually.be.rejected;
  });
});
