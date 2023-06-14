from typing import Callable, List, Any

from volview_server.transformers.image_data import (
    convert_itk_to_vtkjs_image,
    convert_vtkjs_to_itk_image,
)


def pipe(input, *fns: List[Callable]):
    intermediate = input
    for fn in fns:
        intermediate = fn(intermediate)
    return intermediate


def transform_object(input: Any, transform: Callable):
    output = transform(input)

    if isinstance(output, list) or isinstance(output, tuple):
        return [transform_object(item, transform) for item in output]

    if isinstance(output, dict):
        return {
            key: transform_object(value, transform) for key, value in output.items()
        }

    return output


def transform_objects(objs: List[Any], transform: Callable):
    return [transform_object(obj, transform) for obj in objs]


default_serializers = [convert_itk_to_vtkjs_image]
default_deserializers = [convert_vtkjs_to_itk_image]
