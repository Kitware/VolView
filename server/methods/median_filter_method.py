import asyncio
import aiohttp

from dataclasses import (
    dataclass,
    field,
)

from volview_server.transformers import (
    convert_itk_to_vtkjs_image,
    convert_vtkjs_to_itk_image,
)

from methods_utils import (
    DerivedObjects_ClientState,
    DerivedObjects_ClientStateManager,
)

import itk

itk.force_load()



@dataclass
class MedianFilter_ClientState(DerivedObjects_ClientState):
    median_filter_radius: dict = field(init=False, default_factory=dict)


class MedianFilter_ClientStateManager(DerivedObjects_ClientStateManager):
    def set_radius(state, image_id, radius):
        state.median_filter_radius[image_id] = str(radius)

    def get_radius(state: MedianFilter_ClientState, image_id: str) -> int:
        if image_id in state.derived_image_ids:
            return int(state.median_filter_radius[image_id])
        return 0.0


def _do_median_filter(serialized_image, radius):
    image = convert_vtkjs_to_itk_image(serialized_image)
    ImageType = type(image)

    median_filter = itk.MedianImageFilter[ImageType, ImageType].New()
    median_filter.SetInput(image)
    median_filter.SetRadius(radius)
    median_filter.Update()

    output = median_filter.GetOutput()
    return convert_itk_to_vtkjs_image(output)


async def run_median_filter_process(process_pool, image, radius: int):
    serialized_image = convert_itk_to_vtkjs_image(image)
    loop = asyncio.get_event_loop()
    serialized_output = await loop.run_in_executor(
        process_pool, _do_median_filter, serialized_image, radius
    )
    return convert_vtkjs_to_itk_image(serialized_output)
