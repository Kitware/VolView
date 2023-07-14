import json
from typing import List

from socketio import AsyncServer

from .chunking_packet import ChunkedPacket, CHUNKED_PACKET_TYPE


class ChunkingAsyncServer(AsyncServer):
    """A socket.io server that handles chunked messages.

    See ChunkedPacket for more info.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, serializer=ChunkedPacket, **kwargs)
        self._chunks = None
        self._chunking_info = None

    async def _handle_eio_message(self, eio_sid, data):
        if self._chunking_info is not None and len(self._chunking_info):
            self._chunks.append(data)

            if len(self._chunks) == self._chunking_info[0]:
                await super()._handle_eio_message(
                    eio_sid, self._reconstruct_chunks(self._chunks)
                )
                self._chunks = []
                self._chunking_info.pop(0)

            if len(self._chunking_info) == 0:
                # reset chunking state
                self._chunks = None
                self._chunking_info = None
        elif type(data) is str and data[0] == CHUNKED_PACKET_TYPE:
            self._chunks = []
            self._chunking_info = self._try_parse_chunking_info(data[1:])
        else:
            await super()._handle_eio_message(eio_sid, data)

    def _try_parse_chunking_info(self, data: str):
        info = json.loads(data)
        if type(info) is not list:
            raise TypeError("chunking info is not a list")

        if not all(type(v) is int for v in info):
            raise TypeError("chunking info is not comprised of integers")

        return info

    def _reconstruct_chunks(self, chunks):
        if all(type(c) is str for c in chunks):
            return self._reconstruct_string(chunks)
        if all(type(c) is bytes for c in chunks):
            return self._reconstruct_binary(chunks)
        raise TypeError("Received a set of unknown chunks")

    def _reconstruct_string(self, chunks: List[str]):
        return "".join(chunks)

    def _reconstruct_binary(self, chunks: List[bytes]):
        return b"".join(chunks)
