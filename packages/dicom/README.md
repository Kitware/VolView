# Browser DICOM module

Reads DICOM instances from Blobs or URLs, groups them into collections and
loads calibrated pixel volumes in the browser. It is a directory of VolView
source, not a separate package.

## Layout

- `core`: sources, instances, datasets, collections, volume allocation and
  loading, decoders and the runtime. No Vue, Pinia, vtk.js or VolView
  application code.
- `vtk`: shows a core `Volume` as a `vtkImageData` and makes slice
  thumbnails.

Callers import each name from the file that defines it. Inside the module,
`core` imports only relative paths and its npm dependencies (`comlink`,
`dcmjs`, `itk-wasm`); `vtk` adds vtk.js and gl-matrix.
`__tests__/boundaries.spec.ts` checks that relative imports stay inside the
module, that `core` does not reach `vtk`, and that module tests, with the
shared fixtures they import from `tests/`, reach no VolView application code.

| Directory          | Holds                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| `core/source`      | byte sources for Blobs and URLs, HTTP range handling                     |
| `core/header`      | the streaming reader that finds Pixel Data and the header parser over it |
| `core/metadata`    | datasets, tags, functional groups, rescale, spacing, ultrasound regions  |
| `core/instance`    | `readInstance`                                                           |
| `core/collections` | header facts, collection planning and the registry                       |
| `core/volume`      | allocation, pixel formats, validation and `loadVolume`                   |
| `core/pixels`      | decoders, the decoder table, frame index, encapsulated frames            |
| `core/runtime`     | the runtime, its request pool, metadata workers and GDCM decoder         |
| `vtk`              | the vtk.js image and thumbnails                                          |

## Values and effects

Instances, collection updates and volumes are plain values. Only the runtime
holds resources, and only it has `dispose()`. Every asynchronous operation
takes an `AbortSignal`; aborting it is the whole of cancellation. Importing
a module file starts no worker and touches no DOM.

```ts
import { fromBlob, fromUrl } from '@/packages/dicom/core/source/byteSource';
import { createDicomRuntime } from '@/packages/dicom/core/runtime/createDicomRuntime';
import {
  emptyRegistry,
  registerInstances,
} from '@/packages/dicom/core/collections/instanceRegistry';
import { allocateVolume } from '@/packages/dicom/core/volume/allocateVolume';
import { loadVolume } from '@/packages/dicom/core/volume/loadVolume';
import {
  applyVolumeUpdate,
  toVtkImageData,
} from '@/packages/dicom/vtk/volumeImage';

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
const [update] = updates;
if (update.kind === 'image') {
  const volume = allocateVolume(update);
  const image = toVtkImageData(volume);
  for await (const loaded of loadVolume(volume, { runtime, signal })) {
    if ('error' in loaded) console.error(loaded.error);
    else applyVolumeUpdate(image, loaded);
  }
}
```

## Sources

A `ByteSource` opens a fresh stream for every `read(signal, range?)` and
holds nothing open between reads. `fromBlob` reads a Blob or File: a range
with an end in one slice, an open read in slices that double from 64 KiB,
since each slice costs a turn of the calling thread.
`fromUrl` issues HTTP Range requests and accepts a server that ignores Range;
pass `runtime.fetch` so requests share the runtime's pool, or any `fetch` for
authentication and other request policies. Its `rangeSupport()` reports
whether the latest ranged response honoured Range. Ranged URL reads bypass the
HTTP cache, since Chrome can answer a Range from an entry an earlier cancelled
read left behind with status 200 and only the range's bytes. A status other
than 200, 206 or 416 fails with `HTTP <status> for <url>`. The `fetch` it was
given sees its signal abort once a body has been read to the end, so a pooled
request lets go of the pool.
`readBytes(source, signal, range?)` reads a source or a range into memory.
Instances keep no bytes; read the source again when the original bytes are
needed.

## Instances and datasets

`runtime.readInstance(source, signal)` scans the header on the calling
thread, stopping where Pixel Data begins, parses the dataset in a worker and
returns a frozen `Instance`: its source, dataset, Part 10 layout, transfer
syntax, ultrasound regions and where the Pixel Data element and its value sit.
The free function `readInstance(source, signal)` does both on the calling
thread.
A source without a preamble or file meta information is read with its
transfer syntax assumed and reported in `layout`. The runtime's
`imageImportPolicy: 'skip-radiotherapy'` returns after the Modality element of
RT objects; `'complete-header'` (the default) reads through the header.

The dataset omits private elements, including those nested in public
sequences; `readDicomDataset(bytes)` reads every element before Pixel Data,
private ones included, from a file with or without the Part 10 preamble and
file meta information.
`getDatasetTag(dataset, tag)` returns an element's values as backslash
separated text, `getDatasetModality` the trimmed Modality, `sequenceItems`
the items of a sequence, and `trimDicomPadding` strips the space and NUL
padding DICOM text values carry. `Tags` names the attributes VolView reads;
tags may be written `ggggeeee` or `gggg|eeee`. `ultrasoundRegionsOf(dataset)`
reads every item of the Sequence of Ultrasound Regions.

## Collections

`registerInstances(state, instances)` is a pure reducer. It returns the next
`state`; `updates`, the collections of each touched series that are new or
changed, whose label or warnings changed, or that the batch re-supplied a
member of; `removed`, the committed ids a replan dissolved; and
`conflictingInstanceUids`, SOP Instance UIDs re-supplied with different header
facts. The first registration of a SOP Instance UID is kept; instances without
one are identified by object. Abandoning an import is not assigning the
returned state. Register a series in batches: each call replans every series
the batch touches.

Each `InstanceCollectionUpdate` carries a stable `id` that starts with the
Series Instance UID, the planned `collection`, `members` in planned order and,
aligned with them, `provenance`: the batch's own instance wherever it
re-supplied one with the same header facts. `kind` is `image`, or `segmentation` when the first member's
Modality is SEG; a segmentation reader turns those labels into its own image.
`change` says how the collection differs from what was last committed under
its id: `new`, `unchanged` (same members and geometry, so an allocated volume
stands; it is still reported when its label or warnings changed) or `changed`.
A collection's `label` names what separated it from the rest of its series and
is null when nothing did.

`forgetCollection(state, id)` drops a collection and its instances, so a later
import plans them afresh. `seriesKeyOf` gives the series an instance plans in:
its Series Instance UID within its Study Instance UID.

## Volumes and loading

`allocateVolume(update, previous?)` allocates the `Volume` an image collection
fills: a typed array, dimensions, components, origin, row-major direction,
spacing, spatial metadata, members, allocation warnings and a per-slice
`loaded` mask. With `previous`, slices it already decoded are copied by
instance identity, so growing a volume never decodes them again. In a
multi-file volume member i fills slice i. An irregular stack keeps its planned
order with approximate spacing and is not resampled;
`volume.spatialMetadata.reconstruction` says whether a volume is regular and,
when it is not, why.

The buffer type comes from the headers' rescaled value ranges
(`getVolumeBufferType(instancePixelFormats(dataset))` for one instance).
Integer ranges beyond 16 bits use Float32 rather than Int32 or Uint32 while
every value is within 2^24, and fractional rescales use Float32 rather than
Float64 while Bits Stored is at most 24 and float32's spacing stays below the
slope, since vtk.js converts any other buffer type to float32 whole on every
upload. Decoded values the buffer would round, merge or not hold are rejected.

`loadVolume(volume, { runtime, signal, focus?, readAhead? })` is an async
generator of `{ slot, extent, range }` or `{ slot, extent, error }` updates.
It writes each unit's samples into `volume.data` as soon as they decode, and
marks its slices in `volume.loaded` only when its update is yielded, so a
consumer that awaits between updates never holds up decoding and never sees a
slice loaded before its update. Decodes that return synchronously run back to
back for a few milliseconds and then hand the thread back, so a batch of
frames read at once does not hold it.
Nothing is written after the load stops. A failure's extent spans the slices
it leaves unloaded, and loading continues. Its message names the file, and the
frame when it lost one, and says whether it could not be read or decoded; the
thrown value is its `cause`. A file cut short loads the frames it
still holds and fails the rest. Units load focus first, then coarse to fine
across the stack; `focus` (default `() => middleSlot(volume)`) is a function
called before every read and decode, so moving the focus reorders the
remaining work. At most `readAhead` units, defaulting to the runtime's
`readConcurrency`, are being read or waiting to decode, and at most
`decodeConcurrency` decode at once. Aborting `signal`, leaving the loop or
disposing the runtime ends the iteration without throwing.

## Decoders

A `PixelDecoder` has a `name` and a `plan(instance, target)` that, from the
header alone, returns the `DecodeUnit`s it would load the instance in, or
`{ declined: reason }`. A unit covers consecutive frames: `firstFrame`,
`frames`, the byte `range` of the source to read (null for the whole source)
and `decode(bytes, signal)`, which returns `DecodedPixels`. `bytes` may view a
buffer other units share, so a decoder transfers it only when it spans its
whole buffer. A decoder's units
must cover the instance's frames exactly once, in any order; otherwise every
slice of that instance fails with an error naming the decoder. Every unit is
read, decoded, validated and written the same way.

A `DecoderTable` lists candidate decoders per transfer syntax in preference
order, a `fallback` list for unlisted syntaxes, and syntax names for errors.
`planDecode(table, instance, target)` asks each candidate in turn; the first
that does not decline wins. The default table, `defaultDecoderTable(gdcm)`,
tries `nativeFrameDecoder` and then GDCM for Implicit and Explicit VR Little
Endian and Explicit VR Big Endian, sends other known syntaxes and unknown ones
to GDCM, and fails JPIP, video and JPEG XL syntaxes as known syntaxes without
a decoder.

`nativeFrameDecoder` plans one ranged read per frame, located by
`indexFrames(instance)` from the header, and decodes on the calling thread. It
accepts only instances whose result is identical to GDCM's: MONOCHROME2 or
unscaled unsigned 8 bit RGB samples, 8, 16 or 32 bit words with Bits Stored
ending at High Bit (fewer stored bits only in 16 bit words), big endian only
for 16 bit words, one modality rescale for all frames, and no overlay, curve,
Modality LUT, palette or ICC data. GDCM plans the whole instance as one unit.
Both apply one modality transform to the entire instance and decline, from the
header, an instance whose frames differ in slope or intercept. The transform
comes from the Pixel Value Transformation functional group only for the IODs
that define it there (Enhanced and Legacy Converted CT, MR and PET, X-Ray 3D,
breast tomosynthesis and projection, Segmentation), as GDCM reads it; other
SOP classes use the top-level Rescale Slope and Intercept. Once a URL
source shows that its server
ignores Range, the remaining ranged units of that instance come from one read
instead of one download each.

To add a decoder, give the runtime a table that places it:

```ts
const runtime = createDicomRuntime({
  decoders: (gdcm) => {
    const table = defaultDecoderTable(gdcm);
    return {
      ...table,
      byTransferSyntax: new Map(table.byTransferSyntax).set(syntax, [
        myDecoder,
        gdcm,
      ]),
    };
  },
});
```

`decodeConcurrency` bounds a caller-supplied decoder's decodes within one
`loadVolume`, not across volumes; a decoder that needs a global limit owns its
own pool.

`wholeInstanceDecoder(name, decode)` makes a decoder that reads each instance
whole and passes its bytes to `decode`; `singleDecoderTable(decoder)` sends
every instance to one decoder. `splitEncapsulatedFrames(value, frameCount)`
cuts an encapsulated Pixel Data value into frames by its Basic Offset Table
(whose first entry must be 0), by one fragment per frame when the counts
match, or else at JPEG End Of Image markers, optionally followed by one zero
pad byte.

## Runtime

`createDicomRuntime(options)` owns the request pool (`requestConcurrency`,
default 24, exposed as `readConcurrency`; it bounds requests waiting for their
response headers, not bodies being read), two metadata parser workers
(`metadataWorkerFactory` for another asset layout; its worker exposes
`readPublicDataset`) and the GDCM decoder, which runs at most `decodeConcurrency`
workers at once (default half the cores, at most four; each worker carries its
own WASM heap) and terminates a worker whose decode is aborted. `assets`
locates the ITK pipeline worker and the GDCM image reader; reading headers
needs neither, and `itk-wasm` itself loads on the first GDCM decode.
`decoders` builds the decoder table around the GDCM decoder.
`dispose()` aborts everything pending and its `signal`.

## vtk adapter

`toVtkImageData(volume)` wraps the volume's buffer and geometry without
copying; before any slice decodes its scalar range is a 0 to 255 placeholder.
`applyVolumeUpdate(image, update)` widens the scalar range by a decoded unit
and marks the image modified. `sliceThumbnail(image, slice)` downsamples one
slice to at most 256 pixels on its longer side and windows it to an 8 bit
greyscale `ThumbnailSlice` on the loaded range, or on the slice's own
luminance for color. `encodeThumbnailToUri` turns a thumbnail into a PNG data
URI.

## Byte streaming

`StreamingByteReader` is the byte reader under the header parser; VolView
also uses it to sniff file types.

## Geometry and calibration

Enhanced instances read image geometry and modality transforms from their
shared and per-frame functional groups. Regular spatial frames retain their
stored pixel order, including acquisitions whose frame direction opposes the
row and column cross product. Single-detector reconstructed NM stacks use
their detector patient geometry and signed slice spacing. Gated NM requires
temporal assembly and is rejected.

OCT shared in-plane spacing is preserved. Calibrated placement between
B-scans requires a matching ophthalmic localizer and remains unsupported.
Optical slice thickness does not define B-scan separation. Vendor-specific
ultrasound volume calibration, RT dose semantics and floating-point parametric
maps also require dedicated import support.

`volume.spatialMetadata` reports the applied spacing in image x, y, z order,
including ultrasound region overrides (`unitToMm` converts region units).
Each axis records its value, unit (`mm` or `unknown`), source, and whether it
was declared, derived from positions, or supplied as a display fallback
(`physicalSpacing` and `fallbackSpacing` build those records). Reconstruction
quality and ultrasound region limitations are separate from the unit. These
are statements about the source and allocation, not independent calibration.

Missing physical spacing is permitted for some DICOM objects, including
[secondary captures](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_A.8.html).
Ordinary patient PixelSpacing and ImagePositionPatient use millimeters
without an additional calibration tag. A fallback value of 1 does not
establish a millimeter scale. A singleton axis does not establish a distance
between slices.

## Browser test pages

`tests/fixtures/dicom-pages` holds small pages that use this module
without VolView startup. `server.mjs` builds them with Vite straight from
this source, beside the ITK pipeline worker and GDCM image reader assets from
`node_modules`. A page build fails if it pulls in VolView application code,
Vue or Pinia, and the core page also fails on vtk.js.

- `dicom-module-pages.e2e.ts` generates DICOM in memory and checks Blob and
  HTTP metadata, calibrated pixel values, decode worker recovery and vtk
  geometry through rendered page output, including a screenshot.
- `dicom-volume-corpus.e2e.ts` loads pinned public CT, MR and SPECT files
  through File and HTTP sources, plus numeric-padding fixtures, and checks
  dimensions, physical geometry, explicit unsupported-topology errors and the
  hash of every calibrated voxel. One multiframe file is also read from a
  route that ignores Range. Inputs, checksums, independently decoded hashes
  and provenance are in `tests/dicomVolumeCorpus.json`;
  `volumeCorpusReference.py` beside the pages checks dimensions, ranges and
  hashes with pydicom and NumPy.
- `dicom-native-parity.e2e.ts` decodes synthesized instances across the native
  format matrix and a sample of cached public files through GDCM and frame by
  frame natively, over HTTP. Wherever the table plans native
  frames, both must write identical samples, which for a fractional rescale
  means equal after the same float32 rounding.
- `dicom-volume-composition.e2e.ts` composes downloaded classic CT and PET
  series and two MR acquisitions sharing one Series UID, and checks every
  collection's ordered SOP membership, calibrated voxel hash and physical
  geometry after a shuffled batch import from Files and a shuffled incremental
  import over HTTP. `tests/dicomCompositionCorpus.json` records the inputs and
  expectations; `compositionReference.py` beside the pages checks them with
  pydicom and NumPy.
- `dicom-frame-reconstruction.e2e.ts` checks multiframe reconstruction.
