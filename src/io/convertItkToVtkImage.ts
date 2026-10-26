import { convertItkToVtkImage as convert } from '@kitware/vtk.js/Common/DataModel/ITKHelper';

export function convertItkToVtkImage(image: Parameters<typeof convert>[0]) {
  const vtkImage = convert(image);
  if (!vtkImage) {
    throw new Error(
      `Unsupported ITK image pixel type: ${image.imageType.pixelType}`
    );
  }
  return vtkImage;
}
