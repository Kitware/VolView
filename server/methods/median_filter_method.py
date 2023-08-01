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

import itk

itk.force_load()


class MedianFilterClientState:
    def __init__(self):
        self.radius = 1

    def set_radius(self, radius):
        self.radius = radius


## The image analysis logic of the median filter ##
def median_filter_method(state):
    # Load parameters from state
    image = convert_vtkjs_to_itk_image(state.common.current_image)
    radius = state.median_filter.radius

    # Allocate and run the filter
    median_filter = itk.MedianImageFilter.New(image)
    median_filter.SetRadius(radius)
    median_filter.Update()

    # Convert itkImage results to vtkjs image to support serialization
    output_image = median_filter.GetOutput()
    serialized_output = convert_itk_to_vtkjs_image(output_image)

    return serialized_output
