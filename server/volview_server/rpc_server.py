from __future__ import annotations

import time
import asyncio
import uuid
import logging
from typing import Any, Union, List, Generator, Dict, Tuple, Optional
from contextvars import ContextVar
from dataclasses import dataclass, field, asdict
from urllib.parse import parse_qs

from socketio.exceptions import ConnectionRefusedError

from volview_server.api import RpcApi
from volview_server.chunking import ChunkingAsyncServer

RPC_CALL_EVENT = "rpc:call"
RPC_RESULT_EVENT = "rpc:result"
STREAM_CALL_EVENT = "stream:call"
STREAM_RESULT_EVENT = "stream:result"

CLIENT_ID_QS = "clientId"
FUTURE_TIMEOUT = 5 * 60  # seconds

current_server: ContextVar[RpcServer] = ContextVar("server")
current_client_id: ContextVar[str] = ContextVar("client_id")

logger = logging.getLogger("volview_server.rpc_server")


@dataclass
class RpcCall:
    rpcId: str
    name: str
    args: List[Any]


def validate_rpc_call(data: Any):
    if type(data) is not dict:
        raise TypeError("data is not a dict")

    rpc_id = data["rpcId"]
    if type(rpc_id) is not str:
        raise TypeError("rpc ID is not a str")

    name = data["name"]
    if type(name) is not str:
        raise TypeError("rpc name is not a str")

    args = data.get("args", None) or []
    if type(args) is not list:
        raise TypeError("rpc args is not a list")

    return rpc_id, name, args


@dataclass
class RpcOkResult:
    rpcId: str = field(default="", init=False)
    ok: bool = field(default=True, init=False)
    data: Any = field(default=None)


@dataclass
class RpcErrorResult:
    rpcId: str = field(default="", init=False)
    ok: bool = field(default=False, init=False)
    error: str


def validate_rpc_result(result: Any):
    if type(result) is not dict:
        raise TypeError("Result is not a dict")
    return (
        result["rpcId"],
        result["ok"],
        result.get("data", None),
        result.get("error", None),
    )


@dataclass
class StreamDataResult(RpcOkResult):
    done: bool = field(default=False)


RpcResult = Union[RpcOkResult, RpcErrorResult]


@dataclass
class FutureMetadata:
    transform_args: bool = True
    creation_time: int = field(default_factory=lambda: int(time.time()))


class RpcServer:
    """Implements a bidirectional RPC mechanism.

    When you are done with the server, be sure to invoke server.teardown() in
    order to stop all background tasks.
    """

    api: RpcApi
    # sid -> client ID
    clients: Dict[str, str]
    # client ID -> session object
    sessions: Dict[str, Any]
    future_timeout: int

    def __init__(
        self,
        api: RpcApi,
        future_timeout: int = FUTURE_TIMEOUT,
        **kwargs,
    ):
        """
        Keyword Arguments:
            - future_timeout: number of seconds before an inflight RPC is ignored.
        """
        self.sio = ChunkingAsyncServer(**kwargs)
        self.api = api
        self.clients = {}
        self.sessions = {}
        self.future_timeout = future_timeout

        self._inflight_rpcs: Dict[str, Tuple[asyncio.Future, FutureMetadata]] = {}
        self._cleanup_task = None

        @self.sio.event
        async def connect(sid: str, environ: dict):
            await self._on_connect(sid, environ)

        @self.sio.event
        async def disconnect(sid: str):
            await self._on_disconnect(sid)

        @self.sio.on(RPC_CALL_EVENT)
        async def on_rpc_call(sid: str, data: Any):
            await self._on_rpc_call(self.clients[sid], data)

        @self.sio.on(STREAM_CALL_EVENT)
        async def on_stream_call(sid: str, data: Any):
            await self._on_stream_call(self.clients[sid], data)

        @self.sio.on(RPC_RESULT_EVENT)
        async def on_rpc_result(sid: str, data: Any):
            await self._on_rpc_result(self.clients[sid], data)

    def setup(self):
        """Runs setup and starts background tasks.

        Needs to be run from inside an async context.
        """
        self._cleanup_task = asyncio.create_task(self.cleanup())

    async def teardown(self):
        """Clean up, including stopping background tasks."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
        self._inflight_rpcs.clear()
        for sid in self.clients.keys():
            await self.sio.disconnect(sid)

    async def cleanup(self):
        while True:
            await asyncio.sleep(self.future_timeout)

            now = int(time.time())
            for rpc_id, (future, metadata) in self._inflight_rpcs.items():
                if (
                    not future.done()
                    and now - metadata.creation_time >= self.future_timeout
                ):
                    del self._inflight_rpcs[rpc_id]

    async def call_client(
        self,
        rpc_name: str,
        args: List[Any] = None,
        client_id: Optional[str] = None,
        transform_args: bool = True,
    ):
        """Calls an RPC method on a given client or current client.

        Does not support invoking client generators.

        args: supplies a list of arguments to be sent to the client.
        client_id: targets a specific client.
        transform_args: whether to apply transforms to the request args and response result.
        """
        rpc_id = uuid.uuid4().hex
        client_id = client_id or current_client_id.get()

        future: asyncio.Future = asyncio.Future()

        if transform_args:
            args = [self.api.serialize_object(obj) for obj in args]

        info = FutureMetadata(transform_args=transform_args)
        self._inflight_rpcs[rpc_id] = (future, info)

        await self.sio.emit(
            RPC_CALL_EVENT,
            asdict(RpcCall(rpc_id, rpc_name, args)),
            room=client_id,
        )
        return await future

    async def _on_rpc_result(self, client_id: str, result: Any):
        try:
            rpc_id, ok, data, error = validate_rpc_result(result)
            future, info = self._inflight_rpcs[rpc_id]
        except (TypeError, KeyError):
            # ignore invalid RPC result
            logger.error("Received invalid RPC result")
        else:
            del self._inflight_rpcs[rpc_id]
            if ok:
                if info.transform_args:
                    data = self.api.deserialize_object(data)
                future.set_result(data)
            else:
                future.set_exception(Exception(error))

    async def _on_connect(self, sid: str, environ: dict):
        qs = parse_qs(environ.get("QUERY_STRING", ""))
        (client_id,) = qs.get(CLIENT_ID_QS, [None])
        if not client_id:
            raise ConnectionRefusedError("No clientId provided")

        self.clients[sid] = client_id

        await self.sio.enter_room(sid, client_id)

    async def _on_disconnect(self, sid: str):
        client_id = self.clients[sid]
        await self.sio.leave_room(sid, client_id)
        await self.sio.close_room(client_id)

    async def _on_rpc_call(self, client_id: str, data: Any):
        try:
            rpc_id, name, args = validate_rpc_call(data)
        except TypeError:
            logger.error("Received invalid RPC call")
        else:
            result = await self._try_rpc_call(client_id, name, args)
            result.rpcId = rpc_id
            await self.sio.emit(RPC_RESULT_EVENT, asdict(result), room=client_id)

    async def _try_rpc_call(
        self, client_id: str, name: str, args: List[Any]
    ) -> RpcResult:
        current_server.set(self)
        current_client_id.set(client_id)

        try:
            result = await self.api.invoke_rpc(name, *args)
            return RpcOkResult(result)
        except Exception as exc:
            logger.exception(f"RPC {name} raised an exception", stack_info=True)
            return RpcErrorResult(str(exc))

    async def _on_stream_call(self, client_id: str, data: Any):
        try:
            rpc_id, name, args = validate_rpc_call(data)
        except TypeError:
            logger.error("Received invalid RPC call")
            return

        async for result in self._try_generate_stream(client_id, name, args):
            result.rpcId = rpc_id
            await self.sio.emit(STREAM_RESULT_EVENT, asdict(result), room=client_id)

    async def _try_generate_stream(
        self, client_id: str, name: str, args: List[Any]
    ) -> Generator[RpcResult, None, None]:
        current_server.set(self)
        current_client_id.set(client_id)

        try:
            async for data in self.api.invoke_stream(name, *args):
                yield StreamDataResult(done=False, data=data)
            yield StreamDataResult(done=True)
        except Exception as exc:
            yield RpcErrorResult(str(exc))
