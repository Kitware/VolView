# Segmentation

A segment is shared identity and appearance. A segmentation contains one
image's masks and display settings. Each segment has at most one mask on an
image; the mask's bounded labelmap is allocated only when needed.

## Module ownership

- `segment.ts`, `model.ts`, `geometry.ts`, and `color.ts` define the model and
  calculations. They do not depend on stores or components.
- `segments.ts` and `segmentRegistry.ts` own shared identity, selection, and
  appearance. Stores holding masks or annotation tools declare their segment
  references on the registry, which hands them the removal. Removing the last
  image deletes every segment no config entry holds.
- `deleteSegment.ts` guards locked segments before deleting their masks and
  shapes.
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
edit cancels the preview before writing. Save and export also cancel an
unconfirmed preview and read committed content, as does job input staging when
the task has a labelmap to stage; a task with no labelmap input leaves the
preview standing. Applying a process commits its result, even when the original
is selected in the preview.

An algorithm may modify its detached input buffer and return it. Cancellation
uses a separate original snapshot. Resolved storage stays with the process
manager and is checked again after asynchronous computation.

Mask creation refuses missing segment identities and duplicate image/segment
pairs. Attachment accepts prepared storage only for an unbound mask. Readers
must distinguish an existing mask record from allocated voxel storage.

An erase never shrinks a mask's allocation, so an edit that leaves a mask
holding no voxel deletes that mask when the edit ends: a paint or erase stroke,
a polygon fill, or an applied process. The segment stays.

## Ordering and overlap

Registry order controls the sidebar, shortcuts, selection and picking, and on
export each mask's label value and the file it lands in. It does not control
what is drawn on top: overlapping segments blend in the slice view, and moving
one above another leaves the overlap looking the same. Per-image mask order
preserves insertion and restored file order.

Aimed writes, such as paint and polygon fills, clear unlocked neighbors and
preserve locked neighbors. With the Paint panel's Allow Overlap switch on, which
is never saved, aimed writes leave every neighbor alone and may overlap them.
Processes preserve voxels already held by other segments. Import matches
existing segment identities by exact name, sharing appearance and locks across
images, unless that segment already has a mask on the importing image, in which
case the import takes a new segment with a numbered name. Restore matches the
segments a file lists by exact name too, but joins an existing segment only
while it holds no mask or shape on any image, and gives it the session's
appearance; otherwise the restored segment takes a numbered name. Label values
no listed mask reads bind as import does, except that a migrated group carrying
display of its own always takes new segments.

## Labelmap interchange

Composed labelmaps use unsigned 8-bit voxels for up to 255 labels and unsigned
16-bit voxels for 256 through 65535 labels. Zero is background. Imported
16-bit labels are preserved until they are split into independent binary masks;
editable masks and their saved-session files remain byte-sized.

A described label value the voxels never carry still becomes a segment, whose
mask covers nothing. A file header and a processing result's segment list are
read alike here: a bin declared and left empty is shown, so finding nothing
reads differently from never looking. Across the components of one labelmap a
declaration is one segment on either path: a value some component carried is
that component's segment, never an empty twin beside it.

Export packs whole masks into separate files when they overlap. A part beyond
65535 labels is split at that capacity. The export plan records these reasons
separately, so capacity splitting is not reported as overlap.

Processing inputs declaring multiple files receive every mask in overlap-free
parts. A single-file input starts with the selected segment when this image
has a mask for it, otherwise with the first mask in registry order, then
greedily adds whole non-overlapping masks in registry order up to the label
capacity.
Conflicting masks are omitted entirely and named in a warning beside the input.
No mask is clipped to fit. Export and processing capture pixels, geometry, and
appearance before asynchronous serialization so all parts describe the same
state.
