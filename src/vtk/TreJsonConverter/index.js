import vtkPolyData from 'vtk.js/Sources/Common/DataModel/PolyData';
import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray';
import vtkAppendPolyData from 'vtk.js/Sources/Filters/General/AppendPolyData';
import vtkPoints from 'vtk.js/Sources/Common/Core/Points';
import vtkTubeFilter from 'vtk.js/Sources/Filters/General/TubeFilter';
import { VaryRadius } from 'vtk.js/Sources/Filters/General/TubeFilter/Constants';
import { VtkDataTypes } from 'vtk.js/Sources/Common/Core/DataArray/Constants';

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
    const [x, y, z] = centerline[i].PositionInWorldSpace;
    pointData[3 * i + 0] = x;
    pointData[3 * i + 1] = y;
    pointData[3 * i + 2] = z;
    lines[i + 1] = i;
  }

  const radii = centerline.map((pt) => pt.RadiusInWorldSpace);
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

function convertCenterlinesToTubes(centerlines) {
  const appendPolyData = vtkAppendPolyData.newInstance();
  appendPolyData.setInputData(vtkPolyData.newInstance());

  let numberOfCells = 0;

  // convert each centerline to polydata,
  // and prepare to concatenate them
  const cellCounts = Array(centerlines.length);
  for (let i = 0; i < centerlines.length; i += 1) {
    const cline = centerlines[i];
    const tubePd = centerlineToTube(cline);
    appendPolyData.addInputData(tubePd);

    cellCounts[i] = tubePd.getNumberOfCells();
    numberOfCells += cellCounts[i];
  }

  const polyData = appendPolyData.getOutputData();

  // add colors
  const colorData = new Uint8Array(4 * numberOfCells);
  for (let i = 0, colorIdx = 0; i < centerlines.length; i += 1, colorIdx += 4) {
    const cline = centerlines[i];
    const cellCount = cellCounts[i]; // # of cells for ith tube
    for (let j = 0; j < cellCount; j += 1) {
      colorData[colorIdx + 0] = cline.Red * 255;
      colorData[colorIdx + 1] = cline.Green * 255;
      colorData[colorIdx + 2] = cline.Blue * 255;
      colorData[colorIdx + 3] = 255; // ignore specified alpha for now
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

function flattenTreHierarchy(treJson) {
  const list = [];
  if (treJson.Points) {
    list.push(treJson.Points);
  }

  const children = treJson.Children ?? [];
  for (let i = 0; i < children.length; i += 1) {
    list.push(...flattenTreHierarchy(children[i]));
  }

  return list;
}

export default function convertJsonToTre(treJson) {
  const centerlines = flattenTreHierarchy(treJson);
  return convertCenterlinesToTubes(centerlines);
}
