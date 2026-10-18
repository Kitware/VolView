#!/usr/bin/env python3
"""Build the PET/CT sample from original public TCIA DICOM instances.

Requires pydicom. Run from any directory; downloads are cached outside the
repository by default. Every cached or downloaded file must match its SHA-256.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import tempfile
from urllib.parse import urlencode
from urllib.request import urlopen

import pydicom

SOURCES = json.loads(Path(__file__).with_name('pet-ct-sources.json').read_text())
API = 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage'
STUDY = '1.3.6.1.4.1.14519.5.2.1.6655.2359.853320292336090422808460060188'
README = """# PET/CT chest sample

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
"""


def source_url(source):
    return API + '?' + urlencode({
        'SeriesInstanceUID': source['series'],
        'SOPInstanceUID': source['sop'],
    })


def fetch(source, cache):
    path = cache / source['path']
    if path.exists():
        data = path.read_bytes()
    else:
        with urlopen(source_url(source), timeout=90) as response:
            data = response.read()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    if hashlib.sha256(data).hexdigest() != source['sha256']:
        raise ValueError(f"SHA-256 mismatch: {source['path']}")
    return data


def validate(payloads):
    datasets = [pydicom.dcmread(io.BytesIO(data)) for data in payloads]
    if {str(ds.StudyInstanceUID) for ds in datasets} != {STUDY}:
        raise ValueError('Unexpected study')
    if len({str(ds.FrameOfReferenceUID) for ds in datasets}) != 1:
        raise ValueError('Frames of reference differ')
    if {tuple(float(v) for v in ds.ImageOrientationPatient) for ds in datasets} != {(1, 0, 0, 0, 1, 0)}:
        raise ValueError('Unexpected orientation')
    for source, ds in zip(SOURCES, datasets):
        if (str(ds.SOPInstanceUID), str(ds.SeriesInstanceUID), str(ds.Modality),
            int(ds.InstanceNumber), float(ds.ImagePositionPatient[2]), str(ds.PatientID)) != (
            source['sop'], source['series'], source['modality'], source['instance'],
            source['z'], 'Lung_Dx-A0171'):
            raise ValueError(f"Unexpected metadata: {source['path']}")
    for modality, size, spacing in [('CT', 512, 1), ('PT', 200, 3)]:
        series = [ds for ds in datasets if ds.Modality == modality]
        positions = [float(ds.ImagePositionPatient[2]) for ds in series]
        if len(series) != 10 or any(ds.Rows != size or ds.Columns != size for ds in series):
            raise ValueError(f'Unexpected dimensions: {modality}')
        if any(abs(b - a - spacing) > 1e-6 for a, b in zip(positions, positions[1:])):
            raise ValueError(f'Noncontiguous slices: {modality}')
        if len({tuple(float(v) for v in ds.PixelSpacing) for ds in series}) != 1:
            raise ValueError(f'Inconsistent pixel spacing: {modality}')
        if len({tuple(float(v) for v in ds.ImagePositionPatient[:2]) for ds in series}) != 1:
            raise ValueError(f'Inconsistent in-plane origin: {modality}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=Path, default=Path(tempfile.gettempdir()) / 'pet-ct-official')
    parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parents[2] / '.tmp' / 'samples')
    args = parser.parse_args()
    with ThreadPoolExecutor(max_workers=4) as pool:
        payloads = list(pool.map(lambda source: fetch(source, args.cache_dir), SOURCES))
    validate(payloads)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for source, data in zip(SOURCES, payloads):
        output = args.output_dir / source['path']
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
    (args.output_dir / 'PET-CT-chest-10-slices.README.md').write_text(README)
    print(f'{args.output_dir}: {sum(len(data) for data in payloads)} DICOM bytes')


if __name__ == '__main__':
    main()
