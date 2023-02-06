# VolView Server

The VolView server is a Python WebSocket service that exposes RPC endpoints.
Customize VolView to:

1. Filter and segment images
1. Load remote data
1. Run AI models and return results 

## Quickstart

In the VolView root directory, one level up, create a `.env` file with
`VUE_APP_REMOTE_SERVER_URL=http://localhost:4014`

VolView uses poetry for managing the virtualenv and dependencies. To install,
run `pip3 install poetry`. To launch the server:

```
$ cd server/
$ poetry install
$ poetry run python -m volview_server -P 4014 ./custom/user_api.py
```

Launch VolView (e.g. using `npm run serve`) and check out the "Remote Functions"
tab! The Python server must be running before VolView loads.

## Customizing the RPC API

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

### Custom Object Encoding

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

### Async Support

Async methods are supported via asyncio.

```python
import asyncio
from volview_server import VolViewApi, expose

class Api(VolViewApi):
    @expose
    async def sleep(self):
        await asyncio.sleep(5)
```

### Progress via Streaming Async Generators

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

## Accessing Client Stores

It is possible for RPC methods to access the client application stores using `self.get_client_store(store_name)`. This feature allows the server to control the calling client and make modifications, such as adding new images, updating annotations, switching the viewed image, and more!

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
