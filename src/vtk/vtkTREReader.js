import macro from 'vtk.js/Sources/macro';
import vtkPolyData from 'vtk.js/Sources/Common/DataModel/PolyData';
import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray';
import vtkAppendPolyData from 'vtk.js/Sources/Filters/General/AppendPolyData';
import vtkPoints from 'vtk.js/Sources/Common/Core/Points';
import vtkTubeFilter from 'vtk.js/Sources/Filters/General/TubeFilter';
import { VaryRadius } from 'vtk.js/Sources/Filters/General/TubeFilter/Constants';
import { VtkDataTypes } from 'vtk.js/Sources/Common/Core/DataArray/Constants';

const numRegex = /^[0-9]+?(\.[0-9]+?)?$/;
const vecRegex = /^([0-9]+?(\.[0-9]+?)?(\s+|$)){2,}$/;
const boolRegex = /^(true|false)$/i;

function zipObj(keys, values) {
  const obj = {};
  const length = Math.min(keys.length, values.length);
  for (let i = 0; i < length; i += 1) {
    obj[keys[i]] = values[i];
  }
  return obj;
}

function centerlineToTube(centerline) {
  const pd = vtkPolyData.newInstance();
  const pts = vtkPoints.newInstance({
    dataType: VtkDataTypes.FLOAT,
    numberOfComponents: 3,
  });
  pts.setNumberOfPoints(centerline.length);

  const pointData = new Float32Array(3 * centerline.length);
  const lines = new Uint32Array(centerline.length + 1);

  lines[0] = centerline.length;
  for (let i = 0; i < centerline.length; i += 1) {
    pointData[3 * i + 0] = centerline[i].x;
    pointData[3 * i + 1] = centerline[i].y;
    pointData[3 * i + 2] = centerline[i].z;
    lines[i + 1] = i;
  }

  const radii = centerline.map((pt) => pt.r);
  const radiusData = new Float32Array(radii);
  const radius = vtkDataArray.newInstance({
    name: 'Radius',
    values: radiusData,
  });

  pts.setData(pointData);
  pd.setPoints(pts);
  pd.getLines().setData(lines);
  pd.getPointData().addArray(radius);

  const filter = vtkTubeFilter.newInstance({
    capping: true,
    radius: 1, // scaling factor
    varyRadius: VaryRadius.VARY_RADIUS_BY_ABSOLUTE_SCALAR,
    numberOfSides: 20,
  });

  filter.setInputArrayToProcess(0, 'Radius', 'PointData', 'Scalars');
  filter.setInputData(pd);

  return filter.getOutputData();
}

function convertToPolyData(tre) {
  // first separate out centerlines by ID
  const centerlines = {};
  for (let i = 0; i < tre.Points.length; i += 1) {
    const { id } = tre.Points[i];

    centerlines[id] = centerlines[id] ?? [];
    const cline = centerlines[id];
    cline.push(tre.Points[i]);
  }

  const appendPolyData = vtkAppendPolyData.newInstance();
  appendPolyData.setInputData(vtkPolyData.newInstance());

  let numberOfCells = 0;

  // convert each centerline to polydata,
  // and prepare to concatenate them
  const ids = Object.keys(centerlines);
  const cellCounts = Array(ids.length);
  for (let i = 0; i < ids.length; i += 1) {
    const cline = centerlines[ids[i]];
    const tubePd = centerlineToTube(cline);
    appendPolyData.addInputData(tubePd);

    cellCounts[i] = tubePd.getNumberOfCells();
    numberOfCells += cellCounts[i];
  }

  const polyData = appendPolyData.getOutputData();

  // add colors
  // I forget why I needed to do this separately from AppendPolyData
  const colorData = new Uint8Array(4 * numberOfCells);
  for (let i = 0, colorIdx = 0; i < ids.length; i += 1, colorIdx += 4) {
    const cline = centerlines[ids[i]];
    const cellCount = cellCounts[i]; // # of cells for tube ids[i]
    for (let j = 0; j < cellCount; j += 1) {
      colorData[colorIdx + 0] = cline.red * 255;
      colorData[colorIdx + 1] = cline.green * 255;
      colorData[colorIdx + 2] = cline.blue * 255;
      colorData[colorIdx + 3] = 255;
    }
  }

  const colors = vtkDataArray.newInstance({
    name: 'Colors',
    values: colorData,
    numberOfComponents: 4,
  });
  polyData.getCellData().addArray(colors);

  return polyData;
}

function vtkTREReader(publicAPI, model) {
  model.classHierarchy.push('vtkTREReader');

  model.treObject = {};

  publicAPI.parseAsText = (content) => {
    const treObj = {};

    const lines = content.trim().split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (treObj.PointDim && treObj.Points) {
        const pointData = lines[i].trim().split(/\s+/).map((v) => Number(v));
        treObj.Points.push(zipObj(treObj.PointDim, pointData));
      } else {
        let [key, value] = lines[i].split('=');
        key = key.trim();
        value = value.trim();

        if (boolRegex.test(value)) {
          treObj[key] = value.toLowerCase() === 'true';
        } else if (vecRegex.test(value)) {
          treObj[key] = value.split(/\s+/).map((v) => Number(v));
        } else if (numRegex.test(value)) {
          treObj[key] = Number(value);
        } else { // string
          treObj[key] = value;
        }

        if (key === 'PointDim') {
          treObj[key] = treObj[key].split(/\s+/);
        }

        if (key === 'Points') {
          treObj[key] = [];
        }
      }
    }

    model.treObject = treObj;

    model.output[0] = convertToPolyData(treObj);
  };

  publicAPI.requestData = () => {};
}


const DEFAULT_VALUES = {};

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  macro.obj(publicAPI, model);
  macro.algo(publicAPI, model, 1, 1);

  vtkTREReader(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, 'vtkTREReader');

export default { newInstance, extend };
