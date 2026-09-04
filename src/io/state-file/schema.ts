import JSZip from 'jszip';
import { z } from 'zod';
import type { Vector3 } from '@kitware/vtk.js/types';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import type {
  PiecewiseGaussian,
  PiecewiseNode,
} from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';

import type { ToolID } from '@/src/types/annotation-tool';
import { Tools as ToolsEnum } from '@/src/store/tools/types';
import type { Ruler } from '@/src/types/ruler';
import type { Rectangle } from '@/src/types/rectangle';
import type { Polygon } from '@/src/types/polygon';
import type { LPSCroppingPlanes } from '@/src/types/crop';
import type { FrameOfReference } from '@/src/utils/frameOfReference';

import type {
  CameraConfig,
  SliceConfig,
  WindowLevelConfig,
  LayersConfig,
  VolumeColorConfig,
  CinePlaybackViewConfig,
} from '@/src/store/view-configs/types';
import type { LPSAxis } from '@/src/types/lps';
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
} from '@/src/types/views';
import { WLAutoRanges } from '@/src/constants';
import {
  type Layout,
  type LayoutDirection,
  type LayoutItem,
} from '@/src/types/layout';

const FileSource = z.object({
  id: z.number(),
  type: z.literal('file'),
  fileId: z.number(),
  fileType: z.string(),
  parent: z.number().optional(),
});

const UriSource = z.object({
  id: z.number(),
  type: z.literal('uri'),
  uri: z.string(),
  name: z.string().optional(),
  mime: z.string().optional(),
  parent: z.number().optional(),
});

const ArchiveSource = z.object({
  id: z.number(),
  type: z.literal('archive'),
  path: z.string(),
  parent: z.number(),
});

const CollectionSource = z.object({
  id: z.number(),
  type: z.literal('collection'),
  sources: z.number().array(),
  parent: z.number().optional(),
});

const DataSource = z.union([
  FileSource,
  UriSource,
  ArchiveSource,
  CollectionSource,
]);

export type DataSourceType = z.infer<typeof DataSource>;

const Dataset = z.object({
  id: z.string(),
  dataSourceId: z.number(),
});

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

const LayoutDirectionNative = z.enum([
  'row',
  'column',
] as const satisfies readonly LayoutDirection[]);

const LayoutItem: z.ZodType<LayoutItem> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('slot'),
      slotIndex: z.number(),
    }),
    z.object({
      type: z.literal('layout'),
      direction: LayoutDirectionNative,
      items: z.array(LayoutItem),
    }),
  ])
);

const Layout: z.ZodType<Layout> = z.lazy(() =>
  z.object({
    direction: LayoutDirectionNative,
    items: z.array(LayoutItem),
  })
);

const Vector3 = z.tuple([
  z.number(),
  z.number(),
  z.number(),
]) satisfies z.ZodType<Vector3>;

type AutoRangeKeys = keyof typeof WLAutoRanges;
const WindowLevelConfig = z
  .object({
    width: z.number().optional(),
    level: z.number().optional(),
    auto: z.string() as z.ZodType<AutoRangeKeys>,
    useAuto: z.boolean().optional(),
    userTriggered: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // If useAuto is false, width and level must be present
      if (
        data.useAuto === false &&
        (data.width === undefined || data.level === undefined)
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'width and level are required when useAuto is false',
    }
  ) satisfies z.ZodType<WindowLevelConfig>;

const SliceConfig = z.object({
  slice: z.number(),
  min: z.number(),
  max: z.number(),
  syncState: z.boolean(),
}) satisfies z.ZodType<SliceConfig>;

const CameraConfig = z.object({
  parallelScale: z.number().optional(),
  position: Vector3.optional(),
  focalPoint: Vector3.optional(),
  directionOfProjection: Vector3.optional(),
  viewUp: Vector3.optional(),
  syncState: z.boolean().optional(),
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
  visibility: z.boolean(),
}) satisfies z.ZodType<BlendConfig>;

const LayersConfig = z.object({
  colorBy: ColorBy,
  transferFunction: ColorTransferFunction,
  opacityFunction: OpacityFunction,
  blendConfig: BlendConfig,
}) satisfies z.ZodType<LayersConfig>;

const CinePlaybackViewConfig = z.object({
  frame: z.number(),
}) satisfies z.ZodType<CinePlaybackViewConfig>;

const ViewConfig = z.object({
  window: WindowLevelConfig.optional(),
  slice: SliceConfig.optional(),
  layers: LayersConfig.optional(),
  camera: CameraConfig.optional(),
  volumeColorConfig: VolumeColorConfig.optional(),
  cinePlayback: CinePlaybackViewConfig.optional(),
});

export type ViewConfig = z.infer<typeof ViewConfig>;

const View = z.object({
  id: z.string(),
  name: z.string(),
  type: z.union([z.literal('2D'), z.literal('3D'), z.literal('Oblique')]),
  dataID: z.string().optional().nullable(),
  options: z.record(z.string(), z.string()).optional(),
  config: z.record(z.string(), ViewConfig).optional(),
});

export type View = z.infer<typeof View>;

const RGBAColor = z.tuple([z.number(), z.number(), z.number(), z.number()]);

// Provenance of a scene object produced by a processing job. This durable
// identity prevents a restored result from being applied twice. Optional and
// additive wherever it is used; hand-made state has none. The shape mirrors the
// backend contract's result source and is shared by groups and annotation tools.
export const ProcessingResultSource = z.object({
  providerId: z.string(),
  jobId: z.string(),
  outputId: z.string(),
});

const Extent3D = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

const LabelmapBinding = z.object({
  artifactId: z.string(),
  labelValue: z.number(),
  extent: Extent3D,
});

const Segment = z.object({
  id: z.string(),
  name: z.string(),
  color: RGBAColor,
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  fillOpacity: z.number().default(1),
  outlineOpacity: z.number().default(1),
  representations: z.object({ labelmap: LabelmapBinding.optional() }),
});

export const Segmentation = z.object({
  id: z.string(),
  name: z.string(),
  parentImage: z.string(),
  segments: Segment.array(),
  order: z.string().array(),
  activeSegment: z.string().optional(),
  fillOpacity: z.number().default(1),
  outlineOpacity: z.number().default(1),
  outlineThickness: z.number().default(2),
});

export type Segmentation = z.infer<typeof Segmentation>;

// Persistent labelmap identity, separate from the runtime artifact index:
// segment bindings reference `id`, and `path`/`dataSourceId` resolve the bytes.
export const SegmentationArtifact = z
  .object({
    id: z.string(),
    parentImage: z.string(),
    name: z.string(),
    path: z.string().optional(),
    dataSourceId: z.number().optional(),
    source: ProcessingResultSource.optional(),
    // Set only by the 7.0.0 migration, for a legacy group that carried no
    // segment descriptors: the loaded restore stage enumerates its voxels.
    pendingDecode: z.boolean().optional(),
    // Also migration-only: a legacy group holds every segment in one buffer,
    // and restore divides it into one bounded mask per segment.
    pendingSplit: z.boolean().optional(),
    // Also migration-only: the legacy active paint value, reactivated once the
    // decode above has created the segments it names.
    pendingActiveValue: z.number().optional(),
    // Also migration-only: display state applied after a legacy artifact has
    // been decoded into segments.
    pendingFillOpacity: z.number().optional(),
    pendingOutlineOpacity: z.number().optional(),
    pendingVisibility: z.boolean().optional(),
  })
  .refine(
    (data) => data.path !== undefined || data.dataSourceId !== undefined,
    {
      message: 'Either path or dataSourceId is required',
    }
  );

export type SegmentationArtifact = z.infer<typeof SegmentationArtifact>;

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
  frame: z.number().optional(),
  id: z.string().optional() as unknown as z.ZodType<ToolID | undefined>,
  name: z.string().optional(),
  color: z.string().optional(),
  strokeWidth: z.number().optional(),
  label: z.string().optional(),
  labelName: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  // Job provenance, present only on a tool applied from a result. Unknown keys
  // are stripped on parse, so restore would silently drop the idempotency key
  // without this declaration.
  source: ProcessingResultSource.optional(),
});

// Rulers own their labels, so identity rides on the tool entry.
const makeLabelledToolEntry = <T extends z.ZodRawShape>(tool: z.ZodObject<T>) =>
  z.object({
    tools: z.array(tool),
    labels: z.record(z.string(), tool.partial()).optional(),
  });

// Polygons and rectangles point at segments: identity lives on the
// segmentation, and only the per-tool props are keyed by segment id here. A
// config template has no segment yet, so a tool labeled with one needs the
// template itself on the wire, keyed by template name.
const makeSegmentToolEntry = <T extends z.ZodRawShape>(tool: z.ZodObject<T>) =>
  z.object({
    tools: z.array(tool),
    segmentProps: z.record(z.string(), tool.partial()).optional(),
    templates: z.record(z.string(), tool.partial()).optional(),
  });

const Ruler = annotationTool.extend({
  firstPoint: Vector3,
  secondPoint: Vector3,
});

const Rulers = makeLabelledToolEntry(Ruler);

const Rectangle = Ruler.extend({
  fillColor: z.string().optional(),
});

const Rectangles = makeSegmentToolEntry(Rectangle);

const Polygon = annotationTool.extend({
  points: z.array(Vector3),
});

const Polygons = makeSegmentToolEntry(Polygon);

const ToolsEnumNative = z.nativeEnum(ToolsEnum);

const Paint = z.object({
  brushSize: z.number().optional(),
  crossPlaneSync: z.boolean().optional(),
  labelmapOpacity: z.number().optional(),
});

const LPSCroppingPlanes = z.object({
  Sagittal: z.tuple([z.number(), z.number()]),
  Coronal: z.tuple([z.number(), z.number()]),
  Axial: z.tuple([z.number(), z.number()]),
}) satisfies z.ZodType<LPSCroppingPlanes>;

const Cropping = z.record(z.string(), LPSCroppingPlanes);

const Tools = z.object({
  rulers: Rulers.optional(),
  rectangles: Rectangles.optional(),
  polygons: Polygons.optional(),
  paint: Paint.optional(),
  crop: Cropping.optional(),
  current: ToolsEnumNative.optional(),
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
  datasets: Dataset.array().optional(),
  dataSources: DataSource.array(),
  datasetFilePath: z.record(z.string(), z.string()).optional(),
  segmentations: Segmentation.array().optional(),
  segmentationArtifacts: SegmentationArtifact.array().optional(),
  tools: Tools.optional(),
  activeView: z.string().optional().nullable(),
  isActiveViewMaximized: z.boolean().optional(),
  viewByID: z.record(z.string(), View).optional(),
  primarySelection: z.string().optional(),
  layout: Layout.optional(),
  layoutSlots: z.array(z.string()).optional(),
  parentToLayers: ParentToLayers.optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

// The manifest's base datasets; older manifests carry no `datasets`, so every
// uri source stands in for one, keyed by its stringified source id.
export const manifestDatasets = (manifest: Manifest) =>
  manifest.datasets ??
  manifest.dataSources
    .filter((ds) => ds.type === 'uri')
    .map((ds) => ({ id: String(ds.id), dataSourceId: ds.id }));

export type StateFile = {
  zip: JSZip;
  manifest: Manifest;
};
