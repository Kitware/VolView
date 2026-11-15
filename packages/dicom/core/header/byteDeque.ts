/** A queue of byte chunks, consumed from the start. */
export default class ByteDeque {
  private arrays: Uint8Array[] = [];
  private _size = 0;

  get size() {
    return this._size;
  }

  pushEnd(bytes: Uint8Array) {
    this.arrays.push(bytes);
    this._size += bytes.length;
  }

  pushStart(bytes: Uint8Array) {
    this.arrays.unshift(bytes);
    this._size += bytes.length;
  }

  /** Removes up to `count` bytes off the start and returns them. */
  popStart(count: number) {
    const popped = new Uint8Array(Math.min(count, this.size));
    this.consumeStart(count, (bytes, offset) => popped.set(bytes, offset));
    return popped;
  }

  /** Removes up to `count` bytes off the start without copying them. */
  eraseStart(count: number) {
    this.consumeStart(count);
  }

  private consumeStart(
    count: number,
    copy?: (bytes: Uint8Array, offset: number) => void
  ) {
    let processed = 0;
    while (processed < count && this.arrays.length) {
      const bytes = this.arrays.shift()!;
      const taken = Math.min(count - processed, bytes.length);
      copy?.(bytes.subarray(0, taken), processed);
      if (taken < bytes.length) this.arrays.unshift(bytes.subarray(taken));
      processed += taken;
    }
    this._size = Math.max(0, this._size - count);
  }
}
