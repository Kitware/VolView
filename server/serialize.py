import json
import struct
import itk
import numpy as np

JS_TO_NPY_TYPEMAP = {
    'Int8Array': {
        'struct': (1, 'b'),
        'dtype': 'int8',
    },
    'Int16Array': {
        'struct': (2, 'h'),
        'dtype': 'int16',
    },
    'Int32Array': {
        'struct': (4, 'i'),
        'dtype': 'int32',
    },
    'Uint8Array': {
        'struct': (1, 'B'),
        'dtype': 'uint8',
    },
    'Uint16Array': {
        'struct': (2, 'H'),
        'dtype': 'uint16',
    },
    'Uint32Array': {
        'struct': (4, 'I'),
        'dtype': 'uint32',
    },
    'Float32Array': {
        'struct': (4, 'f'),
        'dtype': 'float32',
    },
    'Float64Array': {
        'struct': (8, 'd'),
        'dtype': 'float64',
    },
}

ITK_COMP_TO_JS_TYPEMAP = {
    'SC': 'Int8Array',
    'UC': 'Uint8Array',
    'SS': 'Int16Array',
    'US': 'Uint16Array',
    'SI': 'Int32Array',
    'UI': 'Uint32Array',
    'F': 'Float32Array',
    'D': 'Float64Array',
    'B': 'Uint8Array'
}


def bytebuffer_to_numpy(blob, js_type):
    typeinfo = JS_TO_NPY_TYPEMAP[js_type]
    size, fmt = typeinfo['struct']
    dtype = np.dtype(typeinfo['dtype'])

    if len(blob) % size != 0:
        raise ValueError('given byte buffer is not aligned to the type')

    full_fmt = '<{0}{1}'.format(len(blob) // size, fmt)
    return np.array(struct.unpack(full_fmt, blob), dtype=dtype, copy=False)


def itk_image_pixel_type_to_js(itk_image):
    component_str = repr(itk_image).split(
        'itkImagePython.')[1].split(';')[0][8:]
    # TODO handle mangling as per https://github.com/InsightSoftwareConsortium/itk-jupyter-widgets/blob/master/itkwidgets/trait_types.py#L49
    return ITK_COMP_TO_JS_TYPEMAP[component_str[:-1]]


class RpcEncoder(object):
    def __init__(self, encoders=[], extra_args=[], extra_kwargs={}):
        self._encoders = list(encoders)
        self._extra_args = extra_args
        self._extra_kwargs = extra_kwargs

    def add_encoder(self, encoder):
        self._encoders.append(encoder)

    def remove_encoder(self, encoder):
        self._encoders.remove(encoder)

    def run_encoders(self, obj):
        output = obj
        for encoder in self._encoders:
            output = encoder(output, *self._extra_args, **self._extra_kwargs)
        return output

    def encode(self, obj):
        # run on every possible value
        if isinstance(obj, list):
            return self.run_encoders([self.encode(item) for item in obj])
        if isinstance(obj, dict):
            return self.run_encoders({k: self.encode(v) for k, v in obj.items()})
        else:
            return self.run_encoders(obj)


class RpcDecoder(object):
    def __init__(self, hooks=[], extra_args=[], extra_kwargs={}):
        self._hooks = list(hooks)
        self._extra_args = extra_args
        self._extra_kwargs = extra_kwargs

    def add_hook(self, hook):
        self._hooks.append(hook)

    def remove_hook(self, hook):
        self._hooks.remove(hook)

    def run_hooks(self, val):
        output = val
        for hook in self._hooks:
            output = hook(output, *self._extra_args, **self._extra_kwargs)
        return output

    def decode(self, obj):
        # only run hooks on dictionaries
        if isinstance(obj, list):
            return [self.decode(item) for item in obj]
        if isinstance(obj, dict):
            return self.run_hooks({k: self.decode(v) for k, v in obj.items()})
        else:
            return obj


def itk_image_encoder(obj, attach):
    if type(obj).__name__.startswith('itkImage'):
        img = obj
        size = list(img.GetLargestPossibleRegion().GetSize())
        values = itk.GetArrayFromImage(img).flatten(order='C')
        return {
            'vtkClass': 'vtkImageData',
            'dataDescription': 8,
            'direction': list(
                itk.GetArrayFromVnlMatrix(
                    img.GetDirection().GetVnlMatrix().as_matrix()
                ).flatten()
            ),
            'extent': [
                0, size[0] - 1,
                0, size[1] - 1,
                0, size[2] - 1,
            ],
            'spacing': list(img.GetSpacing()),
            'origin': list(img.GetOrigin()),
            'pointData': {
                'vtkClass': 'vtkDataSetAttributes',
                'activeScalars': 0,  # the index of the only array
                'arrays': [
                    {
                        'data': {
                            'vtkClass': 'vtkDataArray',
                            'size': len(values),
                            'values': attach(values.tobytes()),
                            'dataType': itk_image_pixel_type_to_js(img),
                            'numberOfComponents': img.GetNumberOfComponentsPerPixel(),
                            'name': 'Scalars',
                        }
                    }
                ]
            }
        }
    return obj


def itk_image_decode_hook(obj):
    if isinstance(obj, dict) and obj.get('vtkClass', None) == 'vtkImageData':
        data_array = obj['pointData']['arrays'][0]['data']
        pixel_data = bytebuffer_to_numpy(
            data_array['values'], data_array['dataType'])

        extent = obj['extent']
        # numpy indexes in ZYX order, where X varies the fastest
        dims = [
            extent[5] - extent[4] + 1,
            extent[3] - extent[2] + 1,
            extent[1] - extent[0] + 1,
        ]
        direction = np.zeros((3, 3))
        for x in range(3):
            for y in range(3):
                direction[x][y] = obj['direction'][x*3+y]

        itk_image = itk.GetImageFromArray(np.reshape(pixel_data, dims))
        # https://discourse.itk.org/t/set-image-direction-from-numpy-array/844/10
        vnlmat = itk.GetVnlMatrixFromArray(direction)
        itk_image.GetDirection().GetVnlMatrix().copy_in(vnlmat.data_block())
        itk_image.SetOrigin(obj['origin'])
        itk_image.SetSpacing(obj['spacing'])
        return itk_image
    return obj


DEFAULT_DECODERS = [
    itk_image_decode_hook,
]

DEFAULT_ENCODERS = [
    itk_image_encoder,
]
