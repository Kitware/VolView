import { vec3 } from 'gl-matrix';
import { computed, ref, unref, watch, watchEffect } from '@vue/composition-api';

import vtkPlane from 'vtk.js/Sources/Common/DataModel/Plane';
import InteractionPresets from 'vtk.js/Sources/Interaction/Style/InteractorStyleManipulator/Presets';
import vtkMouseRangeManipulator from 'vtk.js/Sources/Interaction/Manipulators/MouseRangeManipulator';
import { WIDGET_PRIORITY } from 'vtk.js/Sources/Widgets/Core/AbstractWidget/Constants';

import { useSubscription } from '@/src/composables/vtk';
import { useProxyManager } from '@/src/composables/proxyManager';
import { useElementListener } from '@/src/composables/domEvents';
import { useViewContainer } from '@/src/composables/view/common';
import { useComputedState } from '@/src/composables/store';
import { indexToWorldRotation, multiComputed } from '@/src/utils/common';

const EPS = 10e-6;

// priority of the pixel mouse probe
export const PROBE_PRIORITY = WIDGET_PRIORITY + 10;

// a signed axis has domain [+-1, +-2, +-3].
// Adding 3, we shift the domain to [0, 1, 2, 4, 5, 6],
// so the the 3rd index is not used.
const LABELS = 'IAR_LPS';

function signedAxesToLabels(axes) {
  return axes.map((sa) => LABELS[sa + 3]).join('');
}

function sortAndOrientAxes(vec) {
  return (
    vec
      // track each component's signed axis,
      // and shift axes to be 1-indexed so we can differentiate between 0 and -0
      .map((component, axis) => [component, Math.sign(component) * (axis + 1)])
      // remove components close to zero
      .filter(([component]) => Math.abs(component) > EPS)
      // sort components in decreasing order
      .sort(([c1], [c2]) => c2 - c1)
      // pick out the axes, now sorted by decreasing magnitude
      .map(([, signedAxis]) => signedAxis)
  );
}

/**
 * Computes orientation labels for a given view.
 *
 * Labels are with respect to the current camera orientation.
 *
 * vtk.js world axis is implied to be LPS, so orientation labels
 * are determined solely from the camera' direction and view-up.
 *
 * @param {Ref<vtkViewProxy>} viewRef
 */
export function useOrientationLabels(viewRef) {
  const rightAxes = ref([]);
  const upAxes = ref([]);

  const top = computed(() => signedAxesToLabels(upAxes.value));
  const right = computed(() => signedAxesToLabels(rightAxes.value));
  const bottom = computed(() =>
    signedAxesToLabels(upAxes.value.map((a) => -a))
  );
  const left = computed(() =>
    signedAxesToLabels(rightAxes.value.map((a) => -a))
  );

  function updateAxes() {
    const view = unref(viewRef);
    if (view) {
      const camera = view.getCamera();
      const vup = camera.getViewUp();
      const vdir = camera.getDirectionOfProjection();
      const vright = [0, 0, 0];
      // assumption: vright and vdir are not equal
      // (which should be the case for the camera)
      vec3.cross(vright, vdir, vup);

      rightAxes.value = sortAndOrientAxes(vright);
      upAxes.value = sortAndOrientAxes(vup);
    }
  }

  useSubscription(viewRef, (view) => view.getCamera().onModified(updateAxes));
  updateAxes();

  return { top, right, bottom, left };
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
  const vertVal = ref(0);
  const horizVal = ref(0);
  const scrollVal = ref(0);

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

  // reset vals when the ranges reset
  watch(
    [verticalRange, horiontalRange, scrollRange],
    ([vRange, hRange, scRange]) => {
      vertVal.value = vRange.default;
      horizVal.value = hRange.default;
      scrollVal.value = scRange.default;
    },
    { immediate: true }
  );

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
      Math.abs(c) < 1e-4 ? Math.round(c) : c
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
          origin = image.value.indexToWorld(origin);
          normal = indexToWorldRotation(image.value, normal);
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

// mat3x3 is taken to be column-major
function findClosestFrameVec(mat3x3, axis) {
  let closestIndex = 0;
  let closestSign = 1;
  let closest = -Infinity;
  let vector = [];
  for (let idx = 0; idx < 3; idx += 1) {
    const indexDir = vec3.fromValues(
      mat3x3[idx * 3 + 0],
      mat3x3[idx * 3 + 1],
      mat3x3[idx * 3 + 2]
    );
    const cosine = vec3.dot(indexDir, axis);
    const sign = Math.sign(cosine);
    const howClose = Math.abs(cosine);
    if (howClose > closest) {
      closest = howClose;
      closestIndex = idx;
      closestSign = sign;
      vector = indexDir;
    }
  }

  return {
    howClose: closest,
    vectorIndex: closestIndex,
    sign: closestSign,
    vector,
  };
}

const ViewTypeAxis = {
  ViewX: [1, 0, 0],
  ViewY: [0, -1, 0],
  ViewZ: [0, 0, -1],
};

export function useIJKAxisCamera(viewType) {
  const { direction } = useComputedState({
    direction: (state) => state.visualization.imageParams.direction,
  });

  return multiComputed(() => {
    const viewDir = ViewTypeAxis[viewType.value];
    const { vectorIndex: axis, sign: orientation } = findClosestFrameVec(
      direction.value,
      viewDir
    );

    let viewUp = [1, 0, 0];
    let viewUpAxis = 0;
    switch (axis) {
      case 0:
      case 1: {
        viewUp = [0, 0, 1]; // superior
        viewUpAxis = 2;
        break;
      }
      case 2: {
        viewUp = [0, -1, 0]; // anterior
        viewUpAxis = 1;
        break;
      }
      default:
      // noop;
    }

    return {
      axis, // 1=I, 2=J, 3=K
      orientation,
      viewUp,
      viewUpAxis,
    };
  });
}

/**
 * Sets the camera based on camera configuration parameters.
 * @param {Ref<vtkViewProxy>} view
 * @param {Ref<ImageParams>} imageParams
 * @param {Ref<number[3]>} viewUp
 * @param {Ref<-1|1>} orientation
 * @param {Ref<0|1|2>} axis
 * @param {'image'|'world'} frame
 */
export function apply2DCameraPlacement(
  view,
  imageParams,
  viewUp,
  orientation,
  axis,
  frame
) {
  function updateCamera() {
    // get world bounds center
    const { bounds } = imageParams.value;
    const center = [
      (bounds[0] + bounds[1]) / 2,
      (bounds[2] + bounds[3]) / 2,
      (bounds[4] + bounds[5]) / 2,
    ];

    const position = [...center];
    position[axis.value] += orientation.value;

    const dop = [0, 0, 0];
    dop[axis.value] = -orientation.value;

    const vup = [...viewUp.value];

    if (unref(frame) === 'image') {
      const { direction } = imageParams.value;
      vec3.transformMat3(dop, dop, direction);
      vec3.transformMat3(vup, vup, direction);
    }

    const camera = view.value.getCamera();
    camera.setFocalPoint(...center);
    camera.setPosition(...position);
    camera.setDirectionOfProjection(...dop);
    camera.setViewUp(...vup);

    view.value.getRenderer().resetCamera();
    view.value.set({ axis: axis.value }, true); // set the corresponding axis
  }

  watch([imageParams, viewUp, orientation, axis], updateCamera, {
    immediate: true,
  });
}
