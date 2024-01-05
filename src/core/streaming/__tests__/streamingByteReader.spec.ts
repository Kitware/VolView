import StreamingByteReader from '@/src/core/streaming/streamingByteReader';
import { asCoroutine } from '@/src/utils';
import { describe, it, expect } from 'vitest';

describe('StreamingByteReader', () => {
  it('read() should handle small chunks', () => {
    const reader = new StreamingByteReader();
    const coro = asCoroutine(reader.read(10));

    let result = coro(new Uint8Array([1, 2, 3, 4, 5]));
    expect(result.done).to.be.false;

    result = coro(new Uint8Array([1, 2, 3, 4, 5]));
    expect(result.done).to.be.true;
    expect(result.value).to.eql(new Uint8Array([1, 2, 3, 4, 5, 1, 2, 3, 4, 5]));
  });

  it('read() should buffer large chunks', () => {
    const reader = new StreamingByteReader();
    const gen = reader.read(5);
    gen.next();

    let result = gen.next(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(result.done).to.be.true;
    expect(result.value).to.eql(new Uint8Array([1, 2, 3, 4, 5]));

    result = reader.read(5).next();
    expect(result.done).to.be.true;
    expect(result.value).to.eql(new Uint8Array([6, 7, 8, 9, 10]));
  });

  it('readAscii() should work', () => {
    const reader = new StreamingByteReader();
    const gen = reader.readAscii(4);
    gen.next();

    const result = gen.next(new Uint8Array([68, 73, 67, 77]));
    expect(result.done).to.be.true;
    expect(result.value).to.equal('DICM');
  });

  it('seek() should work', () => {
    const reader = new StreamingByteReader();
    const seekg = reader.seek(4);
    seekg.next();

    const seekres = seekg.next(new Uint8Array([1, 2, 3, 4, 5]));
    expect(seekres.done).to.be.true;
    expect(seekres.value).to.be.undefined;

    const readres = reader.read(1).next();
    expect(readres.done).to.be.true;
    expect(readres.value).to.eql(new Uint8Array([5]));
  });
});
