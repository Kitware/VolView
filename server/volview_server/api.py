import asyncio
import inspect
from typing import Any, List, Callable, Union
from contextvars import copy_context
from concurrent.futures import ThreadPoolExecutor

from volview_server.rpc_router import RpcRouter, ExposeType
from volview_server.transformers import (
    pipe,
    transform_object,
    default_serializers,
    default_deserializers,
    Transformer,
)

DEFAULT_NUM_THREADS = 4


class RpcApi:
    serializers: List[Transformer]
    deserializers: List[Transformer]

    def __init__(
        self,
        num_threads: int = DEFAULT_NUM_THREADS,
        serializers: List[Transformer] = default_serializers,
        deserializers: List[Transformer] = default_deserializers,
    ):
        self.serializers = serializers or []
        self.deserializers = deserializers or []
        self._default_router = RpcRouter()
        self._routers = [self._default_router]
        self._thread_pool = ThreadPoolExecutor(num_threads)

    def add_router(self, router: RpcRouter):
        self._routers.append(router)

    def expose(self, name_or_func: Union[str, Callable], transform_args=True):
        """Decorator that exposes a function as an RPC endpoint.

        See RpcRouter.add_endpoint() for more info.

        Both examples below expose the decorated function with the RPC name
        "my_rpc".

        @volview.expose
        def my_rpc():
            ...

        @volview.expose("my_rpc")
        def internal_name():
            ...

        Keyword arguments:
            - transform_args(=true): transform input arguments and output
              results. Disable this if you do not want transform overhead
              or you want to explicitly transform your inputs and outputs.
        """
        if callable(name_or_func):
            fn = name_or_func
            name = fn.__name__
            self._default_router.add_endpoint(name, fn, transform_args=transform_args)
            return fn
        elif type(name_or_func) is str:
            name = name_or_func

            def add_endpoint(fn):
                self._default_router.add_endpoint(
                    name, fn, transform_args=transform_args
                )
                return fn

            return add_endpoint
        else:
            raise TypeError("not given a name or function")

    def _find_endpoint(self, rpc_name: str):
        for router in self._routers:
            if rpc_name in router.endpoints:
                return router.endpoints[rpc_name]
        raise KeyError(f"Cannot find RPC endpoint {rpc_name}")

    async def invoke_rpc(self, rpc_name: str, *args, asyncio_loop=None, context=None):
        """Invokes an RPC endpoint.

        If the endpoint is a non-async function, then it is run in an asyncio
        loop with a given context.

        If no asyncio_loop is given, the default running loop is used.

        If no context is given, the current context is copied.
        """
        fn, info = self._find_endpoint(rpc_name)

        if info.type != ExposeType.RPC:
            raise TypeError(f"Cannot invoke a non-RPC endpoint")

        if info.transform_args:
            args = [self.serialize_object(obj) for obj in args]

        if inspect.iscoroutinefunction(fn):
            result = await fn(*args)
        else:
            loop = asyncio_loop or asyncio.get_running_loop()
            ctx = context or copy_context()
            result = await loop.run_in_executor(self._thread_pool, ctx.run, fn, *args)

        if info.transform_args:
            result = self.serialize_object(result)

        return result

    async def invoke_stream(self, stream_name: str, *args):
        """Invokes a stream endpoint.

        This is an async generator that produces result data.
        """
        fn, info = self._find_endpoint(stream_name)

        if info.type != ExposeType.STREAM:
            raise TypeError(f"Cannot stream from a non-stream endpoint")

        if info.transform_args:
            args = [self.serialize_object(obj) for obj in args]

        async for data in fn(*args):
            if info.transform_args:
                data = self.deserialize_object(data)
            yield data

    def serialize_object(self, obj: Any):
        return transform_object(obj, lambda o: pipe(o, *self.serializers))

    def deserialize_object(self, obj: Any):
        return transform_object(obj, lambda o: pipe(o, *self.deserializers))
