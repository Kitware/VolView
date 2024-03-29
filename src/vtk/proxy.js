import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';

import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';

import vtkGeometryRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/GeometryRepresentationProxy';
import vtkResliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/ResliceRepresentationProxy';
import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import vtkMultiSliceRepresentationProxy from '@/src/vtk/MultiSliceRepresentationProxy';

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
      ImageReslice: createProxyDefinition(vtkResliceRepresentationProxy),
      ImageSlice: createProxyDefinition(vtkIJKSliceRepresentationProxy),
      LabelMapSlice: createProxyDefinition(vtkLabelMapSliceRepProxy),
      Volume: createProxyDefinition(vtkVolumeRepresentationProxy),
      Geometry: createProxyDefinition(vtkGeometryRepresentationProxy),
      ImageMultiSlice: createProxyDefinition(vtkMultiSliceRepresentationProxy),
    },
    Views: {
      View3D: createDefaultView(vtkLPSView3DProxy),
      View2D: createDefaultView(vtkLPSView2DProxy),
      Oblique: createDefaultView(vtkLPSView2DProxy),
      Oblique3D: createDefaultView(vtkLPSView3DProxy),
    },
  },
  representations: {
    View3D: {
      vtkImageData: { name: 'Volume' },
      vtkPolyData: { name: 'Geometry' },
    },
    View2D: {
      vtkImageData: { name: 'ImageSlice' },
      vtkLabelMap: { name: 'LabelMapSlice' },
    },
    Oblique: {
      vtkImageData: { name: 'ImageReslice' },
    },
    Oblique3D: {
      vtkImageData: { name: 'ImageMultiSlice' },
    },
  },
};
