/* eslint-disable max-classes-per-file */
/* eslint-disable class-methods-use-this */
import { Maybe } from '@/src/types';
import * as BaseParser from 'socket.io-parser';

import type { Packet } from 'socket.io-parser';

export const CHUNK_SIZE = 1 * 1024 * 1024;
export const CHUNKED_PACKET_TYPE = 'C';

function isBinary(obj: any) {
  return (
    obj instanceof ArrayBuffer ||
    ArrayBuffer.isView(obj) ||
    obj instanceof Blob ||
    obj instanceof File
  );
}

function getLength(obj: any): number {
  if (Number.isInteger(obj?.byteLength)) return obj.byteLength;
  if (Number.isInteger(obj?.length)) return obj.length;
  throw new Error('Cannot get obj length');
}

function allStringChunks(chunks: any[]): chunks is string[] {
  return chunks.every((chunk) => typeof chunk === 'string');
}

function allArrayBufferChunks(chunks: any[]): chunks is ArrayBuffer[] {
  return chunks.every((chunk) => chunk instanceof ArrayBuffer);
}

/**
 * Encodes a binary packet into fixed-sized chunk messages.
 *
 * The chunked encoder extends the default socket.io-parser protocol to support
 * chunked binary attachments. It should work with any protocol version, but has
 * only been tested with v5.
 *
 * This encoding adds an optional first message indicating that all subsequent
 * messages are chunked.
 *
 * [<chunking message>]
 * <socket.io string message>
 * [<binary attachments>...]
 *
 * The chunking message is a string message that starts with the char 'C' and
 * has the following format:
 *
 * `C<chunking info>`
 *
 * The format of <chunking info> is a flat array of integers:
 * [N1, N2, N3, ...]
 *
 * There are a total of M integers, for M messages. The ith integer tells
 * us how many messages should be concatenated together to re-form the ith
 * message.
 *
 * Chunking works on both string and binary messages.
 */
class ChunkedEncoder extends BaseParser.Encoder {
  encode(packet: Packet) {
    const messages = super.encode(packet);

    // All messages are smaller than the chunk size.
    // Skip wrapping the socket.io message with chunking.
    if (messages.every((m) => getLength(m) <= CHUNK_SIZE)) {
      return messages;
    }

    const output: any[] = [];
    const chunkedSizes: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const chunks = this.chunkMessage(msg);
      chunkedSizes.push(chunks.length);
      output.push(...chunks);
    }

    return [`${CHUNKED_PACKET_TYPE}${JSON.stringify(chunkedSizes)}`, ...output];
  }

  protected chunkMessage(msg: any) {
    if (typeof msg === 'string') {
      return this.chunkString(msg);
    }
    if (isBinary(msg)) {
      return this.chunkBinary(msg);
    }
    throw new TypeError('Cannot handle invalid message type');
  }

  protected chunkString(str: string) {
    const chunks: string[] = [];
    let offset = 0;
    while (offset < str.length) {
      const chunkEnd = Math.min(offset + CHUNK_SIZE, str.length);
      chunks.push(str.substring(offset, chunkEnd));
      offset = chunkEnd;
    }
    return chunks;
  }

  protected chunkBinary(binary: ArrayBufferView | ArrayBuffer | Blob | File) {
    if (ArrayBuffer.isView(binary) || binary instanceof ArrayBuffer) {
      const view =
        binary instanceof ArrayBuffer ? new Uint8Array(binary) : binary;
      const chunks: Uint8Array[] = [];
      const { buffer } = view;
      const end = view.byteOffset + view.byteLength;
      let offset = view.byteOffset;
      while (offset < end) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE, end);
        chunks.push(new Uint8Array(buffer, offset, chunkEnd - offset));
        offset = chunkEnd;
      }
      return chunks;
    }

    // Blob | File
    const chunks: Blob[] = [];
    let offset = 0;
    while (offset < binary.length) {
      const chunkEnd = Math.min(offset + CHUNK_SIZE, binary.length);
      chunks.push(binary.slice(offset, chunkEnd));
      offset += chunkEnd;
    }
    return chunks;
  }
}

class ChunkedDecoder extends BaseParser.Decoder {
  protected chunkingInfo: Maybe<number[]>;
  protected chunks: Array<string | Uint8Array> = [];

  add(obj: any): void {
    if (this.chunkingInfo?.length) {
      // process chunk
      this.chunks.push(obj);

      if (this.chunks.length === this.chunkingInfo[0]) {
        super.add(this.reconstructChunks(this.chunks));
        this.chunks.length = 0;
        this.chunkingInfo.shift();
      }

      if (this.chunkingInfo.length === 0) {
        // reset chunking state
        this.chunkingInfo = null;
      }
    } else if (
      typeof obj === 'string' &&
      obj.charAt(0) === CHUNKED_PACKET_TYPE
    ) {
      // chunking message
      if (obj.charAt(1) !== '[') {
        throw new Error('Failed to parse start of chunking info.');
      }
      this.chunkingInfo = this.parseChunkingInfo(obj.substring(1));
      this.chunks = [];
    } else {
      // let the parent take care of it.
      super.add(obj);
    }
  }

  protected parseChunkingInfo(serialized: string): number[] {
    try {
      const result = JSON.parse(serialized);
      if (!Array.isArray(result)) {
        throw new TypeError('Chunking info is not an array');
      }
      if (!result.every((item) => Number.isInteger(item))) {
        throw new TypeError('Chunking info is invalid');
      }
      return result as number[];
    } catch (err) {
      throw new Error('Failed to parse chunking info', { cause: err });
    }
  }

  protected reconstructChunks(chunks: Array<string | ArrayBuffer>) {
    if (!chunks.length) {
      throw new Error('Cannot reconstruct an empty chunk');
    }

    if (allStringChunks(chunks)) {
      return this.reconstructString(chunks);
    }
    if (allArrayBufferChunks(chunks)) {
      return this.reconstructBinary(chunks);
    }

    throw new TypeError('Received a set of unknown chunks');
  }

  protected reconstructString(chunks: string[]) {
    return chunks.join('');
  }

  protected reconstructBinary(chunks: ArrayBuffer[]) {
    const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const reconstructed = new Uint8Array(byteLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      reconstructed.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    });
    return reconstructed.buffer;
  }
}

export const Encoder = ChunkedEncoder;
export const Decoder = ChunkedDecoder;
