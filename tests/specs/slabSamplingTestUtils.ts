/** Linear samples through a physical slab, including its two endpoints. */
export function linearSlabSamples(
  values: readonly number[],
  selection: {
    first: number;
    last: number;
    spacing: number;
    minimumSpacing: number;
  }
) {
  const { first, last, spacing, minimumSpacing } = selection;
  const interpolate = (index: number) => {
    const lower = Math.floor(index);
    const upper = Math.min(values.length - 1, Math.ceil(index));
    return values[lower] + (index - lower) * (values[upper] - values[lower]);
  };
  const center = (first + last) / 2;
  const halfDepth = (last - first) / 2;
  const halfSteps = Math.ceil(((last - first) * spacing) / minimumSpacing);
  const offsets = Array.from({ length: halfSteps }, (_, index) =>
    Math.min(halfDepth, ((index + 1) * minimumSpacing) / (2 * spacing))
  );
  return [
    interpolate(center),
    ...offsets.flatMap((offset) => [
      interpolate(center - offset),
      interpolate(center + offset),
    ]),
  ];
}

export async function projectionGrayscaleDistribution() {
  const source = await $('[data-testid="oct-en-face-canvas"]').getElement();
  return source.execute((element) => {
    const canvas = element as HTMLCanvasElement;
    const copy = document.createElement('canvas').getContext('2d')!;
    copy.canvas.width = canvas.width;
    copy.canvas.height = canvas.height;
    copy.drawImage(canvas, 0, 0);
    const pixels = copy.getImageData(0, 0, canvas.width, canvas.height).data;
    const histogram = new Uint32Array(256);
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && pixels[i] > 0) {
        histogram[pixels[i]]++;
        count++;
      }
    }
    const percentile = (fraction: number) => {
      let total = 0;
      return histogram.findIndex((frequency) => {
        total += frequency;
        return total >= count * fraction;
      });
    };
    return { count, low: percentile(0.05), high: percentile(0.95) };
  });
}
