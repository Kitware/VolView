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
| `core/runtime`     | the runtime, its request pool, metadata workers and GDCM decoder         |
| `vtk`              | the vtk.js image and slice thumbnails                                    |

`core` uses no Vue, Pinia, vtk.js or VolView application code. `vtk` shows a
core `Volume` as a `vtkImageData`.

## Invariants

- Instances, collection updates and volumes are plain values. Only the
  runtime from `createDicomRuntime` holds resources (request pool, metadata
  workers, GDCM workers), and only it has `dispose()`. Importing a file starts
  no worker and touches no DOM.
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
  planned order with approximate spacing and is not resampled.
- The buffer type comes from the headers' rescaled value ranges. Float32 is
  used where it holds every value exactly, since vtk.js converts other types
  to float32 on upload. Decoded values the buffer would round or not hold are
  rejected.
- `loadVolume` writes each decoded unit at once and marks its slices loaded
  only when it yields the update. Units load focus first, then coarse to
  fine. A failed unit yields an error update naming the file and loading
  goes on. Stopping ends the iteration without throwing and writes nothing
  more.
- At most `readConcurrency` units are being read or waiting to decode, and at
  most `decodeConcurrency` decode at once, per volume.
- A URL source whose server ignores Range has its remaining ranged units read
  in one request.
- `nativeFrameDecoder` accepts only instances whose result is identical to
  GDCM's. The default table sends other instances whole to GDCM in a worker,
  and fails JPIP, video and JPEG XL syntaxes as having no decoder.

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
