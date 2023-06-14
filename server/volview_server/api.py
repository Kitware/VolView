from volview_server.rpc_server import RpcServer
from volview_server.client_store import ClientStore
from volview_server.transformers import (
    default_serializers,
    default_deserializers,
)


class VolViewApi:
    def __init__(
        self,
        server: RpcServer,
        serializers=default_serializers,
        deserializers=default_deserializers,
    ):
        self._server = server
        self._server.set_serializers(serializers)
        self._server.set_deserializers(deserializers)

    def get_client_store(self, store_name: str):
        return ClientStore(store_name, server=self._server)
