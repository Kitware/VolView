import {
  serializeVtkImageData,
  deserializeVtkImageData,
} from '@/src/core/remote/transformers/vtkImageData';

export const DefaultSerializeTransformers = [serializeVtkImageData];
export const DefaultDeserializeTransformers = [deserializeVtkImageData];

type ObjectTransformer = (obj: any) => any;

export function transformObject(input: any, transform: ObjectTransformer): any {
  const output = transform(input);

  if (!output || typeof output !== 'object') {
    return output;
  }

  if (Array.isArray(output)) {
    return output.map((o) => transformObject(o, transform));
  }

  return Object.entries(output).reduce(
    (obj, [key, value]) => ({ ...obj, [key]: value }),
    {}
  );
}

export function transformObjects(
  args: any[],
  transform: ObjectTransformer
): any[] {
  return args.map((arg) => transformObject(arg, transform));
}
