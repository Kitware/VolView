"""Check the volume corpus expectations using pydicom and NumPy, independently of VolView.

First download the fixtures with node tests/downloadDatasets.ts. This optional
reference check requires pydicom, NumPy and decoder plugins for JPEG Lossless,
JPEG-LS and JPEG 2000 such as pylibjpeg-libjpeg and pylibjpeg-openjpeg. It reads
cached inputs and never creates binary fixtures.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pydicom


def frame_groups(ds):
    shared = ds.get('SharedFunctionalGroupsSequence', [None])[0]
    per_frame = ds.get('PerFrameFunctionalGroupsSequence', [])
    return shared, per_frame


def macro(groups, sequence, keyword):
    """The first value of a functional group macro attribute, or None."""
    for group in groups:
        items = group.get(sequence) if group is not None else None
        if items and keyword in items[0]:
            return items[0][keyword].value
    return None


# IODs whose functional groups define Pixel Value Transformation; others keep
# Rescale Slope and Intercept at the root.
FUNCTIONAL_GROUP_RESCALE = {
    '1.2.840.10008.5.1.4.1.1.2.1',  # Enhanced CT
    '1.2.840.10008.5.1.4.1.1.2.2',  # Legacy Converted Enhanced CT
    '1.2.840.10008.5.1.4.1.1.4.1',  # Enhanced MR
    '1.2.840.10008.5.1.4.1.1.4.4',  # Legacy Converted Enhanced MR
    '1.2.840.10008.5.1.4.1.1.130',  # Enhanced PET
    '1.2.840.10008.5.1.4.1.1.128.1',  # Legacy Converted Enhanced PET
    '1.2.840.10008.5.1.4.1.1.13.1.1',  # X-Ray 3D Angiographic
    '1.2.840.10008.5.1.4.1.1.13.1.2',  # X-Ray 3D Craniofacial
    '1.2.840.10008.5.1.4.1.1.13.1.3',  # Breast Tomosynthesis
    '1.2.840.10008.5.1.4.1.1.13.1.4',  # Breast Projection X-Ray For Presentation
    '1.2.840.10008.5.1.4.1.1.13.1.5',  # Breast Projection X-Ray For Processing
    '1.2.840.10008.5.1.4.1.1.66.4',  # Segmentation
}


def rescale(ds, frame):
    """Slope and intercept of one frame: Functional Groups first where the IOD
    defines them there, then the root."""
    shared, per_frame = frame_groups(ds)
    groups = (
        [per_frame[frame] if per_frame else None, shared]
        if str(ds.get('SOPClassUID', '')) in FUNCTIONAL_GROUP_RESCALE
        else []
    )
    slope = macro(groups, 'PixelValueTransformationSequence', 'RescaleSlope')
    intercept = macro(groups, 'PixelValueTransformationSequence', 'RescaleIntercept')
    return (
        float(slope if slope is not None else ds.get('RescaleSlope', 1)),
        float(intercept if intercept is not None else ds.get('RescaleIntercept', 0)),
    )


def calibrated(ds):
    """Modality-rescaled samples as [frame, row, column], in stored frame order."""
    frames = int(ds.get('NumberOfFrames', 1))
    stored = ds.pixel_array.astype(np.float64).reshape(frames, int(ds.Rows), int(ds.Columns))
    return np.stack([
        stored[frame] * slope + intercept
        for frame in range(frames)
        for slope, intercept in [rescale(ds, frame)]
    ]).astype('<f8')


def main():
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=root / '.tmp/datasets')
    args = parser.parse_args()
    corpus = json.loads((root / 'tests/dicomVolumeCorpus.json').read_text())
    for entry in corpus['datasets']:
        path = args.cache / entry['name']
        data = path.read_bytes()
        assert len(data) == entry['bytes'], entry['id']
        assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['id']
        ds = pydicom.dcmread(path)
        assert str(ds.file_meta.TransferSyntaxUID) == entry['transferSyntaxUID'], entry['id']
        assert str(ds.SOPClassUID) == entry['sopClassUID'], entry['id']
        assert str(ds.Modality) == entry['modality'], entry['id']
        if 'expected' not in entry:
            topology = entry['frameTopology']
            assert int(ds.NumberOfFrames) == topology['storedFrames'], entry['id']
            assert int(ds.NumberOfSlices) == topology['slices'], entry['id']
            assert int(ds.NumberOfTimeSlots) == topology['timeSlots'], entry['id']
            print(f"Verified {entry['id']}: frame topology of an unsupported volume")
            continue
        expected = entry['expected']
        pixels = calibrated(ds)
        assert [pixels.shape[2], pixels.shape[1], pixels.shape[0]] == expected['dimensions'], entry['id']
        assert np.allclose([pixels.min(), pixels.max()], expected['range'], atol=1e-8, rtol=0), entry['id']
        assert hashlib.sha256(pixels.tobytes()).hexdigest() == expected['pixelHash'], entry['id']
        print(f"Verified {entry['id']}: dimensions, range and complete calibrated voxel hash")


if __name__ == '__main__':
    main()
