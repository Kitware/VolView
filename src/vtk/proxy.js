import vtk2DView from 'vtk.js/Sources/Proxy/Core/View2DProxy';
import vtk3DView from 'vtk.js/Sources/Proxy/Core/ViewProxy';

import vtkLookupTableProxy from 'vtk.js/Sources/Proxy/Core/LookupTableProxy';
import vtkPiecewiseFunctionProxy from 'vtk.js/Sources/Proxy/Core/PiecewiseFunctionProxy';

import vtkSourceProxy from 'vtk.js/Sources/Proxy/Core/SourceProxy';

import vtkSliceRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/SliceRepresentationProxy';
import vtkVolumeRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/VolumeRepresentationProxy';
import vtkGeometryRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/GeometryRepresentationProxy';

import vtkImageTransformFilter from '@/src/vtk/ImageTransformFilter/index';
import vtkPolyDataTransformFilter from '@/src/vtk/PolyDataTransformFilter/index';

function createProxyDefinition(
  classFactory,
  ui = [],
  links = [],
  definitionOptions = {},
  props = {},
) {
  return {
    class: classFactory,
    options: { links, ui, ...definitionOptions },
    props,
  };
}

function createDefaultView(classFactory, options, props) {
  return createProxyDefinition(classFactory, [], [], options, props);
}

function createProxyFilterDefinition(algoFactory, options, ui, links, props) {
  const defOptions = {
    algoFactory,
    autoUpdate: true,
    ...(options || {}),
  };
  return createProxyDefinition(vtkSourceProxy, ui, links, defOptions, props);
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
      PolyDataTransform: createProxyFilterDefinition(vtkPolyDataTransformFilter, {
        proxyPropertyMapping: {
          transform: { modelKey: 'algo', property: 'transform' },
        },
      }),
      ImageTransform: createProxyFilterDefinition(vtkImageTransformFilter, {
        proxyPropertyMapping: {
          transform: { modelKey: 'algo', property: 'transform' },
        },
      }),
    },
    Representations: {
      Volume: createProxyDefinition(
        vtkVolumeRepresentationProxy,
        [],
        [
          { link: 'WW', property: 'windowWidth', updateOnBind: true },
          { link: 'WL', property: 'windowLevel', updateOnBind: true },
          {
            link: 'SliceX',
            property: 'xSlice',
            updateOnBind: true,
            type: 'application',
          },
          {
            link: 'SliceY',
            property: 'ySlice',
            updateOnBind: true,
            type: 'application',
          },
          {
            link: 'SliceZ',
            property: 'zSlice',
            updateOnBind: true,
            type: 'application',
          },
        ],
      ),
      SliceX: createProxyDefinition(
        vtkSliceRepresentationProxy,
        [/* ui */],
        [
          { link: 'WW', property: 'windowWidth', updateOnBind: true },
          { link: 'WL', property: 'windowLevel', updateOnBind: true },
          {
            link: 'SliceX',
            property: 'slice',
            updateOnBind: true,
            type: 'application',
          },
        ],
      ),
      SliceY: createProxyDefinition(
        vtkSliceRepresentationProxy,
        [/* ui */],
        [
          { link: 'WW', property: 'windowWidth', updateOnBind: true },
          { link: 'WL', property: 'windowLevel', updateOnBind: true },
          {
            link: 'SliceY',
            property: 'slice',
            updateOnBind: true,
            type: 'application',
          },
        ],
      ),
      SliceZ: createProxyDefinition(
        vtkSliceRepresentationProxy,
        [/* ui */],
        [
          { link: 'WW', property: 'windowWidth', updateOnBind: true },
          { link: 'WL', property: 'windowLevel', updateOnBind: true },
          {
            link: 'SliceZ',
            property: 'slice',
            updateOnBind: true,
            type: 'application',
          },
        ],
      ),
      Geometry: createProxyDefinition(vtkGeometryRepresentationProxy),
      GeomSliceX: createProxyDefinition(vtkGeometryRepresentationProxy),
      GeomSliceY: createProxyDefinition(vtkGeometryRepresentationProxy),
      GeomSliceZ: createProxyDefinition(vtkGeometryRepresentationProxy),
    },
    Views: {
      View3D: createDefaultView(vtk3DView),
      ViewX: createDefaultView(vtk2DView, [/* ui */], { axis: 0 }),
      ViewY: createDefaultView(vtk2DView, [/* ui */], { axis: 1 }),
      ViewZ: createDefaultView(vtk2DView, [/* ui */], { axis: 2 }),
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
    },
    ViewY: {
      vtkImageData: { name: 'SliceY' },
      vtkPolyData: { name: 'GeomSliceY' },
    },
    ViewZ: {
      vtkImageData: { name: 'SliceZ' },
      vtkPolyData: { name: 'GeomSliceZ' },
    },
  },
};
