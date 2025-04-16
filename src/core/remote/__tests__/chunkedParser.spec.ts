/**
 * For some reason, `new Uint8Array().buffer instanceof ArrayBuffer` is false under jsdom.
 * This may be due to conflicting ArrayBuffer impls.
 *
 * Use node env for now.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { PacketType, Packet } from 'socket.io-parser';
import { CHUNK_SIZE, Decoder, Encoder } from '@/src/core/remote/chunkedParser';

function makeBinaryPacket(): Packet {
  const N = 3;
  return {
    type: PacketType.EVENT,
    nsp: '/',
    data: [
      'rpc:call',
      {
        rpcId: '1',
        name: 'method',
        args: [
          {
            a: 'foo',
            b: 'bar',
            c: new Uint8Array(CHUNK_SIZE * N),
          },
        ],
      },
    ],
    id: 2,
  };
}

function makeStringPacket(): Packet {
  return {
    type: PacketType.EVENT,
    nsp: '/',
    data: [
      'rpc:result',
      {
        rpcid: '1',
        ok: true,
        data: Array(CHUNK_SIZE * 2).fill(4),
      },
    ],
  };
}

describe('Chunked Parser', () => {
  describe('ChunkedEncoder', () => {
    it('should encode a large binary packet', () => {
      const encoder = new Encoder();
      const msgs = encoder.encode(makeBinaryPacket());

      // chunk msg, string msg, 3 binary chunks
      expect(msgs).to.have.length(1 + 1 + 3);
    });

    it('should encode a large string packet', () => {
      const encoder = new Encoder();
      const msgs = encoder.encode(makeStringPacket());

      // chunk msg, 5 string msg chunks
      expect(msgs).to.have.length(1 + 5);
    });
  });

  describe('ChunkedDecoder', () => {
    function createDecoder() {
      const decoder = new Decoder();
      const promise = new Promise<Packet>((resolve) => {
        decoder.on('decoded', (packet) => {
          resolve(packet);
        });
      });
      return { decoder, promise };
    }

    it('should decode chunked binary messages', async () => {
      const binaryPacket = makeBinaryPacket();
      const encoder = new Encoder();
      const msgs = encoder.encode(binaryPacket).map((msg) => {
        if (ArrayBuffer.isView(msg)) {
          // make a slice copy, since the encoder produces views
          // over a single ArrayBuffer
          return msg.buffer.slice(
            msg.byteOffset,
            msg.byteOffset + msg.byteLength
          );
        }
        return msg;
      });

      const { decoder, promise } = createDecoder();
      msgs.forEach((msg) => {
        decoder.add(msg);
      });

      const packet = await promise;
      expect(packet.data[1].args[0].c.byteLength).to.equal(
        binaryPacket.data[1].args[0].c.byteLength
      );
    });

    it('should decode chunked string messages', async () => {
      const stringPacket = makeStringPacket();
      const encoder = new Encoder();
      const msgs = encoder.encode(stringPacket);

      const { decoder, promise } = createDecoder();
      msgs.forEach((msg) => {
        decoder.add(msg);
      });

      const packet = await promise;
      expect(packet).to.deep.equal(stringPacket);
    });
  });
});
