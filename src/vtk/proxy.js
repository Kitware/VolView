import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';

import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';

import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import vtkGeometryRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/GeometryRepresentationProxy';

import vtkLPSView3DProxy from '@/src/vtk/LPSView3DProxy';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import vtkIJKSliceRepresentationProxy from '@/src/vtk/IJKSliceRepresentationProxy';
import vtkLabelMapSliceRepProxy from '@/src/vtk/LabelMapSliceRepProxy';
import vtkCutGeometryRepresentationProxy from '@/src/vtk/CutGeometryRepresentationProxy';

const WindowLevelLinks = [
  { link: 'WW', property: 'windowWidth', updateOnBind: true },
  { link: 'WL', property: 'windowLevel', updateOnBind: true },
];

function createProxyDefinition(
  classFactory,
  ui = [],
  links = [],
  definitionOptions = {},
  props = {}
) {
  return {
    class: classFactory,
    options: { links, ui, ...definitionOptions },
    props,
  };
}

function createDefaultView(classFactory, options = [], props = {}) {
  return createProxyDefinition(classFactory, [], [], options, props);
}

function createSyncedSliceRepDefinition(proxyClass, axis, ui = [], links = []) {
  return createProxyDefinition(proxyClass, ui, [
    {
      link: `Slice${axis}`,
      property: 'slice',
      updateOnBind: false,
      type: 'application',
    },
    ...links,
  ]);
}

// ----------------------------------------------------------------------------

export default {
  definitions: {
    Proxy: {
      LookupTable: createProxyDefinition(vtkLookupTableProxy, [], [], {
        presetName: 'Default (Cool to Warm)',
      }),
      PiecewiseFunction: createProxyDefinition(vtkPiecewiseFunctionProxy),
    },
    Sources: {
      TrivialProducer: createProxyDefinition(vtkSourceProxy),
    },
    Representations: {
      Volume: createProxyDefinition(vtkVolumeRepresentationProxy),
      SliceX: createSyncedSliceRepDefinition(
        vtkIJKSliceRepresentationProxy,
        'X',
        null,
        WindowLevelLinks
      ),
      SliceY: createSyncedSliceRepDefinition(
        vtkIJKSliceRepresentationProxy,
        'Y',
        null,
        WindowLevelLinks
      ),
      SliceZ: createSyncedSliceRepDefinition(
        vtkIJKSliceRepresentationProxy,
        'Z',
        null,
        WindowLevelLinks
      ),
      LabelMapSliceX: createSyncedSliceRepDefinition(
        vtkLabelMapSliceRepProxy,
        'X'
      ),
      LabelMapSliceY: createSyncedSliceRepDefinition(
        vtkLabelMapSliceRepProxy,
        'Y'
      ),
      LabelMapSliceZ: createSyncedSliceRepDefinition(
        vtkLabelMapSliceRepProxy,
        'Z'
      ),
      Geometry: createProxyDefinition(vtkGeometryRepresentationProxy),
      GeomSliceX: createSyncedSliceRepDefinition(
        vtkCutGeometryRepresentationProxy,
        'X'
      ),
      GeomSliceY: createSyncedSliceRepDefinition(
        vtkCutGeometryRepresentationProxy,
        'Y'
      ),
      GeomSliceZ: createSyncedSliceRepDefinition(
        vtkCutGeometryRepresentationProxy,
        'Z'
      ),
    },
    Views: {
      View3D: createDefaultView(vtkLPSView3DProxy),
      ViewX: createDefaultView(vtkLPSView2DProxy, null, { axis: 0 }),
      ViewY: createDefaultView(vtkLPSView2DProxy, null, { axis: 1 }),
      ViewZ: createDefaultView(vtkLPSView2DProxy, null, { axis: 2 }),
    },
  },
  representations: {
    View3D: {
      vtkImageData: { name: 'Volume' },
      vtkPolyData: { name: 'Geometry' },
    },
    ViewX: {
      vtkImageData: { name: 'SliceX' },
      vtkPolyData: { name: 'GeomSliceX' },
      vtkLabelMap: { name: 'LabelMapSliceX' },
    },
    ViewY: {
      vtkImageData: { name: 'SliceY' },
      vtkPolyData: { name: 'GeomSliceY' },
      vtkLabelMap: { name: 'LabelMapSliceY' },
    },
    ViewZ: {
      vtkImageData: { name: 'SliceZ' },
      vtkPolyData: { name: 'GeomSliceZ' },
      vtkLabelMap: { name: 'LabelMapSliceZ' },
    },
  },
};
