# Browser DICOM module

This private directory uses VolView's root install, lockfile and checks. It has
no workspace install or release workflow. VolView imports the source entry
points; the root npm distribution includes the core and vtk source files
alongside `dist`, `src` and `backend-contract`. Package tests and standalone build
output are excluded from that distribution.

- `core/index.ts`: Blob and HTTP sources, structured `DicomDataset` metadata,
  normalized facts, collection planning and stable identity, owned loading
  resources, and calibrated typed pixel arrays. It has no Vue, Pinia or vtk.js
  dependency.
- `vtk/index.ts`: `VtkDicomImage`, allocation and validated pixel writes,
  reconstruction policy, ranges, image notifications and vtk cleanup. vtk.js is
  an optional peer, required only by consumers of this entry point.

VolView owns its reactive wrappers, messages, browser state, selections,
annotations, layers, import transactions and session provenance. The
application projects structured metadata into flat tag strings where its
existing consumers need that representation.

## Loading and assets

`npm run dicom:build` emits ES modules and declarations in `packages/dicom/dist`.
It also emits the parser worker and copies the existing ITK pipeline worker and
GDCM image reader assets. Serve the emitted assets from a URL your application
controls, and pass their locations explicitly:

```ts
import { createDicomLoader } from '@volview/dicom/core';

const loader = createDicomLoader({
  assets: {
    pipelineWorkerUrl: new URL(
      './assets/itk-wasm-pipeline.min.worker.js',
      document.baseURI
    ).href,
    imageIOUrl: new URL('./assets/image-io', document.baseURI).href,
  },
});
const chunk = loader.createChunk(file); // Blob, URL, string URL or Fetcher
await chunk.loadMeta();
const dataset = chunk.metadata;
await chunk.loadData();
const { image } = await loader.readDicomImage(
  new File([chunk.dataBlob!], 'instance.dcm')
);
```

The default metadata worker URL is relative to the module and is emitted by
Vite. `metadataWorkerFactory` supplies a worker when a consumer uses another
asset layout. Serve `pipelineWorkerUrl` from the same origin as the application.
`fetch` supports authentication and other request policies;
`requestConcurrency` and `metadataConcurrency` bound their respective pools.
A supplied `decoder` replaces the owned ITK decoder and owns its own resources.
Metadata-only use needs no pixel decoder or WASM assets.

Streaming means metadata-first reads and progressive whole-instance decoding.
It does not mean arbitrary-byte incremental pixel decoding. The default
`imageImportPolicy: 'complete-header'` reads through the header;
`'skip-radiotherapy'` permits the image-import shortcut that returns after the
Modality tag for RT objects.

## Ownership and reconstruction

A loader owns chunks it creates, their requests and its parser/decoder workers.
A supplied Fetcher can belong to only one live chunk; sharing its closeable
stream between chunks is unsupported.
`chunk.stopLoad()` cancels the current read and leaves a retryable state.
`loader.release(chunk)` disposes a chunk; `loader.dispose()` cancels pending
operations and releases all owned resources. These operations settle pending
promises. Disposal drops pixel bytes and active resources but retains parsed
metadata for provenance. Do not release a chunk while another collection still
borrows it. The collection registry borrows chunks and preserves the first
registration of an instance. Its rollback and forget operations do not dispose
chunks. `registry.forget(id)` returns members that are no longer registered so
the owner can release them after removing their consumers.
A registration's `rollback(seriesKeys)` keeps deleted collections forgotten.
When it replays a deletion against restored membership, it returns the removed
members for the owner to release. Restore surviving consumers before releasing
those members, checking `registry.has(chunk)` before disposal. New sources from
the failed batch remain with the caller for retry.

Each decoded pixel array belongs to the caller. The vtk consumer copies pixels
into its own allocation, validates dimensions and representable values, and
rejects stale decode results after reallocation or disposal. It owns and deletes
its vtk images, but borrows its chunks. Dispose the vtk consumer before releasing
its borrowed chunks, then dispose the loader.

```ts
import { createDicomCollectionRegistry } from '@volview/dicom/core';
import { VtkDicomImage } from '@volview/dicom/vtk';

const registry = createDicomCollectionRegistry();
const { updates } = await registry.register(chunks);
const { members, collection } = updates[0];
const volume = new VtkDicomImage({
  readDicomImage: loader.readDicomImage,
  irregularGeometry: 'preserve-order',
});
await volume.setChunks(
  members,
  collection.orientation,
  collection.reconstruction
);
volume.addEventListener('imageChanged', (image) => mapper.setInputData(image));
mapper.setInputData(volume.getVtkImageData());
volume.addEventListener('chunkLoad', () => renderWindow.render());
volume.startLoad();
```

The collection carries reconstruction classification, reason, spacing and member
slots. Supplied slots must start at zero because the first chunk anchors the
image origin; gaps such as `[0, 2]` are allowed.
The default `preserve-order` policy retains the existing approximate
spacing for irregular geometry. Use `reject` to refuse that fallback. Neither
policy resamples a scan. Multiple files containing multi-frame data, Node
support and plugin registration are outside this package's current scope.

## Standalone checks

`npm run dicom:check` builds the package and typechecks and bundles two small
consumers against its emitted JavaScript and declarations. The build rejects
VolView application imports and Vue/Pinia dependencies, and rejects vtk.js in
the core consumer. Package boundary tests also check relative imports and
declared dependencies.

`npm run test:e2e:chrome:skip-build -- --spec tests/specs/dicom-package.e2e.ts`
serves those standalone production bundles, generates its DICOM in memory, and
checks Blob/HTTP metadata, calibrated pixel values and vtk geometry through
rendered page output. It also checks the vtk image's rendered screenshot. The
normal headless browser configuration applies.
