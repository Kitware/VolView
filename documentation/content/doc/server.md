title: VolView Server Guide
---

The VolView server extends the VolView viewer with remote processing
capabilities. It integrates with your Python-based code and exposes that
functionality directly into the viewer.

## Quick Start

There are two parts to getting started with this VolView server example: the
server and the viewer.

### Starting the Server

The easiest way to get started is to install
[Poetry](https://python-poetry.org/) and create a new Python environment for
running the VolView server.

```
cd ./server/
poetry install
```

The VolView codebase comes with a sample server API in
`server/custom/user_api.py` that works with the remote functions sample in the
VolView viewer.

To run the server with this sample API, run the following command.

```
cd ./server/
poetry run python -m volview_server -P 4014 custom/user_api.py
```

### Running the Viewer

We first need to tell the viewer where the server is running. Copy
`.env.example` to `.env` and edit the server URL to be the following value:

```
VITE_REMOTE_SERVER_URL=http://localhost:4014/
```

In a separate terminal from the server terminal, we will run the application.

```
npm install
npm run build
npm run preview
```

The preview server is available at http://localhost:4173/. Navigate to the
"Remote Functions" tab to explore the available remote functionality defined by
the `custom/user_api.py` script.

- Add numbers: simple API that adds two numbers
- Random number trivia: demonstrates async API support by fetching trivia about
  a random number.
- Progress: demonstrates async generators via a simple timed progress counter.
- Median filter: Runs a median filter on the current image. Demonstrates ITK
  and VTK image serialization as well as client-side store access.

## In-Depth Guide

This guide will cover how to install, use, customize, and deploy the VolView
server.

### Server Installation

The VolView server is set up with [Poetry](https://python-poetry.org/). To
install dependencies manually, read the `pyproject.toml` file and extract the
dependencies from the `[tool.poetry.dependencies]` entry.

If you are using Poetry, you can proceed to install the dependencies and set up
a VolView environment like so:

```
cd ./server/
poetry install
```

### Customizing the RPC API

The following is a definition of a really simple RPC API that adds two numbers.

```python
from volview_server import VolViewApi, expose

class Api(VolViewApi):
    @expose
    def add(self, a: int, b: int):
        return a + b
```

The `expose` decorator exposes the `add` function with the public name `add`. To
customize the name, change the decorator to `@expose("myAddFunction")`.

An example set of RPC endpoints are defined in `custom/user_api.py`.

#### Custom Object Encoding

If you have encoded objects that have a native Python representation, you can
add custom serializers and deserializers to properly handle those objects.

The serializer/deserializer functions should either return a transformed result,
or pass through the input if no transformation was applied.


```python
from datetime import datetime
from volview_server import VolViewApi, expose

DATETIME_FORMAT = "%Y%m%dT%H:%M:%S.%f"

def decode_datetime(obj):
    if "__datetime__" in obj:
        return datetime.strptime(obj["__datetime__"], DATETIME_FORMAT)
    return obj

def encode_datetime(dt):
    if isinstance(dt, datetime):
        return {"__datetime__": dt.strftime(DATETIME_FORMAT)}
    return dt

class Api(VolViewApi):
    def __init__(self, *args, **kwargs):
        super().__init__(
            *args,
            serializers=[encode_datetime],
            deserializers=[decode_datetime],
            **kwargs
        )

    @expose
    def echo_datetime(self, dt: datetime):
        print(type(dt), dt)
        return dt
```

#### Async Support

Async methods are supported via asyncio.

```python
import asyncio
from volview_server import VolViewApi, expose

class Api(VolViewApi):
    @expose
    async def sleep(self):
        await asyncio.sleep(5)
```

#### Progress via Streaming Async Generators

If the exposed method is an async generator, the function is automatically
considered to be a streaming method.

```python
import asyncio
from volview_server import VolViewApi, expose

class Api(VolViewAPI):
    @expose
    async def progress(self):
        for i in range(100):
            yield { "progress": i, "done": False }
            await asyncio.sleep(0.1)
        yield { "progress": 100, "done": True }
```

On the client, instead of using `client.call(...)`, you must use
`client.stream(...)`.

```javascript
await client.stream('progress', [/* optional args */], (data) => {
    const { progress, done } = data;
    ...
})
```

### Accessing Client Stores

It is possible for RPC methods to access the client application stores using
`self.get_client_store(store_name)`. This feature allows the server to control
the calling client and make modifications, such as adding new images, updating
annotations, switching the viewed image, and more!

An example of this is the `medianFilter` RPC example in `custom/user_api.py`.

```python
import asyncio
from volview_server import VolViewApi, expose

class Api(VolViewAPI):
    @expose
    async def access_client(self):
        store = self.get_client_store('images')
        image_id_list = await store.idList

        new_image = self.create_new_itk_image()
        await store.addVTKImageData('My image', new_image)
```

### Deployment

The VolView server comes with its own AIOHTTP-based server, which can be run via
the `volview_server` module.

```
python -m volview_server [...options] api_script.py
```

The server supports any [deployment strategy supported by python-socketio](https://python-socketio.readthedocs.io/en/latest/server.html#deployment-strategies) as well as exposing ASGI-compatible middleware.

#### ASGI

The `volview_server` module exposes ASGI-compatible middlware that can be used
with any ASGI framework or server.

```
from volview_server import VolViewMiddleware

app = ...

# adds VolView middleware
app = VolViewMiddlware(app, ApiClass=...)
```

##### FastAPI middleware example

Install `FastAPI` and `uvicorn`, and then create a `server.py` file with the following contents:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from volview_server import VolViewMiddleware
from custom.user_api import Api

app = FastAPI()

app.add_middleware(VolViewMiddleware, ApiClass=Api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
)


@app.get("/")
def index():
    return {"hello": "world"}
```

To start the FastAPI server:

```
uvicorn server:app
```

Edit the VolView `.env` file to point to the FastAPI server:

```
VITE_REMOTE_SERVER_URL=http://localhost:8000/
```

Rebuild the VolView viewer app and navigate to the "Remote Functions" tab to see
that the server works.

#### Python-socketio supported deployment strategies

You can follow the [deployment strategies](https://python-socketio.readthedocs.io/en/latest/server.html#deployment-strategies)
supported by the python-socketio project, which powers the VolView server. In
order to do so, you will need to get access to the underlying socket.io
instance.

```python
from volview_server.rpc_server import RpcServer

server = RpcServer(ApiClass, ...)
# retrieve the socket.io instance
sio = server.sio
```