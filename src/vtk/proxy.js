import vtk2DView from 'vtk.js/Sources/Proxy/Core/View2DProxy';
import vtk3DView from 'vtk.js/Sources/Proxy/Core/ViewProxy';

import vtkLookupTableProxy from 'vtk.js/Sources/Proxy/Core/LookupTableProxy';
import vtkPiecewiseFunctionProxy from 'vtk.js/Sources/Proxy/Core/PiecewiseFunctionProxy';

import vtkSourceProxy from 'vtk.js/Sources/Proxy/Core/SourceProxy';

import vtkSliceRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/SliceRepresentationProxy';
import vtkVolumeRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/VolumeRepresentationProxy';
import vtkGeometryRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/GeometryRepresentationProxy';

import vtkLabelMapSliceRepProxy from '@/src/vtk/LabelMapSliceRepProxy';
import vtkCutGeometryRepresentationProxy from '@/src/vtk/CutGeometryRepresentationProxy';
import vtkImageTransformFilter from '@/src/vtk/ImageTransformFilter';
import vtkPolyDataTransformFilter from '@/src/vtk/PolyDataTransformFilter';
import vtkLabelMapTransformFilter from '@/src/vtk/LabelMapTransformFilter';

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
      LabelMapTransform: createProxyFilterDefinition(vtkLabelMapTransformFilter, {
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
      LabelMapSliceX: createProxyDefinition(
        vtkLabelMapSliceRepProxy,
        [/* ui */],
        [/* links */],
      ),
      LabelMapSliceY: createProxyDefinition(
        vtkLabelMapSliceRepProxy,
        [/* ui */],
        [/* links */],
      ),
      LabelMapSliceZ: createProxyDefinition(
        vtkLabelMapSliceRepProxy,
        [/* ui */],
        [/* links */],
      ),
      Geometry: createProxyDefinition(vtkGeometryRepresentationProxy),
      GeomSliceX: createProxyDefinition(
        vtkCutGeometryRepresentationProxy,
        [/* ui */],
        [
          {
            link: 'SliceX',
            property: 'slice',
            updateOnBind: true,
            type: 'application',
          },
        ],
      ),
      GeomSliceY: createProxyDefinition(
        vtkCutGeometryRepresentationProxy,
        [/* ui */],
        [
          {
            link: 'SliceY',
            property: 'slice',
            updateOnBind: true,
            type: 'application',
          },
        ],
      ),
      GeomSliceZ: createProxyDefinition(
        vtkCutGeometryRepresentationProxy,
        [/* ui */],
        [
          {
            link: 'SliceZ',
            property: 'slice',
            updateOnBind: true,
            type: 'application',
          },
        ],
      ),
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
