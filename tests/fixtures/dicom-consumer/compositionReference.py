"""Check composed-volume expectations using pydicom and NumPy, independently of VolView.

First download the fixtures with node tests/downloadDatasets.ts. This optional
reference check requires pydicom, NumPy and a JPEG Lossless plugin such as
pylibjpeg-libjpeg. It reads cached inputs and never creates binary fixtures.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pydicom


def reference(items):
    first = items[0]
    axes = np.array(first.ImageOrientationPatient, dtype=np.float64).reshape(2, 3)
    axes /= np.linalg.norm(axes, axis=1)[:, None]
    normal = np.cross(*axes)
    ordered = sorted(items, key=lambda ds: np.dot(ds.ImagePositionPatient, normal))
    positions = np.array([ds.ImagePositionPatient for ds in ordered], dtype=np.float64)
    projected = positions @ normal
    gaps = np.diff(projected)
    step = float(np.median(gaps))
    assert step > 0 and np.allclose(gaps, step, atol=1e-4, rtol=0)
    assert np.allclose(positions, positions[0] + np.outer(projected - projected[0], normal), atol=1e-4, rtol=0)
    assert len({str(ds.SeriesInstanceUID) for ds in ordered}) == 1
    assert len({str(ds.AcquisitionNumber) for ds in ordered}) == 1
    for ds in ordered:
        assert int(ds.get('NumberOfFrames', 1)) == 1
        assert np.allclose(ds.ImageOrientationPatient, axes.ravel(), atol=1e-6, rtol=0)
        assert np.allclose(ds.PixelSpacing, first.PixelSpacing, atol=1e-6, rtol=0)
    pixels = np.stack([
        ds.pixel_array.astype(np.float64) * float(ds.get('RescaleSlope', 1)) + float(ds.get('RescaleIntercept', 0))
        for ds in ordered
    ]).astype('<f8')
    return {
        'dimensions': [pixels.shape[2], pixels.shape[1], pixels.shape[0]],
        'spacing': [float(first.PixelSpacing[1]), float(first.PixelSpacing[0]), step],
        'origin': positions[0].tolist(),
        'direction': np.concatenate([axes.ravel(), normal]).tolist(),
        'range': [float(pixels.min()), float(pixels.max())],
        'pixelHash': hashlib.sha256(pixels.tobytes()).hexdigest(),
        'firstPlanePosition': positions[0].tolist(),
        'lastPlanePosition': positions[-1].tolist(),
    }, [str(ds.SOPInstanceUID) for ds in ordered]


def main():
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=root / '.tmp/datasets')
    args = parser.parse_args()
    corpus = json.loads((root / 'tests/dicomCompositionCorpus.json').read_text())
    datasets = {entry['name']: entry for entry in corpus['datasets']}
    for case in corpus['cases']:
        for volume in case['volumes']:
            items = []
            for name in volume['files']:
                path = args.cache / name
                assert hashlib.sha256(path.read_bytes()).hexdigest() == datasets[name]['sha256'], name
                ds = pydicom.dcmread(path)
                assert int(ds.AcquisitionNumber) == volume['acquisitionNumber']
                items.append(ds)
            for key, subset in [('expected', items), ('initial', items[::2])]:
                expected, members = reference(subset)
                wanted = volume['sopInstanceUIDs'] if key == 'expected' else volume['sopInstanceUIDs'][::2]
                assert members == wanted, (volume['id'], key, 'membership')
                for field, value in expected.items():
                    saved = volume[key][field]
                    assert value == saved if isinstance(value, str) else np.allclose(value, saved, atol=1e-4, rtol=0), (volume['id'], key, field)
            print(f"Verified {volume['id']}: membership, geometry and complete calibrated voxel hashes")


if __name__ == '__main__':
    main()
