import asyncio
import enum
import inspect
import traceback
import uuid
from typing import Any, Callable, Union, List, Generator, Dict
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context, ContextVar
from dataclasses import dataclass, field, asdict
from urllib.parse import parse_qs

import socketio
from aiohttp import web
from socketio.exceptions import ConnectionRefusedError

from volview_server.transformers import transform_object, transform_objects, pipe

RPC_CALL_EVENT = "rpc:call"
RPC_RESULT_EVENT = "rpc:result"
STREAM_CALL_EVENT = "stream:call"
STREAM_RESULT_EVENT = "stream:result"

NUM_THREADS = 4
CLIENT_ID_QS = "clientId"
EXPOSE_INFO_ATTR = "_rpc_expose_info"


class ExposeType(enum.Enum):
    RPC = "rpc"
    STREAM = "stream"


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


def _add_expose_info(fn: Callable, public_name: str):
    expose_type = ExposeType.RPC
    if inspect.isasyncgenfunction(fn) or inspect.isgeneratorfunction(fn):
        expose_type = ExposeType.STREAM
    endpoints = getattr(fn, EXPOSE_INFO_ATTR, [])
    endpoints.append({"public_name": public_name, "type": expose_type})
    setattr(fn, EXPOSE_INFO_ATTR, endpoints)
    return fn


def expose(name_or_func: Union[str, Callable]):
    if callable(name_or_func):
        return _add_expose_info(name_or_func, name_or_func.__name__)
    elif type(name_or_func) is str:
        return lambda fn: _add_expose_info(fn, name_or_func)
    else:
        raise Exception("expose(): not given a name or function")


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


class RpcServer:
    """Implements a bidirectional RPC mechanism."""

    def __init__(self, ApiClass, num_threads=NUM_THREADS, **kwargs):
        self.sio = socketio.AsyncServer(**kwargs)
        self.app = web.Application()
        self.sio.attach(self.app)

        # sid -> client ID
        self.clients = {}

        self._thread_pool = ThreadPoolExecutor(num_threads)
        self._client_id_cvar: ContextVar[str] = ContextVar("client_id")
        self._pending_rpcs: Dict[str, asyncio.Future] = {}
        self._serializers: List[Callable] = []
        self._deserializers: List[Callable] = []

        # initialize ApiClass last
        self.api = ApiClass(self)

        @self.sio.event
        def connect(sid: str, environ: dict):
            self._on_connect(sid, environ)

        @self.sio.event
        def disconnect(sid: str):
            self._on_disconnect(sid)

        @self.sio.on(RPC_CALL_EVENT)
        async def on_rpc_call(sid: str, data: Any):
            await self._on_rpc_call(self.clients[sid], data)

        @self.sio.on(STREAM_CALL_EVENT)
        async def on_stream_call(sid: str, data: Any):
            await self._on_stream_call(self.clients[sid], data)

        @self.sio.on(RPC_RESULT_EVENT)
        async def on_rpc_result(sid: str, data: Any):
            await self._on_rpc_result(self.clients[sid], data)

    @property
    def current_client_id(self):
        return self._client_id_cvar.get()

    def set_serializers(self, serializers: List[Callable]):
        self._serializers = serializers

    def set_deserializers(self, deserializers: List[Callable]):
        self._deserializers = deserializers

    def _serialize(self, obj: Any):
        return pipe(obj, *self._serializers)

    def _deserialize(self, obj: Any):
        return pipe(obj, *self._deserializers)

    def teardown(self):
        """Does internal cleanup."""
        # break circular dependency
        self.api = None

    async def call_client(self, rpc_name: str, args: List[Any] = None, client_id=None):
        """Calls an RPC method on a given client or current client.

        Does not support invoking client generators.
        """
        rpc_id = uuid.uuid4().hex
        client_id = client_id or self.current_client_id

        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self._pending_rpcs[rpc_id] = future

        args = transform_objects(args or [], self._serialize)
        await self.sio.emit(
            RPC_CALL_EVENT,
            asdict(RpcCall(rpc_id, rpc_name, args)),
            room=client_id,
        )
        return await future

    async def _on_rpc_result(self, client_id: str, result: Any):
        try:
            rpc_id, ok, data, error = validate_rpc_result(result)
            future = self._pending_rpcs.get(rpc_id, None)
        except (TypeError, KeyError):
            # ignore invalid RPC result
            print("Received invalid RPC result")
        else:
            del self._pending_rpcs[rpc_id]
            if ok:
                data = transform_object(data, self._deserialize)
                future.set_result(data)
            else:
                future.set_exception(Exception(error))

    def _on_connect(self, sid: str, environ: dict):
        qs = parse_qs(environ.get("QUERY_STRING", ""))
        (client_id,) = qs.get(CLIENT_ID_QS, [None])
        if not client_id:
            raise ConnectionRefusedError("No clientId provided")

        self.clients[sid] = client_id
        # add to room based on client_id
        self.sio.enter_room(sid, client_id)

    def _on_disconnect(self, sid: str):
        client_id = self.clients[sid]
        self.sio.leave_room(sid, client_id)

    def _find_exposed_method(self, rpc_name: str, expose_type: str):
        """Finds a method annotated with expose info."""
        for attr in dir(self.api):
            fn = getattr(self.api, attr)
            if not callable(fn):
                continue

            endpoints = getattr(fn, EXPOSE_INFO_ATTR, [])
            for endpoint in endpoints:
                if (
                    endpoint.get("type", None) == expose_type
                    and endpoint.get("public_name", None) == rpc_name
                ):
                    return fn
        return None

    async def _on_rpc_call(self, client_id: str, data: Any):
        try:
            rpc_id, name, args = validate_rpc_call(data)
        except TypeError:
            print("Received invalid RPC call")
        else:
            result = await self._try_rpc_call(client_id, name, args)
            result.rpcId = rpc_id
            await self.sio.emit(RPC_RESULT_EVENT, asdict(result), room=client_id)

    async def _try_rpc_call(
        self, client_id: str, name: str, args: List[Any]
    ) -> RpcResult:
        rpc_fn = self._find_exposed_method(name, ExposeType.RPC)
        if not rpc_fn:
            return RpcErrorResult(f"{name} is not a registered RPC")

        self._client_id_cvar.set(client_id)
        try:
            args = transform_objects(args, self._deserialize)
            if inspect.iscoroutinefunction(rpc_fn):
                result = await rpc_fn(*args)
            else:
                loop = asyncio.get_running_loop()
                ctx = copy_context()
                result = await loop.run_in_executor(
                    self._thread_pool, ctx.run, rpc_fn, *args
                )
            result = transform_object(result, self._serialize)
            return RpcOkResult(result)
        except Exception as exc:
            traceback.print_exc()
            return RpcErrorResult(str(exc))

    async def _on_stream_call(self, client_id: str, data: Any):
        try:
            rpc_id, name, args = validate_rpc_call(data)
        except TypeError:
            print("Received invalid RPC call")
            return

        async for result in self._try_generate_stream(client_id, name, args):
            result.rpcId = rpc_id
            await self.sio.emit(STREAM_RESULT_EVENT, asdict(result), room=client_id)

    async def _try_generate_stream(
        self, client_id: str, name: str, args: List[Any]
    ) -> Generator[RpcResult, None, None]:
        stream_fn = self._find_exposed_method(name, ExposeType.STREAM)
        if not stream_fn:
            yield RpcErrorResult(f"{name} is not a registered stream RPC")
            return

        self._client_id_cvar.set(client_id)
        try:
            args = transform_objects(args, self._deserialize)
            async for data in stream_fn(*args):
                data = transform_object(data, self._serialize)
                yield StreamDataResult(done=False, data=data)
            yield StreamDataResult(done=True)
        except Exception as exc:
            yield RpcErrorResult(str(exc))
