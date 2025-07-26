import asyncio
from dataclasses import dataclass, field
from concurrent.futures import ProcessPoolExecutor

import aiohttp
import itk

from volview_server import VolViewApi, get_current_client_store, get_current_session
from volview_server.transformers import (
    convert_itk_to_vtkjs_image,
    convert_vtkjs_to_itk_image,
)

volview = VolViewApi()

## basic examples ##


@volview.expose
def add(a: int, b: int):
    return a + b


@volview.expose  # exposes as "number_trivia"
@volview.expose("get_number_trivia")  # exposes as "get_number_trivia"
async def number_trivia():
    async with aiohttp.ClientSession() as session:
        url = "http://numbersapi.com/random/"
        async with session.get(url) as resp:
            return await resp.text()


@volview.expose("progress")
async def number_stream():
    for i in range(1, 101):
        yield {"progress": i}
        await asyncio.sleep(0.1)


## median filter example ##

process_pool = ProcessPoolExecutor(4)


@dataclass
class ClientState:
    image_id_map: dict = field(init=False, default_factory=dict)
    blurred_ids: set = field(init=False, default_factory=set)


def do_median_filter(serialized_img, radius):
    img = convert_vtkjs_to_itk_image(serialized_img)
    ImageType = type(img)

    median_filter = itk.MedianImageFilter[ImageType, ImageType].New()
    median_filter.SetInput(img)
    median_filter.SetRadius(radius)
    median_filter.Update()

    output = median_filter.GetOutput()
    return convert_itk_to_vtkjs_image(output)


async def run_median_filter_process(img, radius: int):
    serialized_img = convert_itk_to_vtkjs_image(img)
    loop = asyncio.get_event_loop()
    serialized_output = await loop.run_in_executor(
        process_pool, do_median_filter, serialized_img, radius
    )
    return convert_vtkjs_to_itk_image(serialized_output)


def associate_images(state, image_id, blurred_id):
    state.blurred_ids.add(blurred_id)
    state.image_id_map[image_id] = blurred_id
    state.image_id_map[blurred_id] = image_id


def get_base_image(state: ClientState, img_id: str) -> str:
    if img_id in state.blurred_ids:
        return state.image_id_map[img_id]
    return img_id


async def show_image(img_id: str):
    store = get_current_client_store("dataset")
    await store.setPrimarySelection(img_id)


@volview.expose("medianFilter")
async def median_filter(img_id, radius):
    # Use image-cache store directly (recommended approach)
    cache_store = get_current_client_store("image-cache")
    state = get_current_session(default_factory=ClientState)

    # Behavior: when a median filter request occurs on a
    # blurred image, we instead assume we are re-running
    # the blur operation on the original image.
    base_image_id = get_base_image(state, img_id)
    
    img = await cache_store.getVtkImageData(base_image_id)
    
    if img is None:
        raise ValueError(f"No image found for ID: {base_image_id}")

    # we need to run the median filter in a subprocess,
    # since itk blocks the GIL.
    output = await run_median_filter_process(img, radius)

    blurred_id = state.image_id_map.get(base_image_id)
    images_store = get_current_client_store("images")
    
    if not blurred_id:
        # Add new blurred image
        blurred_id = await images_store.addVTKImageData("Blurred image", output)
        # Associate the blurred image ID with the base image ID.
        associate_images(state, base_image_id, blurred_id)
    else:
        # Update existing blurred image using the new updateVTKImageData method
        await cache_store.updateVTKImageData(blurred_id, output)

    await show_image(blurred_id)
