class ExampleApi:
    def __init__(self) -> None:
        self.rpc = RpcRouter()
        self.rpc.expose("add", self.add)

    def add(self, a: int, b: int):
        return a + b


import asyncio
from dataclasses import dataclass, field
from concurrent.futures import ProcessPoolExecutor

import aiohttp
import itk

from volview_server import (
    VolViewApi,
    RpcRouter,
    get_current_client_store,
    get_current_session,
)
from volview_server.transformers import (
    convert_itk_to_vtkjs_image,
    convert_vtkjs_to_itk_image,
)


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


class ExampleApi:
    def __init__(self):
        self.rpc_router = RpcRouter()
        self.rpc_router.add_endpoint("add", self.add)
        self.rpc_router.add_endpoint("number_trivia", self.number_trivia)
        self.rpc_router.add_endpoint("get_number_trivia", self.number_trivia)
        self.rpc_router.add_endpoint("progress", self.number_stream)
        self.rpc_router.add_endpoint("medianFilter", self.median_filter)

        self.process_pool = ProcessPoolExecutor(4)

    ## add example ##

    def add(self, a, b):
        return a + b

    ## number trivia example ##

    async def number_trivia(self):
        async with aiohttp.ClientSession() as session:
            url = "http://numbersapi.com/random/"
            async with session.get(url) as resp:
                return await resp.text()

    ## progress bar example ##

    async def number_stream(self):
        for i in range(1, 101):
            yield {"progress": i}
            await asyncio.sleep(0.1)

    ## median filter example ##

    async def median_filter(self, img_id, radius):
        store = get_current_client_store("images")
        state = get_current_session(default_factory=ClientState)

        # Behavior: when a median filter request occurs on a
        # blurred image, we instead assume we are re-running
        # the blur operation on the original image.
        base_image_id = self._get_base_image(img_id)
        img = await store.dataIndex[base_image_id]

        output = await self._run_median_filter_process(img, radius)

        blurred_id = state.image_id_map.get(base_image_id)
        if not blurred_id:
            blurred_id = await store.addVTKImageData("Blurred image", output)
            # Associate the blurred image ID with the base image ID.
            self._associate_images(base_image_id, blurred_id)
        else:
            await store.updateData(blurred_id, output)

        await self._show_image(blurred_id)

    async def _run_median_filter_process(self, img, radius):
        serialized_img = convert_itk_to_vtkjs_image(img)
        loop = asyncio.get_event_loop()
        serialized_output = await loop.run_in_executor(
            self.process_pool, do_median_filter, serialized_img, radius
        )
        return convert_vtkjs_to_itk_image(serialized_output)

    def _associate_images(self, image_id, blurred_id):
        state = get_current_session(default_factory=ClientState)
        state.blurred_ids.add(blurred_id)
        state.image_id_map[image_id] = blurred_id
        state.image_id_map[blurred_id] = image_id

    def _get_base_image(self, img_id):
        state = get_current_session(default_factory=ClientState)
        if img_id in state.blurred_ids:
            return state.image_id_map[img_id]
        return img_id

    async def _show_image(self, img_id):
        store = get_current_client_store("dataset")
        await store.setPrimarySelection({"type": "image", "dataID": img_id})


volview = VolViewApi()
volview.add_router(ExampleApi().rpc_router)
