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


class PaintInterpolatorClientState:
    def __init__(self):
        self.slice_start = 0
        self.slice_end = 0
        self.slice_axis = 0
        self.label = 0
        self.interpolate_all_slices = False

    def set_slice_start(self, slice_start):
        self.slice_start = slice_start

    def set_slice_end(self, slice_end):
        self.slice_end = slice_end

    def set_slice_axis(self, slice_axis):
        self.slice_axis = slice_axis

    def set_label(self, label):
        self.label = label

    def set_interpolate_all_slices(self, interpolate_all_slices):
        self.interpolate_all_slices = interpolate_all_slices

## The logic of the paint interpolator method ##
def paint_interpolator_method(state):

    # Load parameters from state
    overlay = convert_vtkjs_to_itk_image(state.common.current_overlay)
    interpolate_all_slices = state.paint_interpolator.interpolate_all_slices
    label = state.paint_interpolator.label

    # Allocate the filter
    interpolator = itk.MorphologicalContourInterpolator.New(overlay)

    # Set the filter parameters
    if not interpolate_all_slices:
        slice_start = state.paint_interpolator.slice_start
        slice_end = state.paint_interpolator.slice_end
        slice_axis = state.paint_interpolator.slice_axis
        indices = [slice_start, slice_end]
        interpolator.SetUseCustomSlicePositions(True)
        interpolator.SetLabeledSliceIndices(
            slice_axis,
            label,
            indices,
        )
    else:
        interpolator.SetUseCustomSlicePositions(False)

    # Run the filter
    interpolator.Update()

    # Convert itkImage results to vtkjs image to support serialization
    output_overlay = interpolator.GetOutput()
    serialized_output = convert_itk_to_vtkjs_image(output_overlay)

    return serialized_output
