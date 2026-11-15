import ByteDeque from './byteDeque';
import { toAscii } from '../utils';

/** Reads values off a byte stream that a generator's caller feeds chunk by chunk. */
export default class StreamingByteReader {
  private leftover = new ByteDeque();
  private pos = 0;

  get position() {
    return this.pos;
  }

  /** Seeks along the byte stream. No negative values. */
  *seek(offset: number) {
    if (offset < 0) {
      throw new Error('Offset must not be negative');
    }

    while (this.leftover.size < offset) {
      this.leftover.pushEnd(yield);
    }

    this.leftover.eraseStart(offset);
    this.pos += offset;
  }

  /** Reads a number of bytes. */
  *read(
    length: number,
    { peek = false } = {}
  ): Generator<undefined, Uint8Array, Uint8Array> {
    if (length < 0) {
      throw new Error('Length must be a positive number');
    }
    if (length === 0) return new Uint8Array();

    while (this.leftover.size < length) {
      this.leftover.pushEnd(yield);
    }

    const data = this.leftover.popStart(length);

    if (peek) {
      this.leftover.pushStart(data);
    } else {
      this.pos += length;
    }

    return data;
  }

  *readAscii(length: number) {
    return toAscii(yield* this.read(length));
  }

  /** `length` must be the length associated with the method. */
  private *readDataView(
    method: 'getUint16' | 'getUint32',
    length: number,
    littleEndian: boolean
  ) {
    const bytes = yield* this.read(length);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return dv[method](0, littleEndian);
  }

  *readUint16({ littleEndian = false } = {}) {
    return yield* this.readDataView('getUint16', 2, littleEndian);
  }

  *readUint32({ littleEndian = false } = {}) {
    return yield* this.readDataView('getUint32', 4, littleEndian);
  }
}
