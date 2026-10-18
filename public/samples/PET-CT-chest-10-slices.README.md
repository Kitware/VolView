# PET/CT chest sample

This sample loads ten contiguous original CT instances and ten
contiguous original PET instances from public TCIA subject `Lung_Dx-A0171`, collection
[Lung-PET-CT-Dx](https://www.cancerimagingarchive.net/collection/lung-pet-ct-dx/).
The browser downloads 6.1 MB of original DICOM data directly from NBIA. The
DICOM file bytes, metadata, and acquired pixel grids are unchanged. This is a
partial study.

The CT series is `CT WB  1.0  B30f` (512 x 512, 1 mm slice spacing), and the PET
series is `PET WB Corrected` (200 x 200, 3 mm slice spacing). Their slice-center
ranges are -373 through -364 mm and -383 through -356 mm, respectively. They
share a study and frame of reference. The initial axial view is at -368 mm,
with PET over CT in their native patient coordinates. The slabs have different
physical thicknesses; alignment applies to the overlapping region. Pixel
values have not been converted to SUV.

The initial PET display uses the DICOM Hot Iron palette, image values 0 to 8000, 45%
opacity, and transparent background with a short fade above the minimum.

## Attribution and license

Li, P., Wang, S., Li, T., Lu, J., HuangFu, Y., & Wang, D. (2020).
A Large-Scale CT and PET/CT Dataset for Lung Cancer Diagnosis (Lung-PET-CT-Dx)
[Data set]. The Cancer Imaging Archive.
https://doi.org/10.7937/TCIA.2020.NNC2-0461

The source DICOM images are licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
The collection page and NBIA series metadata identify this license. Preserve
this attribution and license link when redistributing this subset.

## Reproduction

Install `pydicom`, then run `python scripts/samples/create-pet-ct-sample.py`.
The script downloads the twenty selected original DICOM instances directly
from the public NBIA `getSingleImage` API, checks their pinned SHA-256 hashes,
and validates their study, frame of reference, orientation, pixel dimensions,
and consecutive slice positions. `--cache-dir` selects a download cache and
`--output-dir` selects the destination for the original DICOM files and this README.
The default destination is the ignored `.tmp/samples` directory.

The pinned records in `scripts/samples/pet-ct-sources.json` contain every SOP
Instance UID, series UID, original instance number, slice coordinate, byte
count, and SHA-256 hash. The sample data entry lists the twenty public source URLs. Reproduction
verifies the source hashes; opening the sample downloads those URLs and loads
them together as ordinary DICOM files. The application sets the initial CT
view and PET overlay display.

CT Series Instance UID:
`1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885`

PET Series Instance UID:
`1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839`

NBIA API documentation:
https://wiki.cancerimagingarchive.net/display/Public/NBIA+Search+REST+API+Guide
