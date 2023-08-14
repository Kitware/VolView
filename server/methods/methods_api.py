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

from methods_utils import (
    show_image,
    CommonClientState,
)

from median_filter_method import (
    MedianFilterClientState,
    median_filter_method,
)


## Link to app ##


volview = VolViewApi()


## Allocate process pool ##


process_pool = ProcessPoolExecutor(4)


## Compose the Client State ##


class CurrentClientState:
    def __init__(self):
        self.common = CommonClientState()
        self.median_filter = MedianFilterClientState()


## Median filter ##


@volview.expose("medianFilter")
async def median_filter_api(input_image_id, radius):
    store = get_current_client_store("images")
    state = get_current_session(default_factory=CurrentClientState)

    # Set state variables used by median filter - current_image
    image = await store.dataIndex[input_image_id]
    serialized_image = convert_itk_to_vtkjs_image(image)
    state.common.set_current_image(input_image_id, serialized_image)

    # Set state variables used by median filter - radius
    state.median_filter.set_radius(radius)

    # we need to run the median filter in a subprocess,
    # since itk blocks the GIL.
    loop = asyncio.get_event_loop()
    serialized_output = await loop.run_in_executor(
        process_pool,
        median_filter_method,
        state,
    )

    # convert image to back to itkImage
    output_image = convert_vtkjs_to_itk_image(serialized_output)
    output_image_id = await store.addVTKImageData(
        "Median filtered image",
        output_image,
    )
    state.common.associate_derived_image(input_image_id, output_image_id)

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
