import struct
import numpy as np

JS_TO_NPY_TYPEMAP = {
    "Int8Array": {
        "struct": (1, "b"),
        "dtype": "int8",
    },
    "Int16Array": {
        "struct": (2, "h"),
        "dtype": "int16",
    },
    "Int32Array": {
        "struct": (4, "i"),
        "dtype": "int32",
    },
    "Uint8Array": {
        "struct": (1, "B"),
        "dtype": "uint8",
    },
    "Uint16Array": {
        "struct": (2, "H"),
        "dtype": "uint16",
    },
    "Uint32Array": {
        "struct": (4, "I"),
        "dtype": "uint32",
    },
    "Float32Array": {
        "struct": (4, "f"),
        "dtype": "float32",
    },
    "Float64Array": {
        "struct": (8, "d"),
        "dtype": "float64",
    },
}

ITK_COMP_TO_JS_TYPEMAP = {
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


def bytebuffer_to_numpy(blob, js_type):
    """Converts a JS ArrayBuffer blob to a numpy array."""
    typeinfo = JS_TO_NPY_TYPEMAP[js_type]
    size, fmt = typeinfo["struct"]
    dtype = np.dtype(typeinfo["dtype"])

    if len(blob) % size != 0:
        raise ValueError("given byte buffer is not aligned to the type")

    full_fmt = "<{0}{1}".format(len(blob) // size, fmt)
    return np.array(struct.unpack(full_fmt, blob), dtype=dtype, copy=False)


def itk_image_pixel_type_to_js(itk_image):
    """Gets the JS pixel type from an ITK image."""
    component_str = repr(itk_image).split("itkImagePython.")[1].split(";")[0][8:]
    # TODO handle mangling as per
    # https://github.com/InsightSoftwareConsortium/itk-jupyter-widgets/blob/master/itkwidgets/trait_types.py#L49
    return ITK_COMP_TO_JS_TYPEMAP[component_str[:-1]]
