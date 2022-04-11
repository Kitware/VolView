import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import { Vector2, Vector3 } from '@kitware/vtk.js/types';

export function computeWorldToDisplay(
  xyz: Vector3,
  renderer: vtkRenderer
): Vector3 | null {
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
): Vector2 | null {
  const view = renderer.getRenderWindow()?.getViews()?.[0];
  if (view) {
    const [x, y] = xy;
    const coords: Vector3 = view.displayToWorld(x, y, 0, renderer);
    return [coords[0], coords[1]] as Vector2;
  }
  return null;
}

/**
 * Converts world coordinates to SVG-friendly coordinates.
 *
 * Assumes that the SVG layer is the same size as the renderer.
 */
export function worldToSVG(xyz: Vector3, renderer: vtkRenderer) {
  const coords = computeWorldToDisplay(xyz, renderer);
  const view = renderer.getRenderWindow()?.getViews()?.[0];
  if (coords && view) {
    const [, height] = view.getViewportSize(renderer);
    // convert from canvas space to svg space
    coords[0] /= devicePixelRatio;
    coords[1] = (height - coords[1]) / devicePixelRatio;
  }
  return coords;
}
