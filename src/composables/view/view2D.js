import { mat3, vec3 } from 'gl-matrix';
import { computed, ref, unref, watch, watchEffect } from '@vue/composition-api';

import vtkPlane from 'vtk.js/Sources/Common/DataModel/Plane';
import InteractionPresets from 'vtk.js/Sources/Interaction/Style/InteractorStyleManipulator/Presets';
import vtkMouseRangeManipulator from 'vtk.js/Sources/Interaction/Manipulators/MouseRangeManipulator';
import { WIDGET_PRIORITY } from 'vtk.js/Sources/Widgets/Core/AbstractWidget/Constants';

import { useSubscription } from '@/src/composables/vtk';
import { useProxyManager } from '@/src/composables/proxyManager';
import { useElementListener } from '@/src/composables/domEvents';
import { useViewContainer } from '@/src/composables/view/common';
import { zip, worldToIndexRotation } from '@/src/utils/common';

const EPS = 10e-6;

// priority of the pixel mouse probe
export const PROBE_PRIORITY = WIDGET_PRIORITY + 10;

function lpsDirToLabels(dir) {
  const [x, y, z] = dir;
  let label = '';
  if (x > EPS) label += 'L';
  else if (x < -EPS) label += 'R';
  if (y > EPS) label += 'P';
  else if (y < -EPS) label += 'A';
  if (z > EPS) label += 'S';
  else if (z < -EPS) label += 'I';
  return label;
}

/**
 * Writes out left and up orientation labels.
 * @param {Ref<vtkViewProxy>} viewRef
 * @param {Ref<ImageConfig>} imageConfig
 */
export function useOrientationLabels(viewRef, imageConfig) {
  const leftLabel = ref('');
  const upLabel = ref('');

  function updateLabels() {
    const view = unref(viewRef);
    if (view) {
      const camera = view.getCamera();
      // TODO make modifications only if vup and vdir differ
      const vup = camera.getViewUp();
      const vdir = camera.getDirectionOfProjection();
      const vright = [0, 0, 0];
      vec3.cross(vright, vdir, vup);

      // assume direction is orthonormal
      const { direction } = unref(imageConfig);

      // since camera is in "image space", transform into
      // image's world space.
      const cameraMat = mat3.fromValues(...vright, ...vup, ...vdir);
      const imageMat = mat3.fromValues(...direction);
      // `direction` is row-major, and gl-matrix is col-major
      mat3.transpose(imageMat, imageMat);
      const cameraInImWorld = mat3.create();
      mat3.mul(cameraInImWorld, imageMat, cameraMat);

      // gl-matrix is col-major
      const left = cameraInImWorld.slice(0, 3).map((c) => -c);
      const up = cameraInImWorld.slice(3, 6);

      const leftLabels = lpsDirToLabels(left);
      const upLabels = lpsDirToLabels(up);

      // sort by magnitude
      leftLabel.value = zip(left.map(Math.abs), leftLabels)
        .sort(([a], [b]) => b - a)
        .map(([, label]) => label)
        .join('');
      upLabel.value = zip(up.map(Math.abs), upLabels)
        .sort(([a], [b]) => b - a)
        .map(([, label]) => label)
        .join('');
    }
  }

  useSubscription(viewRef, (view) => view.getCamera().onModified(updateLabels));
  updateLabels();

  return {
    leftLabel,
    upLabel,
  };
}

export function use2DMouseControls(
  viewRef,
  verticalRange,
  horiontalRange,
  scrollRange,
  interactionDefs
) {
  const rangeManipulator = vtkMouseRangeManipulator.newInstance({
    button: 1,
    scrollEnabled: true,
  });
  const vertVal = ref(verticalRange.value.default);
  const horizVal = ref(horiontalRange.value.default);
  const scrollVal = ref(scrollRange.value.default);

  function updateManipulator() {
    rangeManipulator.removeAllListeners();
    const vertRange = unref(verticalRange);
    const horizRange = unref(horiontalRange);
    const scRange = unref(scrollRange);

    rangeManipulator.setVerticalListener(
      vertRange.min,
      vertRange.max,
      vertRange.step,
      () => vertVal.value,
      (v) => {
        vertVal.value = v;
      }
    );

    rangeManipulator.setHorizontalListener(
      horizRange.min,
      horizRange.max,
      horizRange.step,
      () => horizVal.value,
      (v) => {
        horizVal.value = v;
      }
    );

    rangeManipulator.setScrollListener(
      scRange.min,
      scRange.max,
      scRange.step,
      () => scrollVal.value,
      (v) => {
        scrollVal.value = v;
      }
    );
  }

  watchEffect(() => {
    const view = unref(viewRef);
    if (view) {
      const istyle = view.getInteractorStyle2D();

      // removes all manipulators
      InteractionPresets.applyDefinitions(interactionDefs, istyle);

      istyle.addMouseManipulator(rangeManipulator);
    }
  });

  watch([verticalRange, horiontalRange, scrollRange], updateManipulator);

  return { vertVal, horizVal, scrollVal };
}

/**
 *
 * @param {{ origin, normal }} plane Plane (world-space)
 * @param {{ near, far }} probeVec Probe vector (world-space)
 * @param {vtkImageData} imageData
 */
export function computePixelAt(plane, probeVec, imageData) {
  const intersection = vtkPlane.intersectWithLine(
    probeVec.near,
    probeVec.far,
    plane.origin,
    plane.normal
  );
  if (intersection.intersection) {
    const point = intersection.x;
    const [i, j, k] = imageData.worldToIndex(point).map((c) =>
      // this is a hack to work around the first slice sometimes being
      // very close to zero, but not quite, resulting in being unable to
      // see pixel values for 0th slice.
      Math.abs(c) < 1e-8 ? Math.round(c) : c
    );
    const extent = imageData.getExtent();
    if (
      i >= extent[0] &&
      i <= extent[1] &&
      j >= extent[2] &&
      j <= extent[3] &&
      k >= extent[4] &&
      k <= extent[5]
    ) {
      const offsetIndex = imageData.computeOffsetIndex([i, j, k]);
      const pixel = imageData.getPointData().getScalars().getTuple(offsetIndex);

      return {
        location: [i, j, k],
        value: pixel,
        numberOfComponents: pixel.length,
      };
    }
  }
  return null;
}

/**
 * Computes the pixel value of an image under the cursor.
 * @param {Ref<vtkViewProxy>} viewRef
 * @param {Ref<vtkSourceProxy>} baseImage
 */
export function usePixelProbe(viewRef, baseImage) {
  const plane = ref({
    normal: [0, 0, 1],
    origin: [0, 0, 0],
  });
  const probeVec = ref({
    near: [0, 0, 0],
    far: [0, 0, 0],
  });
  const pixelProbe = ref(null);

  const pxm = useProxyManager();

  const baseRep = computed(() => {
    if (viewRef.value && baseImage.value) {
      return pxm.getRepresentation(baseImage.value, viewRef.value);
    }
    return null;
  });

  const image = computed(() => {
    if (baseRep.value) {
      return baseRep.value.getMapper().getInputData();
    }
    return null;
  });

  function onMouseMove(view, ev) {
    if (baseImage.value && ev.pokedRenderer === view.getRenderer()) {
      const { x, y } = ev.position;
      const renderer = view.getRenderer();
      const gl = view.getOpenglRenderWindow();
      if (gl) {
        probeVec.value = {
          near: gl.displayToWorld(x, y, 0, renderer),
          far: gl.displayToWorld(x, y, 1, renderer),
        };
      }
    }
  }

  function computeIntersectionPlane(rep) {
    // 2D slice rep
    if (image.value && rep?.getSlice && rep?.getSlicingMode) {
      const mode = rep.getSlicingMode();
      const slice = rep.getSlice();

      const axis = 'XYZIJK'.indexOf(mode);
      if (axis > -1) {
        let origin = [0, 0, 0];
        let normal = [0, 0, 0];
        origin[axis % 3] = slice;
        normal[axis % 3] = 1;

        // transform from index to world if required
        if (axis >= 3) {
          origin = image.value.indexToWorld(normal);
          normal = worldToIndexRotation(image.value, normal);
        }

        if (
          !vec3.exactEquals(plane.value.normal, normal) ||
          !vec3.exactEquals(plane.value.origin, origin)
        ) {
          plane.value = { normal, origin };
        }
      }
    }
  }

  watch([plane, probeVec], ([planeVal, probeVecVal]) => {
    if (image.value) {
      pixelProbe.value = computePixelAt(planeVal, probeVecVal, image.value);
    }
  });

  useSubscription(viewRef, (view) =>
    view
      .getInteractor()
      .onMouseMove((ev) => onMouseMove(view, ev), WIDGET_PRIORITY + 10)
  );

  useSubscription(baseRep, (rep) =>
    rep.onModified(() => computeIntersectionPlane(rep))
  );

  watch(baseRep, (rep) => computeIntersectionPlane(rep), { immediate: true });

  // clear pixel probe when mouse leaves view
  const { container: viewContainer } = useViewContainer(viewRef);
  useElementListener(viewContainer, 'mouseleave', () => {
    pixelProbe.value = null;
  });

  return {
    plane,
    probeVec,
    pixelProbe,
  };
}
