import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';

import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';

import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import vtkGeometryRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/GeometryRepresentationProxy';

import vtkLPSView3DProxy from '@/src/vtk/LPSView3DProxy';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import vtkIJKSliceRepresentationProxy from '@/src/vtk/IJKSliceRepresentationProxy';
import vtkLabelMapSliceRepProxy from '@/src/vtk/LabelMapSliceRepProxy';

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
      CoronalSlice: createSyncedSliceRepDefinition(
        vtkIJKSliceRepresentationProxy,
        'X'
      ),
      SagittalSlice: createSyncedSliceRepDefinition(
        vtkIJKSliceRepresentationProxy,
        'Y'
      ),
      AxialSlice: createSyncedSliceRepDefinition(
        vtkIJKSliceRepresentationProxy,
        'Z'
      ),

      Volume: createProxyDefinition(vtkVolumeRepresentationProxy),
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
    },
    Views: {
      View3D: createDefaultView(vtkLPSView3DProxy),
      CoronalView: createDefaultView(vtkLPSView2DProxy, null, { axis: 0 }),
      SagittalView: createDefaultView(vtkLPSView2DProxy, null, { axis: 1 }),
      AxialView: createDefaultView(vtkLPSView2DProxy, null, { axis: 2 }),
    },
  },
  representations: {
    View3D: {
      vtkImageData: { name: 'Volume' },
      vtkPolyData: { name: 'Geometry' },
    },
    CoronalView: {
      vtkImageData: { name: 'CoronalSlice' },
      vtkLabelMap: { name: 'LabelMapSliceX' },
    },
    SagittalView: {
      vtkImageData: { name: 'SagittalSlice' },
      vtkLabelMap: { name: 'LabelMapSliceY' },
    },
    AxialView: {
      vtkImageData: { name: 'AxialSlice' },
      vtkLabelMap: { name: 'LabelMapSliceZ' },
    },
  },
};
