import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

type Range = readonly [number, number];
const samples = new WeakMap<object, number[][]>();
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function getSamples(
  preset: NonNullable<ReturnType<typeof vtkColorMaps.getPresetByName>>
) {
  const cached = samples.get(preset);
  if (cached) return cached;
  const colors = vtkColorTransferFunction.newInstance();
  colors.applyColorMap(preset);
  colors.setMappingRange(0, 1);
  colors.updateRange();
  // Sample VTK interpolation so HSV and Lab palettes match the rendered image.
  const result = Array.from({ length: 256 }, (_, index) => {
    const rgb = [0, 0, 0];
    colors.getColor(index / 255, rgb);
    return rgb;
  });
  colors.delete();
  samples.set(preset, result);
  return result;
}

export function colorMapGradient(
  name: string,
  domain: Range = [0, 1],
  mappingRange: Range = [0, 1],
  transparentBackground = false
) {
  const preset = vtkColorMaps.getPresetByName(name);
  const [low, high] = domain;
  const [min, max] = mappingRange;
  const width = max - min;
  const span = high - low;
  if (
    !preset ||
    ![...domain, ...mappingRange, span, width].every(Number.isFinite) ||
    span < 0 ||
    width <= 0
  )
    return undefined;
  const colors = getSamples(preset);
  const mix = (start: number, end: number, fraction: number) =>
    start * (1 - fraction) + end * fraction;
  // Sampling the window preserves narrow ramps within a much wider image range.
  const values = [
    low,
    high,
    mix(min, max, 0.1),
    ...Array.from({ length: colors.length }, (_, index) =>
      mix(min, max, index / (colors.length - 1))
    ),
  ].filter((value) => value >= low && value <= high);
  const stops = [...new Set(values)]
    .sort((a, b) => a - b)
    .map((value) => {
      const fraction =
        value <= min ? 0 : value >= max ? 1 : (value - min) / width;
      const index = clamp(fraction) * (colors.length - 1);
      const first = Math.floor(index);
      const second = Math.min(first + 1, colors.length - 1);
      const rgb = colors[first].map((channel, component) =>
        Math.round(mix(channel, colors[second][component], index - first) * 255)
      );
      const alpha = transparentBackground ? clamp(fraction * 10) : 1;
      const position = span === 0 ? 0 : ((value - low) / span) * 100;
      return `rgba(${rgb.join(',')},${alpha}) ${position}%`;
    });
  if (stops.length === 1) stops.push(stops[0].replace(' 0%', ' 100%'));
  return `linear-gradient(to right, ${stops.join(',')})`;
}
