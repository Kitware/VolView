from typing import List, Union, Any


from volview_server.rpc_server import RpcServer

PropKey = Union[int, str]

RPC_GET_VALUE = "getStoreProperty"
RPC_CALL_METHOD = "callStoreMethod"


class PropertyDescriptor:
    def __init__(self, store_id: str, prop_chain: List[PropKey], server: RpcServer):
        self.store_id = store_id
        self.prop_chain = prop_chain
        self._server = server

    def __repr__(self):
        return f'<{type(self).__name__} store_id={self.store_id} prop_chain={".".join(self.prop_chain)}>'


class ClientStoreMethodCallDescriptor(PropertyDescriptor):
    def __init__(
        self,
        store_id: str,
        prop_chain: List[PropKey],
        server: RpcServer,
        args: List[Any],
    ):
        super().__init__(store_id, prop_chain, server)
        # we don't support passing kwargs to client
        self.args = args

    def __await__(self):
        return self._server.call_client(
            RPC_CALL_METHOD, [self.store_id, self.prop_chain, self.args]
        ).__await__()

    def __repr__(self):
        return f'<{type(self).__name__} store_id={self.store_id} prop_chain={".".join(self.prop_chain)}()>'


class ClientStorePropertyDescriptor(PropertyDescriptor):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def __call__(self, *args):
        return ClientStoreMethodCallDescriptor(
            self.store_id, self.prop_chain, self._server, args
        )

    def __getattr__(self, name: str):
        return self.__getitem__(name)

    def __getitem__(self, key: PropKey):
        return ClientStorePropertyDescriptor(
            self.store_id, self.prop_chain + [key], self._server
        )

    def __await__(self):
        return self._server.call_client(
            RPC_GET_VALUE, [self.store_id, self.prop_chain]
        ).__await__()


class ClientStore:
    def __init__(self, name: str, server: RpcServer):
        self.name = name
        self._server = server

    def __getattr__(self, name: str):
        return self.__getitem__(name)

    def __getitem__(self, key: PropKey):
        return ClientStorePropertyDescriptor(self.name, [key], server=self._server)
