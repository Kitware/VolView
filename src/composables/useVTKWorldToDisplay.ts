import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { computed, ref, unref, watchEffect } from 'vue';
import { MaybeRef, useResizeObserver } from '@vueuse/core';
import { vec3 } from 'gl-matrix';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { Maybe } from '@/src/types';
import { computeWorldToDisplay } from '../utils/vtk-helpers';

type MaybeCoords = Maybe<Vector3 | vec3>;
type MaybeMultiCoords = Maybe<Vector3[] | vec3[]>;
type MaybeRenderer = Maybe<vtkRenderer>;

/**
 * Returns a reactive vtkOpenGLRenderWindow container ref.
 *
 * @param view
 * @returns
 */
export function useVTKViewContainer(
  view: MaybeRef<Maybe<vtkOpenGLRenderWindow>>
) {
  const container = ref<HTMLElement | null>(null);

  const update = () => {
    container.value = unref(view)?.getContainer() ?? null;
  };

  onVTKEvent(view, 'onModified', update);
  update();

  return container;
}

/**
 * Transforms a list of world coordinates into display coordinates.
 *
 * @param worldCoords
 * @param renderer
 * @returns
 */
export function useVTKMultiWorldToDisplay(
  worldCoords: MaybeRef<MaybeMultiCoords>,
  renderer: MaybeRef<MaybeRenderer>
) {
  const displayCoords = ref<Vector2[]>([]);
  const view = computed(
    () =>
      unref(renderer)
        ?.getRenderWindow()
        ?.getViews()?.[0] as vtkOpenGLRenderWindow
  );
  const container = useVTKViewContainer(view);

  const update = () => {
    const coords = unref(worldCoords);
    const ren = unref(renderer);

    if (coords == null || !ren) {
      return;
    }

    displayCoords.value = coords.map((xyz) => {
      const disp = computeWorldToDisplay(xyz as Vector3, ren)!;
      // convert from canvas space to display space
      return [
        disp[0] / devicePixelRatio,
        disp[1] / devicePixelRatio,
      ] as Vector2;
    }) as Vector2[];
  };

  const camera = computed(() => unref(renderer)?.getActiveCamera());
  useResizeObserver(container, update);
  watchEffect(update);
  onVTKEvent(camera, 'onModified', update);
  update();

  return displayCoords;
}

/**
 * Transforms a single world coordinate into a display coordinate.
 *
 * @param worldCoords
 * @param renderer
 * @returns
 */
export function useVTKWorldToDisplay(
  worldCoords: MaybeRef<MaybeCoords>,
  renderer: MaybeRef<MaybeRenderer>
) {
  const manyCoords = computed(() => {
    const c = unref(worldCoords);
    if (c != null) {
      return [c];
    }
    return null;
  });

  const displayCoords = useVTKMultiWorldToDisplay(manyCoords, renderer);
  return computed(() => {
    if (displayCoords.value.length === 1) {
      return displayCoords.value[0];
    }
    return null;
  });
}

/**
 * Transforms a list of world coordinates into SVG coordinates.
 *
 * @param worldCoords
 * @param renderer
 * @returns
 */
export function useVTKMultiWorldToSVG(
  worldCoords: MaybeRef<MaybeMultiCoords>,
  renderer: MaybeRef<MaybeRenderer>
) {
  const displayCoords = useVTKMultiWorldToDisplay(worldCoords, renderer);
  const svgCoords = computed(() => {
    const disp = displayCoords.value;
    const ren = unref(renderer);
    const view = ren?.getRenderWindow()?.getViews()?.[0];
    if (ren && view) {
      const [, height] = view.getViewportSize(ren);
      return disp.map((xy) => {
        // flip Y axis
        return [xy[0], height / devicePixelRatio - xy[1]];
      });
    }
    return null;
  });

  return svgCoords;
}
