# Segmentation

A segment is shared identity and appearance. A segmentation contains one
image's masks and display settings. Each segment has at most one mask on an
image; the mask's bounded labelmap is allocated only when needed.

## Module ownership

- `segment.ts`, `model.ts`, `geometry.ts`, and `color.ts` define the model and
  calculations. They do not depend on stores or components.
- `segments.ts` and `segmentRegistry.ts` own shared identity, selection, and
  appearance. `segmentReferences.ts` coordinates reference removal across
  masks and annotation tools.
- `store.ts` owns mask identity, attachment, lookup, and lifecycle. Import and
  restore use its operations to create records and attach prepared storage.
- `masks/` contains allocation, growth, overlap operations, and voxel access.
- `editing/` coordinates previews and edits. Algorithms receive detached
  scalar buffers and geometry; only the process manager writes results back.
- `io/` imports labelmaps, restores state, and builds interchange files.
  Composition is transient; exported label values are not segment identity.
- `rendering/` adapts masks and appearance to VTK. Render padding does not
  change stored or exported data.
- `components/` and `composables/` present the feature. General annotation
  tools, shared controls, and application state-file orchestration remain
  outside this directory.

Import the module that owns an operation directly. The lint configuration
prevents the model, geometry, mask calculations, and algorithms from importing
stores or upper feature modules.

## Editing and persistence

Process previews temporarily occupy live mask storage. Starting a competing
edit cancels the preview before writing. Save, export, and job input staging
also cancel an unconfirmed preview and read committed content. Applying a
process commits its result, even when the original is selected in the preview.

An algorithm may modify its detached input buffer and return it. Cancellation
uses a separate original snapshot. Resolved storage stays with the process
manager and is checked again after asynchronous computation.

Mask creation refuses missing segment identities and duplicate image/segment
pairs. Attachment accepts prepared storage only for an unbound mask. Readers
must distinguish an existing mask record from allocated voxel storage.

## Ordering and overlap

Registry order controls the sidebar, shortcuts, rendering depth, and flattened
export precedence. Per-image mask order preserves insertion and restored file
order. Interchange packing uses registry order.

Aimed writes, such as paint and polygon fills, clear unlocked neighbors and
preserve locked neighbors. Processes preserve voxels already held by other
segments. Import matches existing segment identities by exact name, sharing
appearance and locks across images.

## Labelmap interchange

Composed labelmaps use unsigned 8-bit voxels for up to 255 labels and unsigned
16-bit voxels for 256 through 65535 labels. Zero is background. Imported
16-bit labels are preserved until they are split into independent binary masks;
editable masks and their saved-session files remain byte-sized.

Export packs whole masks into separate files when they overlap. A part beyond
65535 labels is split at that capacity. The export plan records these reasons
separately, so capacity splitting is not reported as overlap.

Processing inputs declaring multiple files receive every mask in overlap-free
parts. A single-file input starts with the selected segment, then greedily adds
whole non-overlapping masks in registry order up to the label capacity. Conflicting
masks are omitted entirely and named in a warning beside the input. No mask is
clipped to fit. Export and processing capture pixels, geometry, and appearance
before asynchronous serialization so all parts describe the same state.
