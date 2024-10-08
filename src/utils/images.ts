import { Image } from 'itk-wasm';

export const pullComponent0 = (image: Image) => {
  const srcComponentCount = image.imageType.components;
  const srcPixelArray = image.data!;
  const oneComponentArrayLength = srcPixelArray.length / srcComponentCount;
  const pixelArray = new (srcPixelArray.constructor as {
    new (length: number): typeof srcPixelArray;
  })(oneComponentArrayLength);
  for (let pixel = 0; pixel < oneComponentArrayLength; pixel++) {
    pixelArray[pixel] = srcPixelArray[pixel * srcComponentCount];
  }
  return {
    ...image,
    data: pixelArray,
    imageType: {
      ...image.imageType,
      components: 1,
    },
  };
};
