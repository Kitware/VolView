"""Drives examples/example_api.py over socket.io, acting as the VolView client."""

import asyncio
import multiprocessing
import os
import socket
import sys
import threading
import uuid
from contextlib import contextmanager

import numpy as np
import pytest
import socketio
import uvicorn
from aiohttp import web

from volview_server.__main__ import create_app

# The example's process pool must not fork from this multi-threaded process.
multiprocessing.set_start_method("forkserver", force=True)
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "examples"))
from example_api import volview  # noqa: E402

SIZE = 16
SOURCE = np.random.default_rng(0).integers(0, 255, SIZE**3, dtype=np.uint8)


def vtk_image(values):
    return {
        "vtkClass": "vtkImageData",
        "direction": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        "extent": [0, SIZE - 1, 0, SIZE - 1, 0, SIZE - 1],
        "spacing": [1.0, 1.0, 1.0],
        "origin": [0.0, 0.0, 0.0],
        "pointData": {
            "vtkClass": "vtkDataSetAttributes",
            "activeScalars": 0,
            "arrays": [
                {
                    "data": {
                        "vtkClass": "vtkDataArray",
                        "size": values.size,
                        "values": values.tobytes(),
                        "dataType": "Uint8Array",
                        "numberOfComponents": 1,
                        "name": "Scalars",
                    }
                }
            ],
        },
    }


def image_values(image):
    return np.frombuffer(
        image["pointData"]["arrays"][0]["data"]["values"], dtype=np.uint8
    )


@contextmanager
def background_loop():
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever)
    thread.start()
    try:
        yield loop
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join()
        loop.close()


def listening_socket():
    # Listening before the server starts, so clients never race its startup.
    sock = socket.create_server(("127.0.0.1", 0))
    return sock, f"http://127.0.0.1:{sock.getsockname()[1]}"


@contextmanager
def serve_aiohttp():
    sock, url = listening_socket()
    with background_loop() as loop:

        async def start():
            runner = web.AppRunner(create_app(volview))
            await runner.setup()
            await web.SockSite(runner, sock).start()
            return runner

        runner = asyncio.run_coroutine_threadsafe(start(), loop).result()
        try:
            yield url
        finally:
            asyncio.run_coroutine_threadsafe(runner.cleanup(), loop).result()


async def not_found(scope, receive, send):
    await send({"type": "http.response.start", "status": 404, "headers": []})
    await send({"type": "http.response.body", "body": b""})


@contextmanager
def serve_asgi():
    sock, url = listening_socket()
    server = uvicorn.Server(uvicorn.Config(volview(not_found), log_level="warning"))
    with background_loop() as loop:
        serving = asyncio.run_coroutine_threadsafe(server.serve([sock]), loop)
        try:
            yield url
        finally:
            server.should_exit = True
            serving.result()


@pytest.fixture(params=[serve_aiohttp, serve_asgi], ids=["aiohttp", "asgi"])
def server_url(request):
    with request.param() as url:
        yield url


class FakeVolViewClient:
    """Answers the server's client-store calls the way the VolView app would."""

    def __init__(self, url):
        self.url = url
        self.sio = socketio.AsyncClient()
        self.results = {}
        self.streams = {}
        self.store_calls = []
        self.images = {}
        self.sio.on("rpc:result", self._on_result)
        self.sio.on("stream:result", self._on_stream_result)
        self.sio.on("rpc:call", self._on_server_call)

    async def __aenter__(self):
        await self.sio.connect(
            f"{self.url}?clientId={uuid.uuid4().hex}", transports=["websocket"]
        )
        return self

    async def __aexit__(self, *exc):
        await self.sio.disconnect()

    async def _on_result(self, data):
        self.results.pop(data["rpcId"]).set_result(data)

    async def _on_stream_result(self, data):
        await self.streams[data["rpcId"]].put(data)

    async def _on_server_call(self, data):
        store, prop_chain, args = data["args"]
        method = (store, ".".join(prop_chain))
        self.store_calls.append(method)
        result = None
        if method == ("image-cache", "getVtkImageData"):
            result = vtk_image(SOURCE)
        elif method == ("images", "addVTKImageData"):
            self.images[args[0]] = image_values(args[1])
            result = "blurred-id"
        elif method == ("image-cache", "updateVTKImageData"):
            self.images[args[0]] = image_values(args[1])
        await self.sio.emit(
            "rpc:result", {"rpcId": data["rpcId"], "ok": True, "data": result}
        )

    async def call(self, name, *args):
        rpc_id = uuid.uuid4().hex
        self.results[rpc_id] = asyncio.get_running_loop().create_future()
        await self.sio.emit(
            "rpc:call", {"rpcId": rpc_id, "name": name, "args": list(args)}
        )
        return await self.results[rpc_id]

    async def stream(self, name, *args):
        rpc_id = uuid.uuid4().hex
        self.streams[rpc_id] = asyncio.Queue()
        await self.sio.emit(
            "stream:call", {"rpcId": rpc_id, "name": name, "args": list(args)}
        )
        items = []
        while True:
            result = await self.streams[rpc_id].get()
            if not result["ok"] or result["done"]:
                return items, result
            items.append(result["data"])


def run_client(url, scenario):
    async def main():
        async with FakeVolViewClient(url) as client:
            return await scenario(client)

    return asyncio.run(main())


def test_rpc_returns_results(server_url):
    async def scenario(client):
        return await asyncio.gather(*(client.call("add", i, i) for i in range(20)))

    results = run_client(server_url, scenario)
    assert [(r["ok"], r["data"]) for r in results] == [(True, 2 * i) for i in range(20)]


def test_rpc_failures_are_reported(server_url):
    async def scenario(client):
        return await client.call("does_not_exist"), await client.call("add", 1)

    unknown, bad_args = run_client(server_url, scenario)
    assert not unknown["ok"] and "does_not_exist" in unknown["error"]
    assert not bad_args["ok"] and "missing 1 required" in bad_args["error"]


def test_stream_yields_every_item_then_done(server_url):
    items, final = run_client(server_url, lambda client: client.stream("progress"))
    assert [item["progress"] for item in items] == list(range(1, 101))
    assert final["ok"] and final["done"]


def test_median_filter_round_trips_through_client_stores(server_url):
    async def scenario(client):
        first = await client.call("medianFilter", "source-id", 1)
        first_calls, client.store_calls = client.store_calls, []
        rerun = await client.call("medianFilter", "blurred-id", 1)
        return first, first_calls, rerun, client.store_calls, client.images

    first, first_calls, rerun, rerun_calls, images = run_client(server_url, scenario)

    assert first["ok"] and rerun["ok"]
    assert first_calls == [
        ("image-cache", "getVtkImageData"),
        ("images", "addVTKImageData"),
        ("view", "setDataForAllViews"),
    ]
    assert rerun_calls == [
        ("image-cache", "getVtkImageData"),
        ("image-cache", "updateVTKImageData"),
        ("view", "setDataForAllViews"),
    ]
    blurred = images["blurred-id"]
    assert blurred.size == SOURCE.size
    assert blurred.std() < SOURCE.std()
