from typing import Callable, Any, TypeVar

from volview_server.rpc_server import current_server, current_client_id

T = TypeVar("T")


def get_current_session(default_factory: Callable[[], T] = None) -> T:
    """Retrieves the current session object for the current client.

    This should only be called from inside an RPC endpoint.

    If no session exists for the current client and `default_factory` is
    provided, then `default_factory` will be invoked and a new session object
    will be returned.

    If no `default_factory` is provided, `None` will be returned.

    If there is no current client, then this will raise a RuntimeError.
    """
    server = current_server.get()
    if not server:
        raise RuntimeError("No current server")

    client_id = current_client_id.get()
    if not client_id:
        raise RuntimeError("No no current client")

    if client_id not in server.sessions and default_factory:
        server.sessions[client_id] = default_factory()
    return server.sessions.get(client_id, None)
