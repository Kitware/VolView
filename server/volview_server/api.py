from volview_server.rpc_server import RpcServer
from volview_server.client_store import ClientStore


class VolViewApi:
    def __init__(self, server: RpcServer):
        self._server = server

    def get_client_store(self, store_name: str):
        return ClientStore(store_name, server=self._server)
