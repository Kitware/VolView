import sys

import socketio
from volview_server.rpc_server import RpcServer


def VolViewMiddleware(app, ApiClass=None, **kwargs):
    """Adds ASGI middleware for accessing VolView's API.

    Args:
        ApiClass: the server RPC class. See VolViewApi for more info.
        **kwargs: python-socketio options.

    All other possible keyword args are available from the python-socketio
    project:
    https://python-socketio.readthedocs.io/en/latest/api.html#asyncserver-class

    Keyword arguments from python-socketio that have VolView-specific defaults
    or are generally usefl are provided below. Refer to the aforementioned
    documentation for configuring these options.
        max_http_buffer_size (=sys.maxsize): max message size (binary or text).
            Messages that exceed this threshold may cause the client to
            be disconnected.
        cors_allowed_origins (=[]): allowed CORS origins. The default value
            defers CORS handling to other middleware.
        logger (=False): socket.io verbose logging.
        engineio_logger (=False): engine.io verbose logging.
    """
    server = RpcServer(
        ApiClass,
        # python-socketio kwargs
        async_mode="asgi",
        async_handlers=True,
        # allow upstream handling of CORS
        cors_allowed_origins=[],
        # default to unrestricted message size
        max_http_buffer_size=sys.maxsize,
        **kwargs
    )
    return socketio.ASGIApp(server.sio, app)
