from dataclasses import dataclass
import inspect
import enum
from typing import Callable, Tuple, Dict

from volview_server.exceptions import KeyExistsError


class ExposeType(enum.Enum):
    RPC = "rpc"
    STREAM = "stream"


@dataclass
class EndpointInfo:
    name: str
    type: ExposeType
    transform_args: bool = True


Endpoint = Tuple[Callable, EndpointInfo]


class RpcRouter:
    endpoints: Dict[str, Endpoint]

    def __init__(self):
        self.endpoints = {}

    def add_endpoint(self, public_name: str, fn: Callable, transform_args=True):
        """Adds a public endpoint.

        Arguments:
            - public_name: the endpoint name
            - fn: the function to call

        Keyword arguments:
            - transform_args(=true): transform input arguments and output
              results. Disable this if you do not want transform overhead
              or you want to explicitly transform your inputs and outputs.
        """

        if public_name in self.endpoints:
            raise KeyExistsError(f"{public_name} is already registered")

        expose_type = ExposeType.RPC
        if inspect.isasyncgenfunction(fn) or inspect.isgeneratorfunction(fn):
            expose_type = ExposeType.STREAM

        info = EndpointInfo(public_name, expose_type, transform_args)
        self.endpoints[public_name] = (fn, info)
