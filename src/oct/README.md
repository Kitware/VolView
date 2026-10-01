# OCT en face

Implementation worktree: `VolView/oct-en-face`, based on `origin/main`.

Load an ophthalmic OCT DICOM volume, then choose **Retinal OCT** in the
**Layouts** menu. This places the original B-scan above the en face view and
binds both to the active OCT volume. The B-scan orientation follows the scan's
native frame axis. The action stays visible and disabled with a reason when
the current volume is unsuitable. Customer layout presets are preserved.

You can also choose **En face** in an individual viewport's view selector.
The default is a mean projection along the B-scan row axis (Y).
Open the tune button beside the selector to choose a retinal segment and adjust
the thickness threshold with a slider or micrometer entry. **Advanced** holds
maximum/sum projection, inclusive depth slab, and alternate A-line axes.

Use the normal **Window & Level** tool to drag contrast on the en face image.
The standard toolbar controls, reset action, and saved session share the same
per-view windowing settings. Automatic presets use the projected intensities;
projection contrast stays independent of the original OCT slice views.

Keep an OCT slice view above the en face image for a wide B-scan comparison.
Yellow reference lines follow the slices of the same volume as you scroll or scrub the slice slider.
Lines align to the displayed projection's image grid; slices parallel to the
projection plane have no line intersection. Hidden and unrelated views do not
contribute reference lines.

The thickness controls list masks associated with that volume. Choose a
segment and enable **Highlight thin regions**. A translucent overlay in the
selected segment's color marks nonzero occupied segment thickness strictly
below the threshold in micrometers. The source slice and projection share the
segment's visibility and fill appearance. Thickness counts all selected-mask
voxels on the full A-line, independent of the
intensity slab. Disconnected pieces contribute their occupied thickness;
empty space between pieces does not contribute. An absent mask pixel is
excluded rather than treated as a zero-thickness abnormality.

## Geometry and detection

Ophthalmic Tomography and Ophthalmic OCT B-scan Volume Analysis SOP classes,
or OPT modality, activate this feature. Existing OCT en face images are
excluded from volume projection. Modality OCT alone describes
non-ophthalmic imaging and does not activate retinal features.

Enhanced DICOM shared/per-frame Pixel Measures, Plane Orientation, and Plane
Position metadata are promoted into the grid metadata used by VolView.
Declared frame counts, spacing, orthonormal directions, and uniform B-scan
positions are checked. Raster/cube volumes are supported; scans marked
unsuitable for volumetric processing and explicitly radial, circular, or
other non-raster patterns keep En face visible and disabled with a reason.
This module expects a reconstructed grid and does not unwrap raw polar scans.

Physical thickness requires declared spacing on the chosen axis and a mask
aligned to the parent grid. Missing calibration disables thickness controls;
it does not invent a physical size from the loader's default spacing. The
projection can still render in sample coordinates. OCT coordinates and
measurements follow the input's nominal geometry.

## Ownership and persistence

- `detection.ts`, `dicomMetadata.ts`, `types.ts`, and `projection.ts` own
  metadata interpretation and framework-independent calculations.
- `projection.worker.ts` runs projection with Comlink. Superseded jobs are
  terminated and source scalar buffers remain intact.
- `availability.ts` checks the current image and loading state.
- `store.ts` holds settings per viewport and image and uses existing
  view-config serialization. Selected segments are remapped on session load.
  Unresolved or removed selections disable highlighting.
- `EnFaceViewer.vue` and `EnFaceControls.vue` own canvas rendering and controls.
  Threshold and contrast changes repaint cached projection data.
- `useEnFaceSliceLines.ts` projects visible peer slice planes through the existing
  reference-line geometry; slice changes update the SVG overlay without reprojecting.
- En face uses the standard windowing store and toolbar rather than separate
  OCT contrast fields.
- External code imports only `@/src/oct`. ESLint enforces the feature boundary.

The projection viewport supports its own rendering controls. Slice annotation,
paint, crosshairs, crop, and pan/zoom tools remain visible and disabled there. Existing slice views remain available for editing masks.
This feature uses VolView's associated voxel masks; it does not add proprietary
OCT readers, retinal boundary extraction, or DICOM Surface/Height Map
Segmentation import.

## Verification

The public retinal fixture, attribution, conversion script, and independent
NumPy references are documented in
[the fixture README](../../tests/fixtures/oct/README.md).
The pixels come from a real Topcon volume under CC BY 4.0; its DICOM encoding
is derived for testing. Its two segmentation bands are synthetic.

From this worktree:

```sh
npm ci
npx vitest run src/oct src/store/tools/__tests__/enFaceCapabilities.spec.ts
npm run build
HEADED=1 npx wdio run ./wdio.chrome.conf.ts --spec tests/specs/oct-en-face.e2e.ts
```

Browser tests load the fixture through the normal importer, compare rendered
projection pixels to independent references, exercise thresholds and segment
selection, standard windowing interactions, and slice-line navigation, and restore
settings from a saved session.
