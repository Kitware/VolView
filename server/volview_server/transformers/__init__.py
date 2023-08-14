from typing import Callable, List, Any

Transformer = Callable[[Any], Any]

from volview_server.transformers.image_data import (
    convert_itk_to_vtkjs_image,
    convert_vtkjs_to_itk_image,
)


def pipe(input, *fns: List[Transformer]):
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


default_serializers: List[Transformer] = [convert_itk_to_vtkjs_image]
default_deserializers: List[Transformer] = [convert_vtkjs_to_itk_image]
