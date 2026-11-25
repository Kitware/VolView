import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

/** Per-component min, max and mean, for data no exact hash can pin down. */
function componentStats(pixels: Float64Array, components: number) {
  const min = Array<number>(components).fill(Infinity);
  const max = Array<number>(components).fill(-Infinity);
  const sum = Array<number>(components).fill(0);
  pixels.forEach((value, index) => {
    const c = index % components;
    min[c] = Math.min(min[c], value);
    max[c] = Math.max(max[c], value);
    sum[c] += value;
  });
  const count = pixels.length / components;
  return { min, max, mean: sum.map((total) => total / count) };
}

/** Public page output used to check geometry and every calibrated voxel. */
export async function describeVolume(
  image: vtkImageData,
  report: (name: string, value: string) => void
) {
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
  report(
    'pixel-stats',
    JSON.stringify(componentStats(pixels, scalars.getNumberOfComponents()))
  );
  const digest = await crypto.subtle.digest('SHA-256', pixels.buffer);
  report(
    'pixel-hash',
    Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, '0')
    ).join('')
  );
}
