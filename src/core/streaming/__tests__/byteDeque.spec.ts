import ByteDeque from '@/src/core/streaming/byteDeque';
import { describe, it, expect } from 'vitest';

describe('ByteDeque', () => {
  it('pushStart/pushEnd() should work', () => {
    const dq = new ByteDeque();

    dq.pushEnd(new Uint8Array([4, 5, 6]));
    expect(dq.size).to.equal(3);

    dq.pushEnd(new Uint8Array([7, 8, 9]));
    expect(dq.size).to.equal(6);

    dq.pushStart(new Uint8Array([1, 2, 3]));
    expect(dq.size).to.equal(9);

    const data = dq.popAll();
    expect(data).to.eql(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  it('popStart() should work', () => {
    const dq = new ByteDeque();

    dq.pushEnd(new Uint8Array([1, 2, 3, 4, 5]));
    dq.pushEnd(new Uint8Array([6, 7, 8, 9]));

    let data = dq.popStart(7);
    expect(data).to.eql(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));

    data = dq.popStart(2);
    expect(data).to.eql(new Uint8Array([8, 9]));
  });

  it('popEnd() should work', () => {
    const dq = new ByteDeque();

    dq.pushEnd(new Uint8Array([1, 2, 3, 4, 5]));
    expect(dq.size).to.equal(5);

    dq.pushEnd(new Uint8Array([6, 7, 8, 9]));
    expect(dq.size).to.equal(9);

    let data = dq.popEnd(7);
    expect(data).to.eql(new Uint8Array([3, 4, 5, 6, 7, 8, 9]));

    data = dq.popEnd(2);
    expect(data).to.eql(new Uint8Array([1, 2]));
  });

  it('popStart() consumes the remainder', () => {
    const dq = new ByteDeque();

    dq.pushEnd(new Uint8Array([1, 2, 3]));
    dq.pushEnd(new Uint8Array([4, 5, 6]));

    const data = dq.popStart(10);
    expect(data).to.eql(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('popEnd() consumes the remainder', () => {
    const dq = new ByteDeque();

    dq.pushEnd(new Uint8Array([1, 2, 3]));
    dq.pushEnd(new Uint8Array([4, 5, 6]));

    const data = dq.popEnd(10);
    expect(data).to.eql(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('clear() clears the deque', () => {
    const dq = new ByteDeque();
    dq.pushStart(new Uint8Array([1, 2, 3, 4, 5]));
    expect(dq.isEmpty()).to.be.false;

    dq.clear();
    expect(dq.size).to.equal(0);
    expect(dq.isEmpty()).to.be.true;
  });
});
