import JSZip from 'jszip';
import { z } from 'zod';
import type { Vector3 } from '@kitware/vtk.js/types';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import type {
  PiecewiseGaussian,
  PiecewiseNode,
} from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';

import type { AnnotationTool, ToolID } from '@/src/types/annotation-tool';
import { Tools as ToolsEnum } from '@/src/store/tools/types';
import type { Ruler } from '@/src/types/ruler';
import type { Rectangle } from '@/src/types/rectangle';
import type { Polygon } from '@/src/types/polygon';
import type { LPSCroppingPlanes } from '@/src/types/crop';
import type { FrameOfReference } from '@/src/utils/frameOfReference';
import type { Optional } from '@/src/types';

import type {
  CameraConfig,
  SliceConfig,
  WindowLevelConfig,
  LayersConfig,
  VolumeColorConfig,
} from '../../store/view-configs/types';
import type { LPSAxisDir, LPSAxis } from '../../types/lps';
import { LayoutDirection } from '../../types/layout';
import type {
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
import { WLAutoRanges } from '../../constants';

export enum DatasetType {
  DICOM = 'dicom',
  IMAGE = 'image',
}

const DatasetTypeNative = z.nativeEnum(DatasetType);

const LPSAxisDir = z.union([
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

const Vector3 = z.tuple([
  z.number(),
  z.number(),
  z.number(),
]) satisfies z.ZodType<Vector3>;

type AutoRangeKeys = keyof typeof WLAutoRanges;
const WindowLevelConfig = z.object({
  width: z.number(),
  level: z.number(),
  min: z.number(),
  max: z.number(),
  auto: z.string() as z.ZodType<AutoRangeKeys>,
  preset: z.object({ width: z.number(), level: z.number() }),
}) satisfies z.ZodType<WindowLevelConfig>;

const SliceConfig = z.object({
  slice: z.number(),
  min: z.number(),
  max: z.number(),
  axisDirection: LPSAxisDir,
}) satisfies z.ZodType<SliceConfig>;

const CameraConfig = z.object({
  parallelScale: z.number().optional(),
  position: Vector3.optional(),
  focalPoint: Vector3.optional(),
  directionOfProjection: Vector3.optional(),
  viewUp: Vector3.optional(),
}) satisfies z.ZodType<CameraConfig>;

const ColorBy = z.object({
  arrayName: z.string(),
  location: z.string(),
}) satisfies z.ZodType<ColorBy>;

const PiecewiseGaussian = z.object({
  position: z.number(),
  height: z.number(),
  width: z.number(),
  xBias: z.number(),
  yBias: z.number(),
}) satisfies z.ZodType<PiecewiseGaussian>;

const PiecewiseNode = z.object({
  x: z.number(),
  y: z.number(),
  midpoint: z.number(),
  sharpness: z.number(),
}) as z.ZodType<PiecewiseNode>;

const OpacityGaussians = z.object({
  mode: z.literal(vtkPiecewiseFunctionProxy.Mode.Gaussians),
  gaussians: PiecewiseGaussian.array(),
  mappingRange: z.tuple([z.number(), z.number()]),
}) satisfies z.ZodType<OpacityGaussians>;

const OpacityPoints = z.object({
  mode: z.literal(vtkPiecewiseFunctionProxy.Mode.Points),
  preset: z.string(),
  shift: z.number(),
  shiftAlpha: z.number(),
  mappingRange: z.tuple([z.number(), z.number()]),
}) satisfies z.ZodType<OpacityPoints>;

const OpacityNodes = z.object({
  mode: z.literal(vtkPiecewiseFunctionProxy.Mode.Nodes),
  nodes: PiecewiseNode.array(),
  mappingRange: z.tuple([z.number(), z.number()]),
}) satisfies z.ZodType<OpacityNodes>;

const OpacityFunction = z.union([
  OpacityGaussians,
  OpacityPoints,
  OpacityNodes,
]);

const ColorTransferFunction = z.object({
  preset: z.string(),
  mappingRange: z.tuple([z.number(), z.number()]),
}) satisfies z.ZodType<ColorTransferFunction>;

const ColoringConfig = z.object({
  colorBy: ColorBy,
  transferFunction: ColorTransferFunction,
  opacityFunction: OpacityFunction,
}) satisfies z.ZodType<ColoringConfig>;

const CVRConfig = z.object({
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
}) satisfies z.ZodType<CVRConfig>;

const VolumeColorConfig = z.object({
  colorBy: ColorBy,
  transferFunction: ColorTransferFunction,
  opacityFunction: OpacityFunction,
  cvr: CVRConfig,
}) satisfies z.ZodType<VolumeColorConfig>;

const BlendConfig = z.object({
  opacity: z.number(),
}) satisfies z.ZodType<BlendConfig>;

const LayersConfig = z.object({
  colorBy: ColorBy,
  transferFunction: ColorTransferFunction,
  opacityFunction: OpacityFunction,
  blendConfig: BlendConfig,
}) satisfies z.ZodType<LayersConfig>;

const ViewConfig = z.object({
  window: WindowLevelConfig.optional(),
  slice: SliceConfig.optional(),
  layers: LayersConfig.optional(),
  camera: CameraConfig.optional(),
  volumeColorConfig: VolumeColorConfig.optional(),
});

export type ViewConfig = z.infer<typeof ViewConfig>;

const View = z.object({
  id: z.string(),
  type: z.string(),
  props: z.record(z.any()),
  config: z.record(ViewConfig),
});

export type View = z.infer<typeof View>;

const RGBAColor = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const SegmentMask = z.object({
  value: z.number(),
  name: z.string(),
  color: RGBAColor,
});

export const SegmentGroupMetadata = z.object({
  name: z.string(),
  parentImage: z.string(),
  segments: z.object({
    order: z.number().array(),
    byValue: z.record(z.string(), SegmentMask),
  }),
});

export const LabelMap = z.object({
  id: z.string(),
  path: z.string(),
  metadata: SegmentGroupMetadata,
});

export type LabelMap = z.infer<typeof LabelMap>;

const LPSAxis = z.union([
  z.literal('Axial'),
  z.literal('Sagittal'),
  z.literal('Coronal'),
]) satisfies z.ZodType<LPSAxis>;

const FrameOfReference = z.object({
  planeOrigin: Vector3,
  planeNormal: Vector3,
}) satisfies z.ZodType<FrameOfReference>;

const annotationTool = z.object({
  imageID: z.string(),
  frameOfReference: FrameOfReference,
  slice: z.number(),
  id: z.string() as unknown as z.ZodType<ToolID>,
  name: z.string(),
  color: z.string(),
  strokeWidth: z.number().optional(),
  label: z.string().optional(),
  labelName: z.string().optional(),
}) satisfies z.ZodType<AnnotationTool>;

const makeToolEntry = <T extends z.ZodRawShape>(tool: z.ZodObject<T>) =>
  z.object({ tools: z.array(tool), labels: z.record(tool.partial()) });

const Ruler = annotationTool.extend({
  firstPoint: Vector3,
  secondPoint: Vector3,
}) satisfies z.ZodType<Ruler>;

const Rulers = makeToolEntry(Ruler);

const Rectangle = Ruler.extend({
  fillColor: z.string().optional(),
}) satisfies z.ZodType<Optional<Rectangle, 'fillColor'>>;

const Rectangles = makeToolEntry(Rectangle);

const Polygon = annotationTool.extend({
  id: z.string() as unknown as z.ZodType<ToolID>,
  points: z.array(Vector3),
}) satisfies z.ZodType<Omit<Polygon, 'movePoint'>>;

const Polygons = makeToolEntry(Polygon);

const Crosshairs = z.object({
  position: Vector3,
});

export type Crosshairs = z.infer<typeof Crosshairs>;

const ToolsEnumNative = z.nativeEnum(ToolsEnum);

const Paint = z.object({
  activeSegmentGroupID: z.string().nullable(),
  activeSegment: z.number().nullish(),
  brushSize: z.number(),
  labelmapOpacity: z.number(),
});

const LPSCroppingPlanes = z.object({
  Sagittal: z.tuple([z.number(), z.number()]),
  Coronal: z.tuple([z.number(), z.number()]),
  Axial: z.tuple([z.number(), z.number()]),
}) satisfies z.ZodType<LPSCroppingPlanes>;

const Cropping = z.record(LPSCroppingPlanes);

const Tools = z.object({
  rulers: Rulers.optional(),
  rectangles: Rectangles.optional(),
  polygons: Polygons.optional(),
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
