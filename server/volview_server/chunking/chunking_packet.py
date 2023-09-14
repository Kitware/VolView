import json
from typing import List, Union

from socketio.packet import Packet

CHUNK_SIZE = 1 * 1024 * 1024
CHUNKED_PACKET_TYPE = "C"

EncodedMessage = Union[str, bytes]


class ChunkedPacket(Packet):
    """A socket.io packet that chunks packets.

    The chunked encoder extends the default socket.io-parser protocol to support
    chunked binary attachments. It should work with any protocol version, but has
    only been tested with v5.

    This encoding adds an optional first message indicating that all subsequent
    messages are chunked.

    [<chunking message>]
    <socket.io string message>
    [<binary attachments>...]

    The chunking message is a string message that starts with the char 'C' and
    has the following format:

    `C<chunking info>`

    The format of <chunking info> is a flat array of integers:
    [N1, N2, N3, ...]

    There are a total of M integers, for M messages. The ith integer tells
    us how many messages should be concatenated together to re-form the ith
    message.

    Chunking works on both string and binary messages.
    """

    def encode(self):
        encoded_packet = super().encode()
        msgs = encoded_packet if type(encoded_packet) is list else [encoded_packet]

        # skip chunking info if all messages are smaller than chunk size.
        if all(len(msg) <= CHUNK_SIZE for msg in msgs):
            return msgs

        output: List[EncodedMessage] = []
        chunked_sizes: List[int] = []

        for msg in msgs:
            chunks = self._chunk_message(msg)
            chunked_sizes.append(len(chunks))
            output.extend(chunks)

        return [
            f"{CHUNKED_PACKET_TYPE}{json.dumps(chunked_sizes, separators=(',', ':'))}",
            *output,
        ]

    def _chunk_message(self, msg: EncodedMessage) -> List[Union[str, bytes]]:
        if type(msg) is str:
            return self._chunk_str(msg)
        if type(msg) is bytes:
            return self._chunk_bytes(msg)

    def _chunk_str(self, string: str) -> List[str]:
        return [string[o : o + CHUNK_SIZE] for o in range(0, len(string), CHUNK_SIZE)]

    def _chunk_bytes(self, binary: bytes) -> List[bytes]:
        # TODO can we get memoryview working here?
        # at the moment, memoryview doesn't serialize properly.
        return [binary[o : o + CHUNK_SIZE] for o in range(0, len(binary), CHUNK_SIZE)]
