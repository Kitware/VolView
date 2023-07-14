from typing import Dict

import itk
import numpy as np

from volview_server.transformers.itk_helpers import (
    itk_image_pixel_type_to_js,
    TYPE_ARRAY_JS_TO_NUMPY,
)
from volview_server.transformers.exceptions import ConvertError


def vtk_to_itk_image(vtk_image: Dict):
    """Converts a serialized vtkImageData to an ITK image."""
    if not isinstance(vtk_image, dict):
        raise ConvertError("Provided vtk_image is not a dict")
    if vtk_image.get("vtkClass", None) != "vtkImageData":
        raise ConvertError("Provided vtk_image is not a serialized vtkImageData")

    try:
        extent = vtk_image["extent"]
        # numpy indexes in ZYX order, where X varies the fastest
        dims = [
            extent[5] - extent[4] + 1,
            extent[3] - extent[2] + 1,
            extent[1] - extent[0] + 1,
        ]
        if type(vtk_image["direction"]) is list:
            direction = np.array(vtk_image["direction"], dtype=float)
        elif type(vtk_image["direction"] is bytes):
            direction = np.frombuffer(vtk_image["direction"], dtype=float)
        else:
            raise TypeError("Cannot parse image direction")

        # vtk.js direction matrix is column-major
        direction = direction.reshape((3, 3)).transpose()

        pixel_data_array = vtk_image["pointData"]["arrays"][0]["data"]
        pixel_js_datatype = pixel_data_array["dataType"]
        pixel_dtype = TYPE_ARRAY_JS_TO_NUMPY.get(pixel_js_datatype)
        if not pixel_dtype:
            raise TypeError(
                f"Failed to map vtkImageData pixel type {pixel_js_datatype}"
            )

        pixel_data = np.frombuffer(pixel_data_array["values"], dtype=pixel_dtype)
        itk_image = itk.GetImageFromArray(np.reshape(pixel_data, dims))

        # https://discourse.itk.org/t/set-image-direction-from-numpy-array/844/10
        itk_image.SetDirection(itk.matrix_from_array(direction))
        itk_image.SetOrigin(vtk_image["origin"])
        itk_image.SetSpacing(vtk_image["spacing"])
        return itk_image

    except Exception as exc:
        raise ConvertError("Cannot convert provided vtk_image to an ITK image") from exc


def itk_to_vtk_image(itk_image):
    """Converts an ITK image to a serialized vtkImageData for vtk.js."""
    if not type(itk_image).__name__.startswith("itkImage"):
        raise ConvertError("Provided data is not an ITK image")

    size = list(itk_image.GetLargestPossibleRegion().GetSize())
    values = itk.GetArrayFromImage(itk_image).flatten(order="C")
    return {
        "vtkClass": "vtkImageData",
        "dataDescription": 8,
        "direction": list(
            itk.GetArrayFromVnlMatrix(
                itk_image.GetDirection().GetVnlMatrix().as_matrix()
            )
            .transpose()  # vtk.js is column-major, ITK is row-major
            .flatten()
        ),
        "extent": [
            0,
            size[0] - 1,
            0,
            size[1] - 1,
            0,
            size[2] - 1,
        ],
        "spacing": list(itk_image.GetSpacing()),
        "origin": list(itk_image.GetOrigin()),
        "pointData": {
            "vtkClass": "vtkDataSetAttributes",
            # the index of the only array
            "activeScalars": 0,
            "arrays": [
                {
                    "data": {
                        "vtkClass": "vtkDataArray",
                        "size": len(values),
                        "values": values.tobytes(),
                        "dataType": itk_image_pixel_type_to_js(itk_image),
                        "numberOfComponents": itk_image.GetNumberOfComponentsPerPixel(),
                        "name": "Scalars",
                    }
                }
            ],
        },
    }


def convert_vtkjs_to_itk_image(obj):
    try:
        return vtk_to_itk_image(obj)
    except ConvertError:
        return obj


def convert_itk_to_vtkjs_image(obj):
    try:
        return itk_to_vtk_image(obj)
    except ConvertError:
        return obj
