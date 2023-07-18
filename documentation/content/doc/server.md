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

The VolView codebase comes with a several sample APIs in `server/examples/` that
work with the remote functions sample in the VolView viewer.
- `server/examples/example_api.py`: basic set of example endpoints
- `server/examples/example_class_api.py`: example endpoints using a class

To run the server with a sample API, run the following command.

```
cd ./server/
poetry run python -m volview_server -P 4014 ./examples/example_api.py
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
the `examples/example_api.py` script.

- Add numbers: simple API that adds two numbers
- Random number trivia: demonstrates async API support by fetching trivia about
  a random number.
- Progress: demonstrates async generators via a simple timed progress counter.
- Median filter: Runs a median filter on the current image. Demonstrates ITK
  and VTK image serialization as well as client-side store access, as well as
  running ITK filters in a subprocess to avoid thread blocking.

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

### Writing your own APIs

To start, the following is a definition of a really simple RPC API that adds two
numbers.

```python
from volview_server import VolViewApi

volview = VolViewApi()

@volview.expose
def add(a: int, b: int):
    return a + b
```

The `volview.expose` decorator exposes the `add` function with the public name
`add`. A custom public name can be passed in via `volview.expose(name)`.

```python
# Accessible via the RPC name "my_add"
@volview.exposes("my_add")
def add(a: int, b: int):
    return a + b
```

#### Custom Object Encoding

If you have encoded objects that have a native Python representation, you can
add custom serializers and deserializers to properly handle those objects.

The serializer/deserializer functions should either return a transformed result,
or pass through the input if no transformation was applied.


```python
from datetime import datetime
from volview_server import VolViewApi

DATETIME_FORMAT = "%Y%m%dT%H:%M:%S.%f"

def decode_datetime(obj):
    if "__datetime__" in obj:
        return datetime.strptime(obj["__datetime__"], DATETIME_FORMAT)
    return obj

def encode_datetime(dt):
    if isinstance(dt, datetime):
        return {"__datetime__": dt.strftime(DATETIME_FORMAT)}
    return dt

volview = VolViewApi()
volview.serializers.append(encode_datetime)
volview.deserializers.append(decode_datetime)

@volview.expose
def echo_datetime(dt: datetime):
    print(type(dt), dt)
    return dt
```

#### Async Support

Async methods are supported via asyncio.

```python
import asyncio
from volview_server import VolViewApi

volview = VolViewApi()

@volview.expose
async def sleep():
    await asyncio.sleep(5)
    return "woke up"
```

#### Progress via Streaming Async Generators

If the exposed method is an async generator, the function is automatically
considered to be a streaming method. Streaming methods are invoked via
`client.stream(...)` rather than `client.call(...)`. See the `client.stream`
docs for more details.

```python
import asyncio
from volview_server import VolViewApi

volview = VolViewApi()

@volview.expose
async def progress():
    for i in range(100):
        yield { "progress": i }
        await asyncio.sleep(0.1)
```

#### Accessing Client Stores

It is possible for RPC methods to access the client application stores using
`get_current_client_store(store_name)`. This feature allows the server to
control the calling client and make modifications, such as adding new images,
updating annotations, switching the viewed image, and more.

An example that utilizes this feature is the `medianFilter` RPC example in
`examples/example_api.py`.

```python
import asyncio
from volview_server import VolViewApi

volview = VolViewApi()

@volview.expose
async def access_client():
    store = get_current_client_store('images')
    image_id_list = await store.idList

    new_image = create_new_itk_image()
    await store.addVTKImageData('My image', new_image)
```

#### RPC Routers

RPC routers allow for custom handling of RPC routes. For instance, route methods
can be located in namespaced or scoped scenarios, such as classes. Routers can
also be extended for further customization if desired.

See the `examples/example_class_api.py` for how to use the `RpcRouter` class and
how to add routers to the `VolViewApi`.

### Invoking RPCs from the Client

VolView keeps a global client object in the server store, accessible via `const
{ client } = useServerStore()`.

Use `result = await client.call(endpoint, [arg1, arg2, ...])` to invoke a
server-side RPC endpoint.

```js
const result = await client.call('add', [1, 2])
```

Use `await client.stream(endpoint, onStreamData)` to invoke a server-side RPC
stream.

```typescript
const onStreamData = (data: StreamData) => {
  const { progress } = data
  console.log('current progress: ', progress)
}

let done = false
await client.stream('progress', onStreamData)
let done = true
```

### Deployment

The VolView server comes with its own aiohttp-based server, which can be run via
the `volview_server` module.

```
python -m volview_server [...options] api_script.py
```

By default, `volview_server` expects the `api_script.py` module to contain a
`volview` symbol. If the VolView API is under a different name, add it to the
end of the module filename with a colon.

```python
from volview_server import VolViewApi

my_volview_api = VolViewApi()
...
```

```
python -m volview_server [...options] api_script.py:my_volview_api
```

The server supports any
[deployment strategy supported by python-socketio](https://python-socketio.readthedocs.io/en/latest/server.html#deployment-strategies)
as well as exposing ASGI-compatible middleware.

#### ASGI

The `VolViewApi` object can act as middleware for any ASGI-compatible framework
or server.

```
from volview_server import VolViewApi

app = SomeASGIApp()

# adds VolView middleware
volview = VolViewApi()
app = VolViewApi(app)
```

The VolView API's path can be customized, as well as a host of other properties.
These are exposed as keyword arguments to `VolViewApi(app, server_kwargs={}, asgi_kwargs={})`.
- `server_kwargs`: see <https://python-socketio.readthedocs.io/en/latest/api.html#asyncserver-class>
- `asgi_kwargs`: see <https://python-socketio.readthedocs.io/en/latest/api.html#asgiapp-class>

##### FastAPI middleware example

FastAPI is an ASGI-compatible web framework. This guide will go through the
FastAPI example found in `examples/example_fastapi.py`.

First install `FastAPI` and `uvicorn[standard]`.

```
python -m pip install FastAPI 'uvicorn[standard]'
```

To start the FastAPI server, use `uvicorn` as follows.

```
uvicorn examples.example_fastapi:app
```

Edit the VolView `.env` file to point to the FastAPI server:

```
VITE_REMOTE_SERVER_URL=http://localhost:8000/
```

Rebuild the VolView viewer app and navigate to the "Remote Functions" tab to
verify that the server works.

###### Changing the socket.io path

If the default `https://your-host/socket.io/` path conflicts with an existing
route, VolView can be configured to use a different path. In this guide, we will
rename the default `/socket.io/` path to `/my-custom-path/`.

On the server-side, the VolView middleware must be configured with the new path,
as shown.

```python
app.add_middlware(volview, asgi_kwargs={"socketio_path": "/my-custom-path"})
```

Then, the VolView client server URL must be updated to match. The following sets
the server URL in the `.env` file.

```
VITE_REMOTE_SERVER_URL=http://localhost:8000/my-custom-path
```

Restart both the server and the client to verify that a successful connection is
achieved.

#### Python-socketio supported deployment strategies

You can follow the [deployment strategies](https://python-socketio.readthedocs.io/en/latest/server.html#deployment-strategies)
supported by the python-socketio project, which powers the VolView server. In
order to do so, you will need to get access to the underlying socket.io
instance.

```python
from volview_server import VolViewApi
from volview_server.rpc_server import RpcServer

volview = VolViewApi()
...

server = RpcServer(volview, ...)
# retrieve the socket.io instance
sio = server.sio
sio.attach(...)
```