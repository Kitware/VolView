# Browser DICOM module

This private directory uses VolView's root install, lockfile and checks. It has
no workspace install or release workflow. VolView imports defining source
modules directly; the root npm distribution includes the core and vtk source
files alongside `dist`, `src` and `backend-contract`. Package tests and
standalone build output are excluded from that distribution.

- `core/`: byte sources, header reading into structured `DicomDataset`
  metadata, collection planning with stable identity, volume allocation and
  loading into calibrated typed arrays, and the runtime that owns workers and
  requests. It has no Vue, Pinia or vtk.js dependency.
- `vtk/`: a thin adapter that shows a core `Volume` as a `vtkImageData`.
  vtk.js is an optional peer, required only by consumers of these modules.

The package exports concrete module subpaths under `@volview/dicom/core/*` and
`@volview/dicom/vtk/*`; there are no aggregate entry points.

VolView owns its reactive wrappers, messages, browser state, selections,
annotations, layers, import handling and session provenance.

## Values and effects

Instances, plans and volumes are plain values. Only the runtime holds
resources, and only it has `dispose()`. Every asynchronous operation takes an
`AbortSignal`; aborting it is the whole of cancellation.

```ts
import { createDicomRuntime } from '@volview/dicom/core/runtime/createDicomRuntime';
import { fromBlob, fromUrl } from '@volview/dicom/core/source/byteSource';
import {
  emptyRegistry,
  registerInstances,
} from '@volview/dicom/core/collections/instanceRegistry';
import { allocateVolume } from '@volview/dicom/core/volume/allocateVolume';
import { loadVolume } from '@volview/dicom/core/volume/loadVolume';
import {
  applyVolumeUpdate,
  toVtkImageData,
} from '@volview/dicom/vtk/volumeImage';

const runtime = createDicomRuntime({
  assets: {
    pipelineWorkerUrl: new URL(
      './assets/itk-wasm-pipeline.min.worker.js',
      document.baseURI
    ).href,
    imageIOUrl: new URL('./assets/image-io', document.baseURI).href,
  },
});
const { signal } = new AbortController();

const sources = [fromBlob(file), fromUrl(url, { fetch: runtime.fetch })];
const instances = await Promise.all(
  sources.map((source) => runtime.readInstance(source, signal))
);

const { state, updates } = registerInstances(emptyRegistry, instances);
const allocation = allocateVolume(updates[0]);
if (allocation.kind === 'volume') {
  const { volume } = allocation;
  const image = toVtkImageData(volume);
  for await (const update of loadVolume(volume, { runtime, signal })) {
    if ('error' in update) console.error(update.error);
    else applyVolumeUpdate(image, volume, update);
  }
}
```

### Sources

A `ByteSource` opens a fresh stream for every `read(signal, range?)` and holds
nothing open between reads. `fromBlob` reads slices of a Blob or File.
`fromUrl` issues HTTP Range requests and accepts a server that ignores Range;
pass `runtime.fetch` so requests share the runtime's pool, or any `fetch` for
authentication and other request policies. `readBytes(source, signal, range?)`
reads a source or range into memory. Decoded instances keep no bytes; read the
source again when original bytes are needed. `rangeSupport()` reports whether
a URL source's last ranged response honoured Range. Ranged URL reads bypass
the HTTP cache, since Chrome can answer a Range from an entry an earlier
cancelled read left behind with status 200 and only the range's bytes.

### Instances

`runtime.readInstance(source, signal)` reads only the header, stopping at Pixel
Data, and returns a frozen `Instance`: its source, dataset, Part 10 layout,
transfer syntax, ultrasound regions and where the Pixel Data element and its
value sit. The dataset omits private
attributes, including private elements nested in public sequences; use
`readDicomDataset` directly when they are needed. A source without a preamble
or file meta information is read with its transfer syntax assumed and reported
in `layout`. The runtime's `imageImportPolicy: 'skip-radiotherapy'` returns
after the Modality element of RT objects; `'complete-header'` (the default)
reads through the header.

### Collections

`registerInstances(state, instances)` is a pure reducer. It returns the next
`state`, the collections whose membership or label changed as `updates`, the
ids a replan dissolved as `removed`, and SOP Instance UIDs re-supplied with
conflicting geometry. Each update carries a stable `id` that starts with the
Series Instance UID, the planned `collection`, `members` in planned order and,
aligned with them, `provenance`: the batch's own instance wherever it
re-supplied one. The first registration of a SOP Instance UID is kept;
instances without one are identified by object. Abandoning an import is not
assigning the returned state. `forgetCollection(state, id)` drops a collection
and its instances so a later import plans them afresh; `isRegistered` checks
whether an object is the registered instance.

### Volumes

`allocateVolume(update, options, previous?)` allocates the buffer a planned
collection fills, or reports `{ kind: 'segmentation' }` for SEG, whose labels a
segmentation reader turns into its own image. A `Volume` holds a typed array,
dimensions, components, origin, row-major direction, spacing, spatial metadata,
reconstruction, members, allocation warnings and a per-slice `loaded` mask.
With `previous`, slices it already decoded are copied by instance identity, so
growing a volume never decodes them again. The buffer type comes from the
headers' rescaled value ranges. Ranges beyond 16 bit integers use Float32
rather than Int32 or Uint32 while every value is within 2^24, and fractional
rescales use Float32 rather than Float64 while Bits Stored is at most 24 and
float32's spacing stays below the slope, since vtk.js converts any other
buffer type to float32 whole on every upload. Decoded values a Float32 volume
would round or merge are rejected. `irregularGeometry: 'preserve-order'` (the
default) keeps approximate spacing for irregular stacks; `'reject'` refuses
them. Neither resamples. Supplied slots must start at zero because the first
member anchors the origin; gaps such as `[0, 2]` are allowed.

`loadVolume(volume, { runtime, signal, focus?, readAhead? })` is an async
generator of `{ slot, extent, range }` or `{ slot, extent, error }` updates. It
writes decoded pixels into `volume.data` and marks `volume.loaded`. A failure's
extent spans the slices it leaves unloaded, and loading continues. Units load
focus first and then coarse to fine across the stack (`pickNextSlot`); `focus`
is read before every read and decode, so moving it reorders the remaining
work. Reads run ahead of decoding: at most `readAhead` units, defaulting to
the runtime's request concurrency, are being read or waiting to decode.
Aborting `signal`, leaving the loop or disposing the runtime ends the
iteration without throwing.

The unit is a frame wherever the runtime's decoder table can decode one
without a codec (`planDecode` in `core/pixels/decoderTable.ts`): each frame is
a ranged read from the Pixel Data value (`indexFrames`), decoded on the
calling thread (`decodeNativeFrame`). Every other instance is read and decoded
whole. Once a URL source shows that its server ignores Range, the remaining
frames of that instance come from one read instead of one download each;
until then its frames are read one at a time.

### Runtime

`createDicomRuntime(options)` owns the decoder table (`decoders`), the request pool (`requestConcurrency`,
default 24, exposed as `readConcurrency`), the metadata parser workers
(`metadataConcurrency`, or `metadataWorkerFactory` for another asset layout)
and a pool of GDCM decode workers (`decodeConcurrency`, default half the
cores, at most four; each worker carries its own WASM heap). A supplied
`decoder` replaces GDCM and owns its own resources; with one, every instance
goes to it whole unless `decoders` says otherwise. Metadata-only use needs no
decoder or WASM assets. `dispose()` aborts everything pending.

The default table decodes Implicit and Explicit VR Little Endian and Explicit
VR Big Endian frames natively where the result is identical to GDCM's:
MONOCHROME2 or unsigned 8 bit RGB samples, 8, 16 or 32 bit words with Bits
Stored ending at High Bit (fewer stored bits only in 16 bit words), 16 bit
words only when big endian, one modality rescale for all frames, and no
overlay, curve, Modality LUT, palette or ICC data. Other transfer syntaxes and
declined instances go to GDCM; video and JPEG XL syntaxes fail as known
syntaxes without a decoder. Both paths apply one modality transform to the
entire instance and reject differing per-frame slopes or intercepts. Injected
decoders may support those transforms. Separate single-frame files may have
different transforms.

### vtk adapter

`toVtkImageData(volume)` wraps the volume's buffer and geometry without
copying; before any slice decodes its scalar range is a 0 to 255 placeholder.
`applyVolumeUpdate(image, volume, update)` widens the scalar range by a
decoded slice and marks the image modified. `sliceThumbnail(image, slice)`
downsamples one loaded slice to an 8 bit greyscale thumbnail, and
`encodeThumbnailToUri` in `vtk/thumbnail.ts` turns it into a PNG data URI.

## Geometry and calibration

Enhanced instances read image geometry and modality transforms from their
shared and per-frame functional groups. Regular spatial frames retain their
stored pixel order, including acquisitions whose frame direction opposes the
row/column cross product. Single-detector reconstructed NM stacks use their
detector patient geometry and signed slice spacing. Gated NM requires temporal
assembly and is rejected.

OCT shared in-plane spacing is preserved. Calibrated placement between B-scans
requires a matching ophthalmic localizer and remains unsupported. Optical slice
thickness does not define B-scan separation. Vendor-specific ultrasound volume
calibration, RT dose semantics and floating-point parametric maps also require
dedicated import support. VolView skips all RT modalities for both File and HTTP
imports, including RTIMAGE and RTDOSE; these objects do not create a volume.

`volume.spatialMetadata` reports the applied spacing in image x/y/z order,
including ultrasound region overrides. Each axis records its value, unit (`mm`
or `unknown`), source, and whether it was declared, derived from positions, or
supplied as a display fallback. Reconstruction quality and ultrasound region
limitations are separate from the unit. These are statements about the source
and allocation, not independent calibration.

Missing physical spacing is permitted for some DICOM objects, including
[secondary captures](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_A.8.html).
Ordinary patient PixelSpacing and ImagePositionPatient use millimeters without
requiring an additional calibration tag. A fallback value of 1 does not
establish a millimeter scale. A singleton axis does not establish a distance
between slices.

## Standalone checks

`npm run dicom:build` emits ES modules and declarations in `packages/dicom/dist`,
including the parser worker, the ITK pipeline worker and the GDCM image reader
assets. Serve the assets from a URL your application controls and pass their
locations explicitly. `npm run dicom:check` builds the package and typechecks
and bundles two small consumers against its emitted JavaScript and
declarations. It rejects VolView application imports and Vue/Pinia
dependencies, and rejects vtk.js in the core consumer. Package boundary tests
also check relative imports and declared dependencies.

`npm run test:e2e:chrome:skip-build -- --spec tests/specs/dicom-package.e2e.ts`
serves those standalone production bundles, generates its DICOM in memory, and
checks Blob/HTTP metadata, calibrated pixel values, decode worker recovery and
vtk geometry through rendered page output, including a screenshot.

`tests/specs/dicom-volume-corpus.e2e.ts` exercises pinned public CT, MR and
SPECT files through both File and HTTP sources, plus numeric-padding fixtures.
It checks dimensions, physical geometry, explicit unsupported-topology errors
and the hash of every calibrated voxel through rendered consumer output. Public
URLs, input checksums, independently decoded pixel hashes and provenance are
recorded in `tests/dicomVolumeCorpus.json`; downloads use the ignored dataset
cache.

`tests/specs/dicom-native-parity.e2e.ts` decodes synthesized instances across
the native format matrix and every cached uncompressed dataset through GDCM
and frame by frame natively, from File and HTTP sources. Wherever the decoder
table plans native frames, both must write identical samples into the volume,
which for a fractional rescale means equal after the same float32 rounding,
and integer GDCM output must equal the native values before any conversion.

`tests/specs/dicom-volume-composition.e2e.ts` composes downloaded classic CT/PET
series and two MR acquisitions sharing one Series UID. It checks every
collection's ordered SOP membership, complete calibrated voxel hash and
physical geometry after shuffled batch and incremental File/HTTP imports.
`tests/dicomCompositionCorpus.json` records the pinned inputs and independent
expectations. The optional `compositionReference.py` beside the consumer
fixtures reproduces those expectations using pydicom and NumPy from the cache.
