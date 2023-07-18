import socketio

from volview_server.rpc_server import RpcServer
from volview_server.chunking import CHUNK_SIZE
from volview_server.api import RpcApi


class VolViewApi(RpcApi):
    def __call__(self, app, server_kwargs={}, asgi_kwargs={}):
        """Adds ASGI middleware for accessing VolView's API.

        Args:
            - app: the ASGI app to extend
            - server_kwargs: RpcServer options
            - asgi_kwargs: socketio.ASGIApp options

        RPCServer options:
        https://python-socketio.readthedocs.io/en/latest/api.html#asyncserver-class

        ASGIApp options:
        https://python-socketio.readthedocs.io/en/latest/api.html#asgiapp-class
        """
        server = RpcServer(
            self,
            # python-socketio kwargs
            async_mode="asgi",
            async_handlers=True,
            # allow upstream handling of CORS
            cors_allowed_origins=[],
            # default to chunk size
            max_http_buffer_size=CHUNK_SIZE,
            **server_kwargs,
        )
        return socketio.ASGIApp(server.sio, app, **asgi_kwargs)
