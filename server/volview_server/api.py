from volview_server.rpc_server import RpcServer


class VolViewApi:
    def __init__(self, server: RpcServer):
        self._server = server
