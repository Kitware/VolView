import struct
import numpy as np

TYPE_ARRAY_JS_TO_NUMPY = {
    "Int8Array": np.int8,
    "Int8ClampedArray": np.int8,
    "Int16Array": np.int16,
    "Int32Array": np.int32,
    "Uint8Array": np.uint8,
    "Uint16Array": np.uint16,
    "Uint32Array": np.uint32,
    "Float32Array": np.float32,
    "Float64Array": np.float64,
}

TYPE_ARRAY_ITKCOMP_TO_JS = {
    "SC": "Int8Array",
    "UC": "Uint8Array",
    "SS": "Int16Array",
    "US": "Uint16Array",
    "SI": "Int32Array",
    "UI": "Uint32Array",
    "F": "Float32Array",
    "D": "Float64Array",
    "B": "Uint8Array",
}


def itk_image_pixel_type_to_js(itk_image):
    """Gets the JS pixel type from an ITK image."""
    component_str = repr(itk_image).split("itkImagePython.")[1].split(";")[0][8:]
    # TODO handle mangling as per
    # https://github.com/InsightSoftwareConsortium/itk-jupyter-widgets/blob/master/itkwidgets/trait_types.py#L49
    return TYPE_ARRAY_ITKCOMP_TO_JS[component_str[:-1]]
