import ByteDeque from './byteDeque';
import { toAscii } from '../utils';

/**
 * StreamingByteReader
 *
 * Expects Uint8Array inputs
 */
export default class StreamingByteReader {
  protected leftover: ByteDeque;
  protected pos = 0;

  constructor() {
    this.leftover = new ByteDeque();
  }

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

  /** Reads an ASCII string. */
  *readAscii(length: number, { ignoreNulls = false, peek = false } = {}) {
    const bytes = yield* this.read(length, { peek });
    return toAscii(bytes, { ignoreNulls });
  }

  /** `length` must be the length associated with the method. */
  private *readDataView(
    method: 'getUint16' | 'getUint32',
    length: number,
    { littleEndian = false, peek = false } = {}
  ) {
    const bytes = yield* this.read(length, { peek });
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return dv[method](0, littleEndian);
  }

  *readUint16(opts = {}) {
    return yield* this.readDataView('getUint16', 2, opts);
  }

  *readUint32(opts = {}) {
    return yield* this.readDataView('getUint32', 4, opts);
  }
}
