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
  SegmentGroupConfig,
  VolumeColorConfig,
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

const SegmentGroupConfig = z.object({
  outlineOpacity: z.number(),
  outlineThickness: z.number(),
}) satisfies z.ZodType<SegmentGroupConfig>;

const ViewConfig = z.object({
  window: WindowLevelConfig.optional(),
  slice: SliceConfig.optional(),
  layers: LayersConfig.optional(),
  segmentGroup: SegmentGroupConfig.optional(),
  camera: CameraConfig.optional(),
  volumeColorConfig: VolumeColorConfig.optional(),
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

const SegmentMask = z.object({
  value: z.number(),
  name: z.string(),
  color: RGBAColor,
  visible: z.boolean().default(true),
});

export const SegmentGroupMetadata = z.object({
  name: z.string(),
  parentImage: z.string(),
  segments: z.object({
    order: z.number().array(),
    byValue: z.record(z.string(), SegmentMask),
  }),
});

export const SegmentGroup = z
  .object({
    id: z.string(),
    path: z.string().optional(),
    dataSourceId: z.number().optional(),
    metadata: SegmentGroupMetadata,
  })
  .refine(
    (data) => data.path !== undefined || data.dataSourceId !== undefined,
    {
      message: 'Either path or dataSourceId is required',
    }
  );

export type SegmentGroup = z.infer<typeof SegmentGroup>;

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
  id: z.string().optional() as unknown as z.ZodType<ToolID | undefined>,
  name: z.string().optional(),
  color: z.string().optional(),
  strokeWidth: z.number().optional(),
  label: z.string().optional(),
  labelName: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const makeToolEntry = <T extends z.ZodRawShape>(tool: z.ZodObject<T>) =>
  z.object({
    tools: z.array(tool),
    labels: z.record(z.string(), tool.partial()),
  });

const Ruler = annotationTool.extend({
  firstPoint: Vector3,
  secondPoint: Vector3,
});

const Rulers = makeToolEntry(Ruler);

const Rectangle = Ruler.extend({
  fillColor: z.string().optional(),
});

const Rectangles = makeToolEntry(Rectangle);

const Polygon = annotationTool.extend({
  points: z.array(Vector3),
});

const Polygons = makeToolEntry(Polygon);

const Crosshairs = z.object({
  position: Vector3.optional(),
});

export type Crosshairs = z.infer<typeof Crosshairs>;

const ToolsEnumNative = z.nativeEnum(ToolsEnum);

const Paint = z.object({
  activeSegmentGroupID: z.string().nullable().optional(),
  activeSegment: z.number().nullish(),
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
  crosshairs: Crosshairs.optional(),
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
  segmentGroups: SegmentGroup.array().optional(),
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

export interface StateFile {
  zip: JSZip;
  manifest: Manifest;
}
