import sys
import re
import os
import argparse
import importlib
import logging

from aiohttp import web

from volview_server.volview_api import VolViewApi
from volview_server.rpc_server import RpcServer
from volview_server.chunking import CHUNK_SIZE


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-H", "--host", default="localhost", help="Hostname for server to listen on"
    )
    parser.add_argument(
        "-P", "--port", type=int, default=4014, help="Port for server to listen on"
    )
    parser.add_argument(
        "--verbose", default=False, action="store_true", help="Enable verbose logging."
    )
    parser.add_argument("api_script", help="Python file that exposes ServerApi")
    return parser.parse_args()


def import_api_script(api_script_file: str):
    api_script_file = os.path.abspath(api_script_file)
    import_target = os.path.basename(api_script_file)

    script_filename, _, instance_name = import_target.partition(":")
    instance_name = instance_name or "volview"
    module_name = re.sub(r"\.py$", "", script_filename)

    sys.path.append(os.path.dirname(api_script_file))
    module = importlib.import_module(module_name)

    instance = module
    for attr_name in instance_name.split("."):
        instance = getattr(instance, attr_name)
    return instance


def create_app(api: VolViewApi, *, verbose: bool = False):
    rpc_server = RpcServer(
        api,
        async_mode="aiohttp",
        # socketio.AsyncServer kwargs
        async_handlers=True,
        cors_allowed_origins="*",
        logger=verbose,
        engineio_logger=verbose,
        max_http_buffer_size=CHUNK_SIZE,
    )

    async def start(app):
        rpc_server.setup()

    async def stop(app):
        await rpc_server.teardown()

    app = web.Application(client_max_size=CHUNK_SIZE)
    rpc_server.sio.attach(app)
    app.on_startup.append(start)
    app.on_shutdown.append(stop)
    return app


def main(args):
    volview_api = import_api_script(args.api_script)

    if not isinstance(volview_api, VolViewApi):
        raise TypeError("Imported instance is not a VolViewApi")

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG)

    web.run_app(
        create_app(volview_api, verbose=args.verbose), host=args.host, port=args.port
    )


if __name__ == "__main__":
    main(parse_args())
