// Sources
export {
  fromBlob,
  fromUrl,
  readBytes,
  type ByteSource,
} from './source/byteSource';

// Instances
export {
  readInstance,
  type Instance,
  type ReadInstanceOptions,
} from './instance/readInstance';
export {
  IMPLICIT_VR_LITTLE_ENDIAN,
  EXPLICIT_VR_LITTLE_ENDIAN,
  type DicomLayout,
} from './metadata/dicomLayout';

// Datasets
export {
  readDicomDataset,
  isPrivateElement,
  type DicomDataset,
  type DicomElement,
} from './metadata/dicomDataset';
export { getDatasetTag, getDatasetModality } from './metadata/datasetAccess';
export { sequenceItems } from './metadata/functionalGroups';
export { trimDicomPadding } from './utils';
export {
  Tags,
  SOP_CLASS_ULTRASOUND_MULTIFRAME,
  SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED,
  isUltrasoundMultiframeSopClass,
} from './metadata/dicomTags';

// Collections
export {
  emptyRegistry,
  registerInstances,
  forgetCollection,
  type RegistryState,
  type InstanceCollectionUpdate,
} from './collections/instanceRegistry';
export { seriesKeyOf } from './collections/instanceFacts';

// Volumes
export {
  allocateVolume,
  type Volume,
  type AllocateVolumeOptions,
} from './volume/allocateVolume';
export {
  loadVolume,
  middleSlot,
  type VolumeUpdate,
  type Extent,
} from './volume/loadVolume';
export {
  getVolumeBufferType,
  instancePixelFormats,
  type VolumeBufferConstructor,
} from './volume/pixelFormat';

// Spatial metadata
export {
  physicalSpacing,
  fallbackSpacing,
  type SpatialMetadata,
} from './metadata/spatialMetadata';
export { unitToMm, ultrasoundRegionsOf } from './metadata/ultrasoundRegion';

// Decoders
export {
  wholeInstanceDecoder,
  type PixelDecoder,
  type DecodeUnit,
  type DecodedPixels,
  type WholeInstanceDecode,
} from './pixels/pixelDecoder';
export {
  defaultDecoderTable,
  singleDecoderTable,
  planDecode,
  type DecoderTable,
} from './pixels/decoderTable';
export { nativeFrameDecoder } from './pixels/nativeFrame';
export { indexFrames } from './pixels/frameIndex';
export { splitEncapsulatedFrames } from './pixels/encapsulatedFrames';

// Runtime
export {
  createDicomRuntime,
  type DicomRuntime,
  type DicomRuntimeOptions,
} from './runtime/createDicomRuntime';

// The byte reader under the header parser, which the app also uses to sniff file types
export { default as StreamingByteReader } from './header/streamingByteReader';
