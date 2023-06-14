import asyncio
from dataclasses import dataclass, field


import aiohttp
import itk

from volview_server import VolViewApi, expose
from volview_server.transformers import default_serializers, default_deserializers


@dataclass
class ClientState:
    image_id_map: dict = field(init=False, default_factory=dict)
    blurred_ids: set = field(init=False, default_factory=set)


class Api(VolViewApi):
    def __init__(self, *args, **kwargs):
        super().__init__(
            *args,
            serializers=default_serializers,
            deserializers=default_deserializers,
            **kwargs
        )

        self.client_states = {}

    def get_current_client_state(self) -> ClientState:
        cid = self._server.current_client_id
        if cid not in self.client_states:
            self.client_states[cid] = ClientState()
        return self.client_states[cid]

    ## add example ##

    @expose
    def add(self, a, b):
        return a + b

    ## number trivia example ##

    @expose  # exposes as "number_trivia"
    @expose("get_number_trivia")  # exposes as "get_number_trivia"
    async def number_trivia(self):
        async with aiohttp.ClientSession() as session:
            url = "http://numbersapi.com/random/"
            async with session.get(url) as resp:
                return await resp.text()

    ## progress bar example ##

    @expose("progress")
    async def number_stream(self):
        for i in range(1, 101):
            yield {"progress": i}
            await asyncio.sleep(0.1)

    ## median filter example ##
    # This example requires the use of the default serializers/deserializers

    @expose("medianFilter")
    async def median_filter(self, img_id, radius):
        store = self.get_client_store("images")
        state = self.get_current_client_state()

        # Behavior: when a median filter request occurs on a
        # blurred image, we instead assume we are re-running
        # the blur operation on the original image.
        base_image_id = self._get_base_image(img_id)
        img = await store.dataIndex[base_image_id]

        output = self._do_median_filter(img, radius)

        blurred_id = state.image_id_map.get(base_image_id)
        if not blurred_id:
            blurred_id = await store.addVTKImageData("Blurred image", output)
            # Associate the blurred image ID with the base image ID.
            self._associate_images(base_image_id, blurred_id)
        else:
            await store.updateData(blurred_id, output)

        await self._show_image(blurred_id)

    def _do_median_filter(self, img, radius):
        ImageType = type(img)

        median_filter = itk.MedianImageFilter[ImageType, ImageType].New()
        median_filter.SetInput(img)
        median_filter.SetRadius(radius)
        median_filter.Update()

        return median_filter.GetOutput()

    def _associate_images(self, image_id, blurred_id):
        state = self.get_current_client_state()
        state.blurred_ids.add(blurred_id)
        state.image_id_map[image_id] = blurred_id
        state.image_id_map[blurred_id] = image_id

    def _get_base_image(self, img_id):
        state = self.get_current_client_state()
        if img_id in state.blurred_ids:
            return state.image_id_map[img_id]
        return img_id

    async def _show_image(self, img_id):
        store = self.get_client_store("dataset")
        await store.setPrimarySelection({"type": "image", "dataID": img_id})
