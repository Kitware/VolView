import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkActor2D from '@kitware/vtk.js/Rendering/Core/Actor2D';
import vtkContextRepresentation from '@kitware/vtk.js/Widgets/Representations/ContextRepresentation';
import vtkWidgetRepresentation from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation';
import macro from '@kitware/vtk.js/macros';
import vtkMapper2D from '@kitware/vtk.js/Rendering/Core/Mapper2D';
import vtkCoordinate from '@kitware/vtk.js/Rendering/Core/Coordinate';
import { Coordinate } from '@kitware/vtk.js/Rendering/Core/Coordinate/Constants';
import { Representation } from '@kitware/vtk.js/Rendering/Core/Property/Constants';
import { DisplayLocation } from '@kitware/vtk.js/Rendering/Core/Property2D/Constants';
import { vec3 } from 'gl-matrix';
import { rescaleStamp } from '@/src/core/tools/paint';

function generateContour({
  stamp: initialStamp,
  location,
  slicingIndex,
  indexToWorld,
  imageSpacing,
}) {
  const sliceSpacing = [...imageSpacing];
  sliceSpacing.splice(slicingIndex, 1);
  const stamp = rescaleStamp(initialStamp, sliceSpacing, true);
  const [xdim, ydim] = stamp.size;
  const xoffset = Math.floor((xdim - 1) / 2);
  const yoffset = Math.floor((ydim - 1) / 2);

  // grid of corner points (top-left to bottom-right)
  const gridxdim = xdim + 1;
  const gridydim = ydim + 1;

  const vertices = []; // arr of 3-tuples
  const lines = []; // arr of 2-tuples of vertex indices

  // maps grid x/y to vertex index
  const vertexMap = {};
  const getOrCreateVertexIndex = (x, y) => {
    const key = `${x},${y}`;
    if (key in vertexMap) {
      return vertexMap[key];
    }

    const indexCoords = [...location].map((val) => Math.round(val));
    if (slicingIndex === 0) {
      indexCoords[1] += x - xoffset - 0.5;
      indexCoords[2] += y - yoffset - 0.5;
    } else if (slicingIndex === 1) {
      indexCoords[0] += x - xoffset - 0.5;
      indexCoords[2] += y - yoffset - 0.5;
    } else if (slicingIndex === 2) {
      indexCoords[0] += x - xoffset - 0.5;
      indexCoords[1] += y - yoffset - 0.5;
    }

    // get the grid point x/y's actual vertex in world space
    // since grid x/y represents the top-left of the actual pixel
    // at x/y, the true continuous index value of the vertex
    // is x-0.5/y-0.5.

    const worldCoords = [];
    vec3.transformMat4(worldCoords, indexCoords, indexToWorld);
    vertices.push(worldCoords);

    const index = vertices.length - 1;
    vertexMap[key] = index;
    return index;
  };

  const getStampPixelAt = (x, y) => {
    if (x < 0 || x >= xdim) return 0;
    if (y < 0 || y >= ydim) return 0;
    return stamp.pixels[y * xdim + x] || 0;
  };

  for (let gy = 0; gy < gridydim; gy++) {
    for (let gx = 0; gx < gridxdim; gx++) {
      // evaluate point to see if it needs inclusion
      // by looking at all 4 pixels that share this point
      // as a corner.
      // if all empty or all filled, the current point is
      // not used in the contour.
      const count =
        getStampPixelAt(gx, gy) +
        getStampPixelAt(gx - 1, gy) +
        getStampPixelAt(gx, gy - 1) +
        getStampPixelAt(gx - 1, gy - 1);

      if (count > 0 && count < 4) {
        const v0 = getOrCreateVertexIndex(gx, gy);

        // now do line check. We look at the east and south lines.
        // east first
        if (getStampPixelAt(gx, gy) !== getStampPixelAt(gx, gy - 1)) {
          const v1 = getOrCreateVertexIndex(gx + 1, gy);
          lines.push([v0, v1]);
        }
        // south next
        if (getStampPixelAt(gx, gy) !== getStampPixelAt(gx - 1, gy)) {
          const v1 = getOrCreateVertexIndex(gx, gy + 1);
          lines.push([v0, v1]);
        }
      }
    }
  }

  return {
    points: new Float32Array(vertices.flat()),
    lines: new Uint16Array(lines.map(([v0, v1]) => [2, v0, v1]).flat()),
  };
}

function vtkPaintBrushContextRepresentation(publicAPI, model) {
  model.classHierarchy.push('vtkPaintBrushContextRepresentation');

  model.internalPolyData = vtkPolyData.newInstance({ mtime: 0 });
  model.internalArrays = {
    points: model.internalPolyData.getPoints(),
    lines: model.internalPolyData.getLines(),
  };

  model.pipelines = {
    brush: {
      source: publicAPI,
      mapper: vtkMapper2D.newInstance({
        transformCoordinate: vtkCoordinate.newInstance({
          coordinateSystem: Coordinate.WORLD,
        }),
      }),
      actor: vtkActor2D.newInstance({ pickable: false, parentProp: publicAPI }),
    },
  };

  const actorProperty = model.pipelines.brush.actor.getProperty();
  actorProperty.setLineWidth(2);
  actorProperty.setColor([1, 0, 0]);
  actorProperty.setDisplayLocation(DisplayLocation.FOREGROUND);
  actorProperty.setRepresentation(Representation.SURFACE);

  vtkWidgetRepresentation.connectPipeline(model.pipelines.brush);

  publicAPI.addActor(model.pipelines.brush.actor);

  publicAPI.requestData = (inData, outData) => {
    const widgetState = inData[0];

    const stamp = widgetState.getStamp();
    const brush = widgetState.getBrush();
    const { indexToWorld, worldToIndex } = model;

    if (stamp && brush.getOrigin()) {
      const location = [];
      vec3.transformMat4(location, brush.getOrigin(), worldToIndex);

      const contour = generateContour({
        stamp,
        location,
        slicingIndex: model.slicingIndex,
        indexToWorld,
        imageSpacing: model.imageSpacing,
      });

      const { points, lines } = model.internalArrays;
      points.setData(contour.points);
      lines.setData(contour.lines);

      model.internalPolyData.modified();
    }
    outData[0] = model.internalPolyData;
  };
}

const DEFAULT_VALUES = {
  defaultScale: 1,
  drawBorder: false,
  drawFace: true,
  worldToIndex: null,
  indexToWorld: null,
  slicingIndex: 0,
  imageSpacing: [1, 1, 1],
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);
  vtkContextRepresentation.extend(publicAPI, model, initialValues);
  macro.setGet(publicAPI, model, [
    'slicingIndex',
    'indexToWorld',
    'worldToIndex',
    'imageSpacing',
  ]);
  macro.get(publicAPI, model, ['mapper', 'actor']);
  vtkPaintBrushContextRepresentation(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkPaintBrushContextRepresentation'
);

export default { newInstance, extend };
