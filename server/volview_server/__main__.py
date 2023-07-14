import sys
import os
import argparse
import importlib
import logging

from aiohttp import web

from volview_server.rpc_server import RpcServer
from volview_server.chunking import CHUNK_SIZE


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-H", "--host", default="localhost", help="Hostname for server to listen on"
    )
    parser.add_argument(
        "-P", "--port", default=4014, help="Port for server to listen on"
    )
    parser.add_argument(
        "--verbose", default=False, action="store_true", help="Enable verbose logging."
    )
    parser.add_argument("api_script", help="Python file that exposes ServerApi")
    return parser.parse_args()


def load_api_script(api_script: str):
    spec = importlib.util.spec_from_file_location("Api", api_script)
    api_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api_module)
    return api_module.Api


def run_server(
    ApiClass,
    *,
    host: str,
    port: int,
    debug: bool = False,
    **kwargs,
):
    rpc_server = RpcServer(ApiClass, async_mode="aiohttp", **kwargs)
    app = web.Application(client_max_size=CHUNK_SIZE)
    rpc_server.sio.attach(app)

    if debug:
        logging.basicConfig(level=logging.DEBUG)

    try:
        web.run_app(app, host=host, port=port)
    finally:
        # cleanup
        rpc_server.teardown()


def main(args):
    ApiClass = load_api_script(args.api_script)

    run_server(
        ApiClass,
        host=args.host,
        port=args.port,
        debug=args.verbose,
        # AsyncServer kwargs
        async_handlers=True,
        cors_allowed_origins="*",
        logger=args.verbose,
        engineio_logger=args.verbose,
        max_http_buffer_size=CHUNK_SIZE,
    )


if __name__ == "__main__":
    sys.path.append(os.path.dirname(os.path.realpath(__file__)))
    main(parse_args())
