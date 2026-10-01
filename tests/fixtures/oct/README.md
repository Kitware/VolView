# Public retinal OCT fixture

`retina-derived.dcm` contains real OCT pixels derived from **Enting Gao,
“oct-data,” version 2, Figshare (2015)**, DOI
[10.6084/m9.figshare.1409373](https://doi.org/10.6084/m9.figshare.1409373).
The source is [466.fds](https://ndownloader.figshare.com/files/3330704),
135,295,073 bytes, MD5 `7f52cc7f440810e71d4cb038efb13dca`.
The dataset is distributed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
This attribution applies to the derived pixel data. The source file is not
checked in.

The source is a Topcon raster volume, not an original DICOM export. The fixture
uses every fourth voxel in each image axis; it retains the original unsigned
16-bit intensity values and multiplies the physical spacing by four. The
result is 128 columns × 222 A-line depth samples × 32 B-scans, with nominal
spacing 0.046875 × 0.0104 × 0.1875 mm. No source patient names, identifiers, dates,
or other clinical metadata are transferred.

The derived DICOM declares Ophthalmic Tomography Image Storage, modality OPT,
raster B-scan pattern, and nominal spatial geometry. Shared and per-frame
functional groups describe the same geometry as the top-level convenience
tags. It is a test fixture and does not demonstrate an actual device's DICOM
conformance.

`synthetic-thickness.nrrd` is a generated labelmap in the same geometry.
It is **not a clinical segmentation**. All B-scans contain a two-voxel band
(20.8 µm) in columns 0–42 and a four-voxel band (41.6 µm) in columns 43–85.
Columns 86–127 have no samples for this segment. A second label occupies five
depth voxels (52 µm) in every column, providing a distinct nondefault segment
for session selection restoration. The browser tests use those bands to verify
physical thickness, strict thresholding, and exclusion of missing mask data.

`reference.json` contains independent NumPy projections and selected
sample values for comparison with the client output.

To regenerate, install NumPy and pydicom in an isolated Python environment,
then run from the `VolView/oct-en-face` worktree:

```sh
python tests/fixtures/oct/generate.py /tmp/466.fds --download
```

The FDS chunk interpretation matches the image and scan-parameter definitions
in [OCT-Converter](https://github.com/marksgraham/OCT-Converter), an MIT-licensed
reader. The small generator reads only those two chunks.

The [DICOM geometry constraints](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_A.52.4.3.html)
explain that OCT spatial coordinates are nominal and may be deformed.
The [OPT scan-pattern codes](https://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_CID_4272.html)
distinguish raster, radial, circular, and other acquisitions; retinal OCT is
not inherently a polar volume.

Run the Chrome browser coverage from the worktree:

```sh
npm run build
HEADED=1 VOLVIEW_OCT_CAPTURE_DIR="$PWD/.tmp/oct-evidence" \
  npm run test:e2e:chrome:skip-build -- --spec ./tests/specs/oct-en-face.e2e.ts
```

This command uses regular Chrome because native wheel navigation over the
WebGL B-scan fails in Chrome 138's headless mode in this environment. The same
observer-free test passes in regular Chrome. The test uses real WebDriver wheel
input and does not modify event listeners.

The six scenarios compare real browser pixels with the independent projections,
check both thickness controls and session restoration, and exercise the normal
Window & Level toolbar with a real pointer drag. The comparison layout checks
the yellow en face marker against the original B-scan slice index after
keyboard, wheel, and slice-slider navigation. Synthetic labelmap overlays are
hidden in the source B-scan for this comparison; the dedicated en face thickness
overlay still measures the selected synthetic segment.

The optional capture directory receives the real Chrome comparison screenshot
and a saved two-view session. Public images are served locally during tests.
