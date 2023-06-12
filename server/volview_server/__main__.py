import sys
import os
import argparse
import importlib

from aiohttp import web

from volview_server.rpc_server import RpcServer

MAX_HTTP_BUFFER_SIZE = 4 * 1024 * 1024 * 1024


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-H", "--host", default="localhost", help="Hostname for server to listen on"
    )
    parser.add_argument(
        "-P", "--port", default=4014, help="Port for server to listen on"
    )
    parser.add_argument(
        "--max-message-size",
        type=int,
        default=MAX_HTTP_BUFFER_SIZE,
        help="Max message size. Set to 0 for the max allowable size.",
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


def run_server(ApiClass, *, host: str, port: int, **kwargs):
    rpc_server = RpcServer(ApiClass, **kwargs)
    web.run_app(rpc_server.app, host=host, port=port)

    # cleanup
    rpc_server.teardown()


def main(args):
    ApiClass = load_api_script(args.api_script)

    max_http_buffer_size = args.max_message_size
    if max_http_buffer_size == 0:
        max_http_buffer_size = sys.maxsize

    if args.verbose:
        print(f"Using a max message size of {max_http_buffer_size}")

    run_server(
        ApiClass,
        host=args.host,
        port=args.port,
        # AsyncServer kwargs
        async_mode="aiohttp",
        async_handlers=True,
        cors_allowed_origins="*",
        logger=args.verbose,
        engineio_logger=args.verbose,
        max_http_buffer_size=max_http_buffer_size,
    )


if __name__ == "__main__":
    sys.path.append(os.path.dirname(os.path.realpath(__file__)))
    main(parse_args())
