# Segmentation

Each image owns one segment set: its segment definitions, their order, the
selection, the display settings, and each segment's mask. Paint, rectangles,
polygons and rulers share the definitions. Masks are keyed by segment id; a
segment has no mask until its voxels are allocated, and at most one.

## Module ownership

- `segment.ts`, `model.ts`, `geometry.ts`, and `color.ts` define the model and
  calculations. They do not depend on stores or components.
- `segments.ts` and `segmentRegistry.ts` own the image sets: identity,
  selection, appearance, and through `imageStorage.ts` the masks and display
  stored with them. Shape stores register their references for segment
  deletion; a deleted segment takes its mask with it. On image eviction the
  registry drops the image's set with its masks, and each shape store removes
  its own tools. The current config survives.
- `segmentNames.ts` is one image's name index: names are unique per image and
  stored trimmed, and a taken name gets a numbered one. `segmentConfig.ts`
  reads config entries and holds the palette. Both are pure; the registry keeps
  their per-image state and the config template.
- `deleteSegment.ts` guards locked segments before deleting their masks and
  shapes.
- `store.ts` holds the voxel operations over those masks, addressed by segment
  id: allocation, access, edit targets and cleanup of masks an edit emptied.
- `masks/` contains allocation, growth, overlap operations, and voxel access.
- `editing/` coordinates previews and edits. Algorithms receive detached
  scalar buffers and geometry; only the process manager writes results back.
- `io/` imports labelmaps, saves and restores state, and builds interchange
  files. Composition is transient; exported label values are not segment
  identity.
- `rendering/` adapts masks and appearance to VTK. Each slice view writes
  the masks on its slice into shared label planes, one more plane per
  level of overlap, and colors labels through lookup tables, which also hide
  hidden segments. Render planes and their labels do not change stored or
  exported data.
- `components/` and `composables/` present the feature. General annotation
  tools, shared controls, and application state-file orchestration remain
  outside this directory.

Import the module that owns an operation directly. The lint configuration
prevents the model, geometry, mask calculations, and algorithms from importing
stores or upper feature modules.

## Editing and persistence

The registry holds the config as a template. An image's set is created, from
the template, the first time the image is shown or anything is added to it, or
empty without a config. It never depends on which image was shown before it.
"Copy segments from..." adds another image's definitions that the current image
lacks by name, without masks or shapes.

A restored image takes its saved set, then the template applies to it like a
newly loaded configuration, so the result does not depend on whether the config
came before, with or after the session. A restored image without a saved set
follows the template on first activation or edit. Anything arriving for an image that
already has a set merges into it by name, including restored sets, matched
segmentation labels and configurations. A configuration writes its stated
fields onto every set's same-named segments, adds missing names, and replaces
the template. It never removes or resets anything.

Manifest 8.0.0 saves one entry per image set: its selection, its display
settings and its segments in order, each with its mask. A saved segment id
means something only on its image: restore hands tools, en face views and masks
a resolver from image and saved id to the restored segment. Each mask's archive
entry is named at save from its image and segment names. It saves no starting
segments for images without a set. Migration from 7.0.0 copies the shared
catalog under every saved image with its original ids, moves each mask onto
its segment and each segmentation's display onto its image, and reports masks
an older segmentation left out of its order. When several saved images resolve
to one, their segments seat as one set: a saved id seen again is the segment
it already made.
Open saved sessions with a build that supports their manifest version; earlier
builds cannot preserve the image ownership recorded in 8.0.0.

Process previews temporarily occupy live mask storage. Starting a competing
edit cancels the preview before writing. Save and export also cancel an
unconfirmed preview and read committed content, as does job input staging when
the task has a labelmap to stage; a task with no labelmap input leaves the
preview standing. Applying a process commits its result, even when the original
is selected in the preview.

An algorithm may modify its detached input buffer and return it. Cancellation
uses a separate original snapshot. Resolved storage stays with the process
manager and is checked again after asynchronous computation.

Mask allocation refuses a missing segment and a segment that already has a
mask. Outside an edit in progress, a mask holds at least one voxel: a segment
with nothing in it has no mask, so readers ask whether a mask exists.

An erase never shrinks a mask's allocation, so an edit that leaves a mask
holding no voxel deletes that mask when the edit ends: a paint or erase stroke,
a polygon fill, or an applied process. The segment stays.

## Ordering and overlap

Each image's segment order controls its sidebar, shortcuts, selection, picking,
export label values and file grouping, and every walk over its masks. Overlapping
segments blend in the slice view regardless of order.

Aimed writes, such as paint and polygon fills, clear unlocked neighbors and
preserve locked neighbors. With the Paint panel's Allow Overlap switch on, which
is never saved, aimed writes leave every neighbor alone and may overlap them.
Processes preserve voxels already held by other segments.

Everything arriving for an image is seated by name through the registry's
`seatSegment`. A definition without a mask (config, copy, processing shapes)
joins the segment of that name. One that brings a mask (labelmap import)
joins it only if it has no mask, else it is minted under a numbered name. The
caller says whose appearance wins: config writes its own, import, copy and
processing shapes keep the existing one.

Restore follows the same rule through `adopt`, with two differences. A segment
that already has a mask or shapes keeps its appearance, and a restored segment
that brings a mask is numbered instead of joining it, so shapes already drawn
never change color or gain voxels. Two saved segments of one name on one image
stay two segments.

## Labelmap interchange

Composed labelmaps use unsigned 8-bit voxels for up to 255 labels and unsigned
16-bit voxels for 256 through 65535 labels. Zero is background. Imported
16-bit labels are preserved until they are split into independent binary masks;
editable masks and their saved-session files remain byte-sized.

A described label value the voxels never carry still becomes a segment, without
a mask. A file header and a processing result's segment list are
read alike here: a bin declared and left empty is shown, so finding nothing
reads differently from never looking. Across the components of one labelmap a
declaration is one segment on either path: a value some component carried is
that component's segment, never an empty twin beside it. Export and processing
inputs walk masks, so they carry no such segment.

Export packs whole masks into separate files when they overlap. A part beyond
65535 labels is split at that capacity. The export plan records these reasons
separately, so capacity splitting is not reported as overlap.

Processing inputs declaring multiple files receive every mask in overlap-free
parts. A single-file input starts with the selected segment when it has a mask,
otherwise with the first mask in registry order, then
greedily adds whole non-overlapping masks in registry order up to the label
capacity.
Conflicting masks are omitted entirely and named in a warning beside the input.
No mask is clipped to fit. Export and processing capture pixels, geometry, and
appearance before asynchronous serialization so all parts describe the same
state.
