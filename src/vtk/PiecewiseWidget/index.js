import macro from '@kitware/vtk.js/macro';
import vtkPiecewiseGaussianWidget from '@kitware/vtk.js/Interaction/Widgets/PiecewiseGaussianWidget';
import { interpolateAt } from '@/src/utils/interpolate';

export const Mode = {
  Gaussians: 1,
  Points: 2,
};

export const ADJUST_POSITION_CURSOR = '-webkit-grab';

/**
 * Samples a piecewise linear function at regular intervals in [0,1]. Beyond the
 * end points it holds the end values, as vtkPiecewiseFunction clamping does.
 *
 * Assumes normalized x/y coordinate points sorted by x.
 */
export function samplePiecewiseLinear(
  points,
  shift = 0,
  shiftAlpha = 0,
  samples = 256
) {
  return Array.from({ length: samples }, (_, i) => {
    const [value] = interpolateAt(points, i / (samples - 1) - shift);
    // Non-zero values should be affected by shift but values of zero should not
    return Math.min(Math.max(value && value - shiftAlpha, 0), 1);
  });
}

// ----------------------------------------------------------------------------
// vtkPiecewiseWidget methods
// ----------------------------------------------------------------------------

function vtkPiecewiseWidget(publicAPI, model) {
  model.classHierarchy.push('vtkPiecewiseWidget');

  const superClass = { ...publicAPI };

  model.pwMode = Mode.Gaussians;
  model.opacityPoints = [];
  model.opacityPointShift = 0;
  model.opacityValueShift = 0;

  publicAPI.setGaussiansMode = () => {
    model.pwMode = Mode.Gaussians;
  };

  publicAPI.setPointsMode = () => {
    // clear gaussians so we don't keep this ref around
    model.gaussians = [];
    model.pwMode = Mode.Points;
  };

  publicAPI.isModeGaussians = () => model.pwMode === Mode.Gaussians;
  publicAPI.isModePoints = () => model.pwMode === Mode.Points;
  publicAPI.getMode = () => model.pwMode;

  publicAPI.shiftPosition = (coords, meta) => {
    if (model.shiftOpacityValues) {
      model.opacityValueShift =
        meta.originalOpacityValueShift + coords[1] - meta.originalXY[1];
    } else {
      model.opacityPointShift =
        meta.originalOpacityPointShift + coords[0] - meta.originalXY[0];
    }
    return true;
  };

  publicAPI.onHover = (x, y) => {
    if (publicAPI.isModeGaussians()) {
      return superClass.onHover(x, y);
    }
    model.canvas.style.cursor = ADJUST_POSITION_CURSOR;
    return true;
  };

  publicAPI.onClick = (x, y) => {
    if (publicAPI.isModeGaussians()) {
      return superClass.onClick(x, y);
    }
    return undefined;
  };

  publicAPI.onDown = (x, y) => {
    if (publicAPI.isModeGaussians()) {
      return superClass.onDown(x, y);
    }

    if (!model.mouseIsDown) {
      publicAPI.invokeAnimation(true);
    }

    const mouseCoords = vtkPiecewiseGaussianWidget.normalizeCoordinates(
      x,
      y,
      model.graphArea
    );

    model.mouseIsDown = true;
    model.activeGaussian = -1;
    model.dragAction = {
      originalXY: mouseCoords,
      originalOpacityPointShift: model.opacityPointShift,
      originalOpacityValueShift: model.opacityValueShift,
    };

    return true;
  };

  publicAPI.onDrag = (x, y) => {
    if (publicAPI.isModeGaussians()) {
      return superClass.onDrag(x, y);
    }

    const normCoords = vtkPiecewiseGaussianWidget.normalizeCoordinates(
      x,
      y,
      model.graphArea
    );
    if (publicAPI.shiftPosition(normCoords, model.dragAction)) {
      model.opacities = samplePiecewiseLinear(
        model.opacityPoints,
        model.opacityPointShift,
        model.opacityValueShift
      );
      publicAPI.invokeOpacityChange(publicAPI, true);
    }

    publicAPI.modified();
    return true;
  };

  publicAPI.setOpacityPoints = (points, shift = 0, shiftAlpha = 0) => {
    if (publicAPI.isModePoints()) {
      // deep copy
      model.opacityPoints = points.map((p) => [p[0], p[1]]);
      model.opacityPointShift = shift;
      model.opacityValueShift = shiftAlpha;

      model.opacities = samplePiecewiseLinear(
        model.opacityPoints,
        model.opacityPointShift,
        model.opacityValueShift
      );
      publicAPI.modified();
    }
  };

  publicAPI.getEffectiveOpacityPoints = () =>
    model.opacityPoints.map((p) => [
      p[0] + model.opacityPointShift,
      p[1] + model.opacityValueShift,
    ]);

  publicAPI.render = () => {
    if (publicAPI.isModePoints()) {
      model.activeGaussian = -1;
      model.selectedGaussian = -1;
    }
    superClass.render();
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  vtkPiecewiseGaussianWidget.extend(publicAPI, model, initialValues);

  macro.setGet(publicAPI, model, [
    'opacityPoints',
    'opacityPointShift',
    'opacityValueShift',
    'shiftOpacityValues',
  ]);

  // Object specific methods
  vtkPiecewiseWidget(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkPiecewiseWidget');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
