import asyncio
from dataclasses import dataclass, field
from concurrent.futures import ProcessPoolExecutor

import aiohttp
import itk

itk.force_load()

from volview_server import (
    VolViewApi,
    get_current_client_store,
    get_current_session,
)

from volview_server.transformers import (
    convert_itk_to_vtkjs_image,
    convert_vtkjs_to_itk_image,
)

from methods_utils import show_image

from median_filter_method import (
    MedianFilter_ClientState,
    MedianFilter_ClientStateManager,
    run_median_filter_process,
)

volview = VolViewApi()

## server-based methods ##

process_pool = ProcessPoolExecutor(4)

## Record the relationships between images and overlays ##


## Median Filter Method ##


@volview.expose("medianFilter")
async def median_filter(input_image_id, radius):
    store = get_current_client_store("images")
    state = get_current_session(default_factory=MedianFilter_ClientState)

    image = await store.dataIndex[input_image_id]

    # we need to run the median filter in a subprocess,
    # since itk blocks the GIL.
    output_image = await run_median_filter_process(process_pool, image, radius)

    output_image_id = await store.addVTKImageData("Median filtered image", output_image)

    state_manager = MedianFilter_ClientStateManager
    state_manager.associate_derived_image(state, input_image_id, output_image_id)
    await show_image(output_image_id)


## Add Method ##


@volview.expose
def add(a: int, b: int):
    return a + b


## Number Trivia Method ##


@volview.expose  # exposes as "number_trivia"
@volview.expose("get_number_trivia")  # exposes as "get_number_trivia"
async def number_trivia():
    async with aiohttp.ClientSession() as session:
        url = "http://numbersapi.com/random/"
        async with session.get(url) as resp:
            return await resp.text()


## Progress Method ##


@volview.expose("progress")
async def number_stream():
    for i in range(1, 101):
        yield {"progress": i}
        await asyncio.sleep(0.1)
