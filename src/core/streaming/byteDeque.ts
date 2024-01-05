/**
 * A byte array deque.
 */
export default class ByteDeque {
  private arrays: Uint8Array[];
  private _size = 0;

  constructor() {
    this.arrays = [];
  }

  get size() {
    return this._size;
  }

  isEmpty() {
    return this.size === 0;
  }

  clear() {
    this.arrays.length = 0;
    this._size = 0;
  }

  /**
   * Push a new Uint8Array to the end.
   * @param {Uint8Array} bytes
   */
  pushEnd(bytes: Uint8Array) {
    this.arrays.push(bytes);
    this._size += bytes.length;
  }

  /**
   * Push the contents of a ByteDeque to the start.
   * @param {ByteDeque} bytes
   */
  pushStart(bytes: ByteDeque): void;

  /**
   * Push a new Uint8Array to the start.
   * @param {Uint8Array} bytes
   */
  pushStart(bytes: Uint8Array): void;

  pushStart(bytes: Uint8Array | ByteDeque) {
    if (bytes instanceof ByteDeque) {
      this.arrays.unshift(...bytes.arrays);
      this._size += bytes.size;
      bytes.clear();
    } else {
      this.arrays.unshift(bytes);
      this._size += bytes.length;
    }
  }

  /**
   * Pop <count> bytes off the end.
   * @param {number} count
   */
  popEnd(count: number): Uint8Array {
    return this.consumeEnd(count, false) as Uint8Array;
  }

  /**
   * Erase <count> bytes off the end.
   *
   * This is more efficient than ignoring the return value of popEnd
   * due to not allocating memory for the return result.
   * @param {number} count
   */
  eraseEnd(count: number): void {
    this.consumeEnd(count, true);
  }

  private consumeEnd(count: number, discard = false) {
    let processed = 0;
    const bufferSize = Math.min(count, this.size);
    const popped = discard ? null : new Uint8Array(bufferSize);
    let writeOffset = bufferSize;

    while (processed < count && this.arrays.length) {
      const bytes = this.arrays.pop()!;
      const remaining = count - processed;
      // chomp bytes[offset:]
      const offset = remaining >= bytes.length ? 0 : bytes.length - remaining;
      const takeEntireArray = offset === 0;

      if (popped) {
        const toSet = takeEntireArray ? bytes : bytes.subarray(offset);
        writeOffset -= toSet.length;
        popped.set(toSet, writeOffset);
      }

      if (!takeEntireArray) {
        // put back remainder
        this.arrays.push(bytes.subarray(0, offset));
      }

      processed += bytes.length - offset;
    }

    return popped ?? undefined;
  }

  /**
   * Pop <count> bytes off the start.
   * @param {number} count
   */
  popStart(count: number): Uint8Array {
    return this.consumeStart(count, false) as Uint8Array;
  }

  /**
   * Erase <count> bytes off the start.
   *
   * This is more efficient than ignoring the return value of popStart
   * due to not allocating memory for the return result.
   * @param {number} count
   */
  eraseStart(count: number): void {
    this.consumeStart(count, true);
  }

  private consumeStart(count: number, discard = false) {
    let processed = 0;
    const bufferSize = Math.min(count, this.size);
    const popped = discard ? null : new Uint8Array(bufferSize);
    let writeOffset = 0;

    while (processed < count && this.arrays.length) {
      const bytes = this.arrays.shift()!;
      const remaining = count - processed;
      // chomp bytes[:offset]
      const offset = Math.min(remaining, bytes.length);
      const takeEntireArray = offset === bytes.length;

      if (popped) {
        const toSet = takeEntireArray ? bytes : bytes.subarray(0, offset);
        popped.set(toSet, writeOffset);
        writeOffset += toSet.length;
      }

      if (!takeEntireArray) {
        // put back remainder
        this.arrays.unshift(bytes.subarray(offset));
      }

      processed += offset;
    }

    this._size = Math.max(0, this._size - count);
    return popped ?? undefined;
  }

  popAll(discard = false) {
    if (discard) {
      this.arrays.length = 0;
      return undefined;
    }
    return this.popStart(this.size);
  }
}
