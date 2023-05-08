import JSZip from 'jszip';
import { z } from 'zod';
import { Vector3 } from '@kitware/vtk.js/types';
import vtkPiecewiseFunctionProxy, {
  PiecewiseGaussian,
  PiecewiseNode,
} from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';

import { Tools as ToolsEnum } from '@/src/store/tools/types';
import { Ruler } from '@/src/types/ruler';
import { Rectangle } from '@/src/types/rectangle';
import { LPSCroppingPlanes } from '@/src/types/crop';
import { FrameOfReference } from '@/src/utils/frameOfReference';

import {
  CameraConfig,
  SliceConfig,
  WindowLevelConfig,
  LayersConfig,
  VolumeColorConfig,
} from '../../store/view-configs/types';
import { LPSAxisDir, LPSAxis } from '../../types/lps';
import { LayoutDirection } from '../../types/layout';
import {
  ViewType,
  ColorBy,
  ColorTransferFunction,
  OpacityFunction,
  OpacityGaussians,
  OpacityPoints,
  OpacityNodes,
  ColoringConfig,
  CVRConfig,
  BlendConfig,
} from '../../types/views';

export enum DatasetType {
  DICOM = 'dicom',
  IMAGE = 'image',
}

const DatasetTypeNative = z.nativeEnum(DatasetType);

const LPSAxisDir: z.ZodType<LPSAxisDir> = z.union([
  z.literal('Left'),
  z.literal('Right'),
  z.literal('Posterior'),
  z.literal('Anterior'),
  z.literal('Superior'),
  z.literal('Inferior'),
]);

const Dataset = z.object({
  id: z.string(),
  path: z.string(),
  type: DatasetTypeNative,
});
export type Dataset = z.infer<typeof Dataset>;

const baseRemoteFileSchema = z.object({
  archiveSrc: z.object({ path: z.string() }).optional(),
  uriSrc: z.object({ uri: z.string(), name: z.string() }).optional(),
});

type RemoteFileType = z.infer<typeof baseRemoteFileSchema> & {
  parent?: RemoteFileType;
};

// This is a serialized DataSource that has a UriSource ancestor.
const RemoteFile: z.ZodType<RemoteFileType> = baseRemoteFileSchema.extend({
  parent: z.lazy(() => RemoteFile.optional()),
  // archivePath: z.string().optional(),
  // url: z.string(),
  // remoteFilename: z.string(),
  // name: z.string(),
});
export type RemoteFile = z.infer<typeof RemoteFile>;

const LayoutDirectionNative = z.nativeEnum(LayoutDirection);

export interface Layout {
  name?: string;
  direction: LayoutDirection;
  items: Array<Layout | string>;
}

const Layout: z.ZodType<Layout> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    direction: LayoutDirectionNative,
    items: z.array(z.union([Layout, z.string()])),
  })
);

const Vector3: z.ZodType<Vector3> = z.tuple([
  z.number(),
  z.number(),
  z.number(),
]);

const WindowLevelConfig: z.ZodType<WindowLevelConfig> = z.object({
  width: z.number(),
  level: z.number(),
  min: z.number(),
  max: z.number(),
});

const SliceConfig: z.ZodType<SliceConfig> = z.object({
  slice: z.number(),
  min: z.number(),
  max: z.number(),
  axisDirection: LPSAxisDir,
});

const CameraConfig: z.ZodType<CameraConfig> = z.object({
  parallelScale: z.number().optional(),
  position: Vector3.optional(),
  focalPoint: Vector3.optional(),
  directionOfProjection: Vector3.optional(),
  viewUp: Vector3.optional(),
});

const ColorBy: z.ZodType<ColorBy> = z.object({
  arrayName: z.string(),
  location: z.string(),
});

const PiecewiseGaussian: z.ZodType<PiecewiseGaussian> = z.object({
  position: z.number(),
  height: z.number(),
  width: z.number(),
  xBias: z.number(),
  yBias: z.number(),
});

const PiecewiseNode: z.ZodType<PiecewiseNode> = z.object({
  x: z.number(),
  y: z.number(),
  midpoint: z.number(),
  sharpness: z.number(),
});

const OpacityGaussians: z.ZodType<OpacityGaussians> = z.object({
  mode: z.literal(vtkPiecewiseFunctionProxy.Mode.Gaussians),
  gaussians: PiecewiseGaussian.array(),
  mappingRange: z.tuple([z.number(), z.number()]),
});

const OpacityPoints: z.ZodType<OpacityPoints> = z.object({
  mode: z.literal(vtkPiecewiseFunctionProxy.Mode.Points),
  preset: z.string(),
  shift: z.number(),
  mappingRange: z.tuple([z.number(), z.number()]),
});

const OpacityNodes: z.ZodType<OpacityNodes> = z.object({
  mode: z.literal(vtkPiecewiseFunctionProxy.Mode.Nodes),
  nodes: PiecewiseNode.array(),
  mappingRange: z.tuple([z.number(), z.number()]),
});

const OpacityFunction = z.union([
  OpacityGaussians,
  OpacityPoints,
  OpacityNodes,
]);

const ColorTransferFunction: z.ZodType<ColorTransferFunction> = z.object({
  preset: z.string(),
  mappingRange: z.tuple([z.number(), z.number()]),
});

const ColoringConfig: z.ZodType<ColoringConfig> = z.object({
  colorBy: ColorBy,
  transferFunction: ColorTransferFunction,
  opacityFunction: OpacityFunction,
});

const CVRConfig: z.ZodType<CVRConfig> = z.object({
  enabled: z.boolean(),
  lightFollowsCamera: z.boolean(),
  volumeQuality: z.number(),
  useVolumetricScatteringBlending: z.boolean(),
  volumetricScatteringBlending: z.number(),
  useLocalAmbientOcclusion: z.boolean(),
  laoKernelSize: z.number(),
  laoKernelRadius: z.number(),
  ambient: z.number(),
  diffuse: z.number(),
  specular: z.number(),
});

const VolumeColorConfig: z.ZodType<VolumeColorConfig> = z.object({
  colorBy: ColorBy,
  transferFunction: ColorTransferFunction,
  opacityFunction: OpacityFunction,
  cvr: CVRConfig,
});

const BlendConfig: z.ZodType<BlendConfig> = z.object({
  opacity: z.number(),
});

const LayersConfig: z.ZodType<LayersConfig> = z.object({
  colorBy: ColorBy,
  transferFunction: ColorTransferFunction,
  opacityFunction: OpacityFunction,
  blendConfig: BlendConfig,
});

const ViewConfig = z.object({
  window: WindowLevelConfig.optional(),
  slice: SliceConfig.optional(),
  layers: LayersConfig.optional(),
  camera: CameraConfig.optional(),
  volumeColorConfig: VolumeColorConfig.optional(),
});

const ViewType: z.ZodType<ViewType> = z.union([
  z.literal('2D'),
  z.literal('3D'),
]);

export type ViewConfig = z.infer<typeof ViewConfig>;

const View = z.object({
  id: z.string(),
  type: ViewType,
  props: z.record(z.any()),
  config: z.record(ViewConfig),
});

export type View = z.infer<typeof View>;

export const LabelMap = z.object({
  id: z.string(),
  parent: z.string(),
  path: z.string(),
});

export type LabelMap = z.infer<typeof LabelMap>;

const LPSAxis: z.ZodType<LPSAxis> = z.union([
  z.literal('Axial'),
  z.literal('Sagittal'),
  z.literal('Coronal'),
]);

const FrameOfReference: z.ZodType<FrameOfReference> = z.object({
  planeOrigin: Vector3,
  planeNormal: Vector3,
});

const Ruler: z.ZodType<Ruler> = z.object({
  firstPoint: Vector3,
  secondPoint: Vector3,
  imageID: z.string(),
  frameOfReference: FrameOfReference,
  slice: z.number(),
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

const Rectangle: z.ZodType<Rectangle> = z.object({
  firstPoint: Vector3,
  secondPoint: Vector3,
  imageID: z.string(),
  frameOfReference: FrameOfReference,
  slice: z.number(),
  id: z.string() as unknown as z.ZodType<Rectangle['id']>,
  name: z.string(),
  color: z.string(),
});

const Crosshairs = z.object({
  position: Vector3,
});

export type Crosshairs = z.infer<typeof Crosshairs>;

const ToolsEnumNative = z.nativeEnum(ToolsEnum);

const Paint = z.object({
  activeLabelmapID: z.string().nullable(),
  brushSize: z.number(),
  brushValue: z.number(),
  labelmapOpacity: z.number(),
});

const LPSCroppingPlanes: z.ZodType<LPSCroppingPlanes> = z.object({
  Sagittal: z.tuple([z.number(), z.number()]),
  Coronal: z.tuple([z.number(), z.number()]),
  Axial: z.tuple([z.number(), z.number()]),
});

const Cropping = z.record(LPSCroppingPlanes);

const Tools = z.object({
  rulers: Ruler.array(),
  rectangles: Rectangle.array().optional(),
  crosshairs: Crosshairs,
  paint: Paint,
  crop: Cropping,
  current: ToolsEnumNative,
});

export type Tools = z.infer<typeof Tools>;

export const ParentToLayers = z
  .object({
    selectionKey: z.string(),
    sourceSelectionKeys: z.string().array(),
  })
  .array();

export type ParentToLayers = z.infer<typeof ParentToLayers>;

export const ManifestSchema = z.object({
  version: z.string(),
  datasets: Dataset.array(),
  remoteFiles: z.record(RemoteFile.array()),
  labelMaps: LabelMap.array(),
  tools: Tools,
  views: View.array(),
  primarySelection: z.string().optional(),
  layout: Layout,
  parentToLayers: ParentToLayers,
});

export type Manifest = z.infer<typeof ManifestSchema>;

export interface StateFile {
  zip: JSZip;
  manifest: Manifest;
}
