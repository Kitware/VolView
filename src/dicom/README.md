# Browser DICOM module

Reads DICOM instances from Blobs or URLs, groups them into collections and
loads calibrated pixel volumes in the browser. It is a directory of VolView
source, not a separate package; callers import each name from the file that
defines it.

## Layout

| Directory          | Holds                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| `core/source`      | byte sources for Blobs and URLs, HTTP range handling                     |
| `core/header`      | the streaming reader that finds Pixel Data and the header parser over it |
| `core/metadata`    | datasets, tags, functional groups, rescale, spacing, ultrasound regions  |
| `core/instance`    | `readInstance`                                                           |
| `core/collections` | header facts, collection planning and the registry                       |
| `core/volume`      | allocation, pixel formats, validation and `loadVolume`                   |
| `core/pixels`      | decoders, the decoder table, frame index, encapsulated frames            |
| `core/runtime`     | the runtime, its request pool, metadata workers and codec decoders       |
| `vtk`              | the vtk.js image and slice thumbnails                                    |

`core` uses no Vue, Pinia, vtk.js, itk-wasm or VolView application code.
`vtk` shows a core `Volume` as a `vtkImageData`. `eslint.config.js` enforces
both boundaries.

## Invariants

- Instances, collection updates and volumes are plain values. Only the
  runtime from `createDicomRuntime` holds resources (request pool, metadata
  workers and codec workers), and only it has `dispose()`. Importing a file
  starts no worker and touches no DOM.
- Every asynchronous operation takes an `AbortSignal`; aborting it is the
  whole of cancellation.
- A `ByteSource` opens a fresh stream per read and holds nothing between
  reads. Instances keep no bytes; read the source again for them.
- `readInstance` stops reading at Pixel Data, or after Modality for
  radiotherapy objects. The dataset omits private elements.
- `registerInstances` is a pure reducer: abandoning an import is not
  assigning the returned state. The first registration of a SOP Instance UID
  is kept.
- In a multi-file volume member i fills slice i. An irregular stack keeps its
  planned order, spaced by its mean gap so its extent is kept, and is not
  resampled.
- The buffer type comes from the headers' rescaled value ranges. Ranges that
  fit 8 or 16 bit integers keep that integer type. Wider integer ranges and
  fractional rescales use Float32 where it holds every value exactly, else
  Int32, Uint32 or Float64. Decoded values the buffer would round or not hold
  are rejected.
- `loadVolume` writes each decoded unit at once and marks its slices loaded
  only when it yields the update. Units load focus first, then coarse to
  fine. A failed unit yields an error update naming the file and loading
  goes on. Stopping ends the iteration without throwing and writes nothing
  more.
- At most `readConcurrency` units are being read or waiting to decode, and at
  most `decodeConcurrency` decode at once, per volume.
- A URL source whose server ignores Range has its remaining ranged units read
  in one request.
- Decoders keep MONOCHROME1 stored values; displays invert them.
- Each transfer syntax in the decoder table has one decoder, chosen from the
  header alone. Uncompressed frames are each read by their own range. RLE,
  JPEG, JPEG-LS, JPEG 2000 and HTJ2K instances are read from their Pixel Data
  value and decoded whole on the shared codec workers, each codec's WASM
  loading on first use. A Deflated file is read whole and inflated on the
  calling thread. JPIP, video and JPEG XL syntaxes, and any syntax the table
  does not list, fail as having no decoder.
- A data set with no file meta information is read in the transfer syntax
  its first element suggests.
- Every decoder finishes its samples the same way. Grayscale takes each
  frame's own Pixel Value Transformation. Color is held as RGB and takes no
  rescale: YBR_FULL and YBR_FULL_422 are converted, and PALETTE COLOR values
  are looked up, segmented tables included, with 8 bit pixels taking the
  high byte of a 16 bit entry. The JPEG codec converts the YBR it holds, and
  the JPEG 2000 and HTJ2K codecs undo YBR_RCT and YBR_ICT.
- 16 and 32 bit words are masked to Bits Stored and sign extended from it.
  An 8 bit word keeps all its bits, and High Bit is not consulted. Samples
  of 1 or 12 bits allocated are packed across bytes, and big endian 8 bit
  samples are paired into 16 bit words, so instances whose frames share a
  byte or a word are read whole. One sample per pixel with any photometric
  interpretation but PALETTE COLOR is grayscale.
- The Modality LUT Sequence, overlay planes and ICC profiles are not
  applied.
- A codestream of 8 bits or fewer is widened where the header allocates 16.
  A JPEG 2000 or HTJ2K codestream holding more bits than Bits Stored keeps
  them; other codestreams are masked to Bits Stored.
- A JPEG frame the header calls RGB is decoded without a color transform
  unless its own JFIF or Adobe segment states one. A JPEG stream of more
  than 8 bits is decoded by a separate 12 bit build of the codec.

## Spacing

Missing physical spacing is permitted for some DICOM objects, such as
secondary captures. A fallback spacing of 1 does not establish a millimeter
scale, and a singleton axis does not establish a distance between slices.
Calibrated placement between OCT B-scans, vendor ultrasound volume
calibration, RT dose semantics and gated NM are not supported.

## Tests

Module unit tests sit in `__tests__` beside the code. Browser pages in
`tests/fixtures/dicom-pages` exercise the module without VolView startup;
the `dicom-*.e2e.ts` specs drive them against generated instances and pinned
public corpora described in `tests/dicomVolumeCorpus.json` and
`tests/dicomCompositionCorpus.json`.
