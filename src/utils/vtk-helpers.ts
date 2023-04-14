import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { intersectDisplayWithPlane } from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { OpacityFunction } from '../types/views';

export function computeWorldToDisplay(
  xyz: Vector3,
  renderer: vtkRenderer
): Vector2 | null {
  const view = renderer.getRenderWindow()?.getViews()?.[0];
  if (view) {
    const [x, y, z] = xyz;
    return view.worldToDisplay(x, y, z, renderer);
  }
  return null;
}

export function computeDisplayToWorld(
  xy: Vector2,
  renderer: vtkRenderer
): Vector3 | null {
  const view = renderer.getRenderWindow()?.getViews()?.[0];
  if (view) {
    const [x, y] = xy;
    return view.displayToWorld(x, y, 0, renderer);
  }
  return null;
}

export function normalizeMouseEventPosition(
  ev: MouseEvent,
  view: vtkOpenGLRenderWindow
) {
  const canvas = view.getCanvas();
  if (!canvas) return null;

  const bounds = canvas.getBoundingClientRect();
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  return [
    scaleX * (ev.clientX - bounds.left),
    scaleY * (bounds.height - ev.clientY + bounds.top),
  ] as Vector2;
}

export function intersectMouseEventWithPlane(
  ev: MouseEvent,
  renderer: vtkRenderer,
  origin: Vector3,
  normal: Vector3
) {
  const view = renderer
    .getRenderWindow()
    ?.getViews()[0] as vtkOpenGLRenderWindow;
  if (!view) return null;

  const position = normalizeMouseEventPosition(ev, view);
  if (!position) return null;

  return intersectDisplayWithPlane(
    position[0],
    position[1],
    origin,
    normal,
    renderer,
    view
  );
}

/**
 * Converts world coordinates to SVG-friendly coordinates.
 *
 * Assumes that the SVG layer is the same size as the renderer.
 * TODO verify this is the case.
 */
export function worldToSVG(xyz: Vector3, renderer: vtkRenderer) {
  const coords = computeWorldToDisplay(xyz, renderer);
  const view = renderer.getRenderWindow()?.getViews()?.[0];
  if (coords && view) {
    const [, height] = view.getViewportSize(renderer);
    // convert from canvas space to svg space
    return [
      coords[0] / devicePixelRatio,
      (height - coords[1]) / devicePixelRatio,
    ] as Vector2;
  }
  return null;
}

/**
 * Gets the CSS coordinates for a vtk.js mouse event.
 */
export function getCSSCoordinatesFromEvent(eventData: any) {
  const { pokedRenderer }: { pokedRenderer: vtkRenderer } = eventData;
  const view = pokedRenderer?.getRenderWindow()?.getViews()?.[0] as
    | vtkOpenGLRenderWindow
    | undefined;
  const bbox = view?.getContainer()?.getBoundingClientRect();

  if (!('position' in eventData) || !bbox) {
    return null;
  }

  return [
    bbox.left + eventData.position.x / devicePixelRatio,
    bbox.top + bbox.height - eventData.position.y / devicePixelRatio,
  ] as Vector2;
}

/**
 * Shifts the opacity points from a preset.
 */
export function getShiftedOpacityFromPreset(
  presetName: string,
  effectiveRange: [number, number],
  shift: number
) {
  const preset = vtkColorMaps.getPresetByName(presetName);
  if (preset.OpacityPoints) {
    const OpacityPoints = preset.OpacityPoints as number[];
    const points = [];
    for (let i = 0; i < OpacityPoints.length; i += 2) {
      points.push([OpacityPoints[i], OpacityPoints[i + 1]]);
    }

    const [xmin, xmax] = effectiveRange;
    const width = xmax - xmin;
    return points.map(([x, y]) => [(x - xmin) / width + shift, y]);
  }
  return null;
}

/**
 * Retrieves an OpacityFunction from a preset.
 */
export function getOpacityFunctionFromPreset(
  presetName: string
): Partial<OpacityFunction> {
  const preset = vtkColorMaps.getPresetByName(presetName);

  if (preset.OpacityPoints) {
    return {
      mode: vtkPiecewiseFunctionProxy.Mode.Points,
      preset: presetName,
      shift: 0,
    };
  }
  return {
    mode: vtkPiecewiseFunctionProxy.Mode.Gaussians,
    // deep-copy necessary
    gaussians: JSON.parse(
      JSON.stringify(vtkPiecewiseFunctionProxy.Defaults.Gaussians)
    ),
  };
}

/**
 * Inflate an axis bounds defined as [min, max] by some delta.
 *
 * @param bounds Must be [number, number]. (Typed number[] for convenience.)
 * @param delta
 * @returns
 */
export function inflateAxisBounds(bounds: number[], delta: number) {
  return [bounds[0] + delta, bounds[1] + delta];
}

/**
 * Retrieves the color function range, if any.
 *
 * Will only return the color function range if the preset
 * has AbsoluteRange specified as true. For medical presets,
 * the range is defined by the transfer function point range,
 * rather than the dataset data range.
 * @param presetName
 * @returns
 */
export function getColorFunctionRangeFromPreset(
  presetName: string
): [number, number] | null {
  const preset = vtkColorMaps.getPresetByName(presetName);
  if (!preset) return null;

  const { AbsoluteRange, RGBPoints } = preset;
  if (AbsoluteRange && RGBPoints) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < RGBPoints.length; i += 4) {
      min = Math.min(min, RGBPoints[i]);
      max = Math.max(max, RGBPoints[i]);
    }
    return [min, max];
  }
  return null;
}

/**
 * Retrieves the effective opacity mapping range, if any.
 *
 * Presets may specify an effective range for the scalar opacity
 * mapping range.
 * @param presetName
 * @returns
 */
export function getOpacityRangeFromPreset(presetName: string) {
  const preset = vtkColorMaps.getPresetByName(presetName);
  if (preset.EffectiveRange) {
    return [...preset.EffectiveRange] as [number, number];
  }
  return null;
}
