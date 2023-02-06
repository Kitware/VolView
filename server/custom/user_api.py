import asyncio

from volview_server import VolViewApi, expose
import aiohttp


class Api(VolViewApi):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    @expose
    def add(self, a, b):
        return a + b

    @expose  # exposes as "number_trivia"
    @expose("get_number_trivia")  # exposes as "get_number_trivia"
    async def number_trivia(self):
        async with aiohttp.ClientSession() as session:
            url = "http://numbersapi.com/random/"
            async with session.get(url) as resp:
                return await resp.text()

    @expose("progress")
    async def number_stream(self):
        for i in range(1, 101):
            yield {"progress": i}
            await asyncio.sleep(0.1)
