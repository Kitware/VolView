from dataclasses import dataclass
from typing import List, Union, Any

from volview_server.rpc_server import current_server

PropKey = Union[int, str]

RPC_GET_VALUE = "getStoreProperty"
RPC_CALL_METHOD = "callStoreMethod"


def get_current_server():
    server = current_server.get()
    if not server:
        raise RuntimeError("No active VolView RPC server")
    return server


@dataclass
class StoreOptions:
    transform_args: bool = True


class PropertyDescriptor:
    def __init__(self, store_id: str, prop_chain: List[PropKey], options: StoreOptions):
        self.store_id = store_id
        self.prop_chain = prop_chain
        self.options = options

    def __repr__(self):
        return f'<{type(self).__name__} store_id={self.store_id} prop_chain={".".join(self.prop_chain)}>'


class ClientStoreMethodCallDescriptor(PropertyDescriptor):
    def __init__(
        self,
        store_id: str,
        prop_chain: List[PropKey],
        options: StoreOptions,
        args: List[Any],
    ):
        super().__init__(store_id, prop_chain, options)
        # we don't support passing kwargs to client
        self.args = args

    def __await__(self):
        return (
            get_current_server()
            .call_client(
                RPC_CALL_METHOD,
                [self.store_id, self.prop_chain, self.args],
                transform_args=self.options.transform_args,
            )
            .__await__()
        )

    def __repr__(self):
        return f'<{type(self).__name__} store_id={self.store_id} prop_chain={".".join(self.prop_chain)}()>'


class ClientStorePropertyDescriptor(PropertyDescriptor):
    def __call__(self, *args):
        return ClientStoreMethodCallDescriptor(
            self.store_id, self.prop_chain, self.options, args
        )

    def __getattr__(self, name: str):
        return self.__getitem__(name)

    def __getitem__(self, key: PropKey):
        return ClientStorePropertyDescriptor(
            self.store_id, self.prop_chain + [key], self.options
        )

    def __await__(self):
        return (
            get_current_server()
            .call_client(
                RPC_GET_VALUE,
                [self.store_id, self.prop_chain],
                transform_args=self.options.transform_args,
            )
            .__await__()
        )


class ClientStore:
    def __init__(self, name: str, options: StoreOptions):
        self.name = name
        self.options = options

    def __getattr__(self, name: str):
        return self.__getitem__(name)

    def __getitem__(self, key: PropKey):
        return ClientStorePropertyDescriptor(self.name, [key], self.options)


def get_current_client_store(store_name: str, **kwargs):
    """Gets a proxy to a client's store.

    This should only be called from inside an RPC endpoint.

    The methods and properties accessed through this client store proxy are not bound to a client until awaited.
    """
    options = StoreOptions(**kwargs)
    return ClientStore(store_name, options)
