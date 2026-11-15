/**
 * A byte array deque.
 */
export default class ByteDeque {
  private arrays: Uint8Array[] = [];
  private _size = 0;

  get size() {
    return this._size;
  }

  /**
   * Push a new Uint8Array to the end.
   */
  pushEnd(bytes: Uint8Array) {
    this.arrays.push(bytes);
    this._size += bytes.length;
  }

  /**
   * Push a new Uint8Array to the start.
   */
  pushStart(bytes: Uint8Array) {
    this.arrays.unshift(bytes);
    this._size += bytes.length;
  }

  /**
   * Pop <count> bytes off the start.
   */
  popStart(count: number): Uint8Array {
    return this.consumeStart(count, false) as Uint8Array;
  }

  /**
   * Erase <count> bytes off the start.
   *
   * This is more efficient than ignoring the return value of popStart
   * due to not allocating memory for the return result.
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
}
