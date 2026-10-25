import type { VtkDicomImage } from '@volview/dicom/vtk';

/** Public consumer output used to check geometry and every calibrated voxel. */
export async function describeVolume(
  volume: VtkDicomImage,
  report: (name: string, value: string) => void
) {
  const image = volume.getVtkImageData();
  const dimensions = image.getDimensions();
  const scalars = image.getPointData().getScalars();
  report('dimensions', dimensions.join(', '));
  report('spacing', image.getSpacing().join(', '));
  report('origin', image.getOrigin().join(', '));
  report('direction', Array.from(image.getDirection()).join(', '));
  report('range', scalars.getRange().join(', '));
  report('first-plane', image.indexToWorld([0, 0, 0]).join(', '));
  report(
    'last-plane',
    image.indexToWorld([0, 0, dimensions[2] - 1]).join(', ')
  );
  const pixels = Float64Array.from(scalars.getData());
  const digest = await crypto.subtle.digest('SHA-256', pixels.buffer);
  report(
    'pixel-hash',
    Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, '0')
    ).join('')
  );
}
