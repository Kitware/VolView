"""Independent expectations for the DICOM corpus manifests.

  uv run corpus_reference.py propose URL --name NAME [--id ID] [--storage float32]
  uv run corpus_reference.py propose --generated NAME
  uv run corpus_reference.py verify [--manifest volume|extended|composition]

Geometry comes from highdicom where it can build a volume. Files it cannot
read (big endian, NM, RT dose, ultrasound, no geometry) are `manual`: their
`derivation` names the tags the geometry comes from and `verify` checks those
tag values against the file. Pixels are checked for every entry.

Downloaded and generated inputs live in the shared cache, `.tmp/datasets`.
Generated files are written by tests/fixtures/dicom-pages/writeGeneratedCorpus.ts.
Run with `uv run python -I` so nothing is imported from the cache directory.
"""
import argparse
import hashlib
import copy
import json
import re
import sys
import urllib.request
from pathlib import Path

import highdicom as hd
import numpy as np
import pydicom
from pydicom.pixels import apply_color_lut
from pydicom.uid import generate_uid

ROOT = Path(__file__).resolve().parents[4]
CACHE = ROOT / '.tmp/datasets'
MANIFESTS = {
    'volume': ROOT / 'tests/dicomVolumeCorpus.json',
    'extended': ROOT / 'tests/dicomExtendedCorpus.json',
    'composition': ROOT / 'tests/dicomCompositionCorpus.json',
}
TOLERANCE = 1e-4
STATS_TOLERANCE = 2.0

LOSSLESS_SYNTAXES = {
    '1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.1.99',
    '1.2.840.10008.1.2.2', '1.2.840.10008.1.2.5', '1.2.840.10008.1.2.4.57',
    '1.2.840.10008.1.2.4.70', '1.2.840.10008.1.2.4.80', '1.2.840.10008.1.2.4.90',
    '1.2.840.10008.1.2.4.201', '1.2.840.10008.1.2.4.202',
}
# Frame Time, Frame Time Vector, and NM Time Slice Vector (dynamic acquisitions).
FRAME_TIME_POINTERS = {'00181063', '00181065', '00540100'}
TEMPORAL_INDEX = 0x00209128


# ---- tags ------------------------------------------------------------------

def tag_hex(tag):
    return f'{int(tag):08X}'


def functional(ds, sequence, keyword):
    """Where a functional group attribute lives: perFrame, shared, root or None."""
    for where, groups in (('perFrame', ds.get('PerFrameFunctionalGroupsSequence', [])[:1]),
                          ('shared', ds.get('SharedFunctionalGroupsSequence', []))):
        for group in groups:
            items = group.get(sequence)
            if items and _filled(items[0], keyword):
                return where
    return 'root' if _filled(ds, keyword) else None


def _filled(ds, keyword):
    return keyword in ds and ds[keyword].value not in (None, '', [])


def frame_tags(ds):
    pointer = ds.get('FrameIncrementPointer')
    pointers = [] if pointer is None else [tag_hex(p) for p in (pointer if isinstance(pointer, pydicom.multival.MultiValue) else [pointer])]
    return {
        'numberOfFrames': int(ds.get('NumberOfFrames', 1)),
        'frameIncrementPointer': pointers,
        'numberOfSlices': int(ds.NumberOfSlices) if 'NumberOfSlices' in ds else None,
        'numberOfTimeSlots': int(ds.NumberOfTimeSlots) if 'NumberOfTimeSlots' in ds else None,
        'temporalDimension': any(int(item.DimensionIndexPointer) == TEMPORAL_INDEX
                                 for item in ds.get('DimensionIndexSequence', [])),
    }


def frame_axis(frames):
    """What successive frames step through, by the tags, not by VolView's routing."""
    timed = ((frames['numberOfTimeSlots'] or 1) > 1 or frames['temporalDimension']
             or bool(FRAME_TIME_POINTERS & set(frames['frameIncrementPointer'])))
    if timed and (frames['numberOfSlices'] or 1) > 1:
        return 'mixed'
    return 'time' if timed else 'space'


def geometry_tags(ds):
    slice_spacing = [k for k in ('SpacingBetweenSlices', 'SliceThickness') if functional(ds, 'PixelMeasuresSequence', k)]
    if 'GridFrameOffsetVector' in ds:
        slice_spacing.append('GridFrameOffsetVector')
    return {
        'frameOfReference': 'FrameOfReferenceUID' in ds,
        'imagePosition': functional(ds, 'PlanePositionSequence', 'ImagePositionPatient'),
        'imageOrientation': functional(ds, 'PlaneOrientationSequence', 'ImageOrientationPatient'),
        'pixelSpacing': functional(ds, 'PixelMeasuresSequence', 'PixelSpacing'),
        'sliceSpacing': slice_spacing,
        'ultrasoundRegions': len(ds.get('SequenceOfUltrasoundRegions', [])),
        'ophthalmicFrameLocation': 'OphthalmicFrameLocationSequence' in ds,
    }


def read(path, **kwargs):
    """A data set, also without preamble or file meta; its syntax then comes from the encoding."""
    ds = pydicom.dcmread(path, force=True, **kwargs)
    if 'TransferSyntaxUID' not in ds.file_meta:
        implicit, little = ds.original_encoding
        ds.file_meta.TransferSyntaxUID = (
            pydicom.uid.ImplicitVRLittleEndian if implicit else
            pydicom.uid.ExplicitVRLittleEndian if little else pydicom.uid.ExplicitVRBigEndian)
    return ds


def file_facts(ds):
    return {
        'sopClassUID': str(ds.get('SOPClassUID', '')) or None,
        'modality': str(ds.get('Modality', '')),
        'transferSyntaxUID': str(ds.file_meta.TransferSyntaxUID),
        'filePreamble': ds.preamble is not None,
        'pixels': 'PixelData' in ds or 'FloatPixelData' in ds or 'DoubleFloatPixelData' in ds,
        'photometricInterpretation': str(ds.get('PhotometricInterpretation', '')) or None,
        'frames': (frames := frame_tags(ds)),
        'frameAxis': frame_axis(frames),
        'geometryTags': geometry_tags(ds),
    }


def tag_value(ds, path):
    """A value by a dotted keyword path, `Sequence[0].Keyword`, as JSON-able data."""
    node = ds
    for step in path.split('.'):
        keyword, _, index = step.partition('[')
        node = node[keyword].value if keyword in node else None
        if node is None:
            return None
        if index:
            node = node[int(index.rstrip(']'))]
    if isinstance(node, (pydicom.multival.MultiValue, list)):
        return [float(v) if isinstance(v, (int, float)) or hasattr(v, 'real') else str(v) for v in node]
    return float(node) if hasattr(node, 'real') else str(node)


# ---- pixels and geometry ----------------------------------------------------

def stored_pixels(ds):
    """Modality-rescaled samples in stored frame order: [frame, row, column(, sample)]."""
    frames = int(ds.get('NumberOfFrames', 1))
    raw = ds.pixel_array
    samples = int(ds.get('SamplesPerPixel', 1))
    if str(ds.get('PhotometricInterpretation', '')) == 'PALETTE COLOR':
        # The palette is the image's colour; its indices are not displayable values.
        raw, samples = apply_color_lut(raw, ds), 3
        # 8-bit pixels decode to 8-bit colour: the high byte of 16-bit entries, as GDCM does.
        if int(ds.BitsAllocated) == 8 and raw.dtype == np.uint16:
            raw = raw >> 8
    raw = raw.astype(np.float64)
    raw = raw.reshape((frames, int(ds.Rows), int(ds.Columns)) + ((samples,) if samples > 1 else ()))
    shared = ds.get('SharedFunctionalGroupsSequence', [None])[0]
    per_frame = ds.get('PerFrameFunctionalGroupsSequence', [])

    def rescale(frame):
        if 'DoseGridScaling' in ds:
            return float(ds.DoseGridScaling), 0.0
        for group in ([per_frame[frame]] if per_frame else []) + ([shared] if shared else []):
            items = group.get('PixelValueTransformationSequence')
            if items and 'RescaleSlope' in items[0]:
                return float(items[0].RescaleSlope), float(items[0].RescaleIntercept)
        # A present but empty element reads as None, which means no rescale.
        return float(ds.get('RescaleSlope') or 1), float(ds.get('RescaleIntercept') or 0)

    if samples > 1:
        return raw
    return np.stack([raw[f] * s + i for f in range(frames) for s, i in [rescale(f)]])


def pixel_fact(data, ds, storage):
    if storage == 'float32':
        data = data.astype(np.float32).astype(np.float64)
    # Colour converted from YBR depends on the decoder's rounding; a palette lookup does not.
    exact = (str(ds.get('PhotometricInterpretation', '')) in ('MONOCHROME1', 'MONOCHROME2', 'RGB', 'PALETTE COLOR')
             and str(ds.file_meta.TransferSyntaxUID) in LOSSLESS_SYNTAXES)
    if exact:
        return {'kind': 'hash', 'value': hashlib.sha256(np.ascontiguousarray(data, '<f8').tobytes()).hexdigest()}
    channels = data.reshape(-1, data.shape[-1]) if data.ndim == 4 else data.reshape(-1, 1)
    return {'kind': 'stats', 'min': channels.min(0).tolist(), 'max': channels.max(0).tolist(),
            'mean': [round(float(m), 4) for m in channels.mean(0)]}


def to_volview(vol, first_plane):
    """highdicom volume as VolView lays it out: slice axis starting at `first_plane`."""
    if first_plane is not None and vol.shape[0] > 1:
        start = vol.map_indices_to_reference(np.array([[0, 0, 0]]))[0]
        if not np.allclose(start, first_plane, atol=TOLERANCE):
            vol = vol.flip_spatial((0,))
    affine = vol.affine
    col, row, sl = affine[:3, 2], affine[:3, 1], affine[:3, 0]
    spacing = [float(np.linalg.norm(v)) for v in (col, row, sl)]
    axes = [v / s for v, s in zip((col, row, sl), spacing)]
    depth = vol.shape[0]
    if depth == 1:
        # One plane has no stacking direction; VolView uses the plane normal.
        axes[2] = np.cross(axes[0], axes[1])
    direction = np.concatenate(axes)
    geometry = {
        'dimensions': [vol.shape[2], vol.shape[1], depth],
        'spacing': [round(v, 6) for v in (spacing if depth > 1 else spacing[:2])],
        'origin': [round(float(v), 6) for v in affine[:3, 3]],
        'direction': [round(float(v), 9) + 0.0 for v in direction],
    }
    return geometry, vol.array


def first_frame_position(ds):
    per_frame = ds.get('PerFrameFunctionalGroupsSequence', [])
    if per_frame and 'PlanePositionSequence' in per_frame[0]:
        return np.array(per_frame[0].PlanePositionSequence[0].ImagePositionPatient, float)
    return np.array(ds.ImagePositionPatient, float) if 'ImagePositionPatient' in ds else None


def library_volume(ds):
    """(geometry, voxels, note) from highdicom, or (None, None, reason)."""
    if not ds.original_encoding[1] or ds.preamble is None:
        return None, None, 'highdicom reads Part 10 little endian files only'
    note = None
    if 'FrameOfReferenceUID' not in ds:
        ds = copy.deepcopy(ds)
        ds.FrameOfReferenceUID = generate_uid()
        note = 'FrameOfReferenceUID injected in memory for highdicom'
    try:
        vol = hd.Image.from_dataset(ds, copy=False).get_volume(
            apply_real_world_transform=False, apply_modality_transform=None)
    except Exception as error:  # noqa: BLE001  highdicom signals unsupported files many ways
        return None, None, f'highdicom: {type(error).__name__}: {str(error).splitlines()[0][:160]}'
    geometry, voxels = to_volview(vol, first_frame_position(ds))
    return geometry, voxels, note


def single_file_facts(path, storage='native'):
    ds = read(path)
    facts = file_facts(ds)
    if not facts['pixels']:
        facts['reference'] = 'tags'
        return facts, 'tags'
    geometry, voxels, note = library_volume(ds)
    if geometry is not None:
        facts['volume'] = {**geometry, **_range(voxels, storage), 'pixels': pixel_fact(voxels, ds, storage)}
        facts['reference'] = 'highdicom' + (f' ({note})' if note else '')
        return facts, 'library'
    stored = stored_pixels(ds)
    pixels = pixel_fact(stored, ds, storage)
    depth, rows, columns = stored.shape[:3]
    facts['volume'] = {'dimensions': [columns, rows, depth], **_range(stored, storage), 'pixels': pixels}
    facts['reference'] = 'manual'
    facts['referenceNote'] = note
    return facts, 'manual'


def _range(data, storage):
    if data.ndim == 4:
        return {}
    if storage == 'float32':
        data = data.astype(np.float32).astype(np.float64)
    return {'range': [float(data.min()), float(data.max())]}


# ---- comparison -------------------------------------------------------------

def differences(expected, actual, path=''):
    """Paths where `actual` differs from `expected`, numbers within tolerance."""
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f'{path}: expected an object']
        return [d for key in expected for d in differences(expected[key], actual.get(key), f'{path}.{key}')]
    if isinstance(expected, list) and expected and all(isinstance(v, (int, float)) for v in expected):
        tolerance = STATS_TOLERANCE if '.pixels.' in path else TOLERANCE
        ok = isinstance(actual, list) and len(actual) == len(expected) and np.allclose(expected, actual, atol=tolerance, rtol=0)
        return [] if ok else [f'{path}: {actual} vs {expected}']
    return [] if expected == actual else [f'{path}: {actual!r} vs {expected!r}']


def verify_entry(entry):
    path = CACHE / entry['name']
    if not path.exists():
        return 'missing', [f'not in {CACHE}; download or generate it first'], False
    data = path.read_bytes()
    if 'sha256' in entry and hashlib.sha256(data).hexdigest() != entry['sha256']:
        return 'fail', ['sha256 differs'], False
    saved = entry['facts']
    storage = entry.get('module', {}).get('storage', 'native')
    actual, kind = single_file_facts(path, storage)
    compare = {k: v for k, v in saved.items() if k not in ('derivation', 'derivationTags', 'referenceNote', 'reference')}
    if kind == 'manual' and 'volume' in compare:
        # Manual geometry is checked through the cited tags; pixels and shape here.
        compare['volume'] = {k: v for k, v in compare['volume'].items() if k in ('dimensions', 'range', 'pixels')}
    issues = differences(compare, actual)
    if kind != 'tags' and saved.get('reference', '').startswith('highdicom') != (kind == 'library'):
        issues.append(f"reference: highdicom {'can' if kind == 'library' else 'cannot'} build this file")
    if kind == 'manual':
        issues += manual_geometry_issues(saved)
    ds = read(path, stop_before_pixels=True)
    for tag_path, value in saved.get('derivationTags', {}).items():
        issues += differences(value, tag_value(ds, tag_path), f'derivationTags.{tag_path}')
    return ('pass' if not issues else 'fail'), issues, kind == 'manual'


def manual_geometry_issues(saved):
    """Declared geometry a manual entry leaves out, or states without citing tags."""
    volume, tags = saved.get('volume') or {}, saved.get('geometryTags', {})
    issues = []
    if tags.get('imagePosition') and 'origin' not in volume:
        issues.append('the file declares ImagePositionPatient but the entry has no origin')
    if tags.get('pixelSpacing') and 'spacing' not in volume:
        issues.append('the file declares PixelSpacing but the entry has no spacing')
    if any(k in volume for k in ('origin', 'spacing', 'direction')) and not saved.get('derivationTags'):
        issues.append('manual geometry without derivationTags')
    return issues


def verify_composition(corpus):
    sha = {d['name']: d['sha256'] for d in corpus['datasets']}
    for case in corpus['cases']:
        for volume in case['volumes']:
            missing = [n for n in volume['files'] if not (CACHE / n).exists()]
            if missing:
                yield volume['id'], 'missing', missing[:1], False
                continue
            changed = [n for n in volume['files'] if hashlib.sha256((CACHE / n).read_bytes()).hexdigest() != sha[n]]
            if changed:
                yield volume['id'], 'fail', [f'sha256 differs: {changed[0]}'], False
                continue
            items = [pydicom.dcmread(CACHE / name) for name in volume['files']]
            issues = []
            for key, subset, members in (('expected', items, volume['sopInstanceUIDs']),
                                         ('initial', items[::2], volume['sopInstanceUIDs'][::2])):
                vol = hd.get_volume_from_series(subset, apply_real_world_transform=False, apply_modality_transform=None)
                vol = vol.ensure_handedness('LEFT_HANDED', flip_axis=0)
                geometry, voxels = to_volview(vol, None)
                storage = volume.get('module', {}).get('storage', 'native')
                if storage == 'float32':
                    voxels = voxels.astype(np.float32).astype(np.float64)
                planes = [vol.map_indices_to_reference(np.array([[i, 0, 0]]))[0].tolist() for i in (0, vol.shape[0] - 1)]
                ordered = sorted(subset, key=lambda ds: float(np.dot(ds.ImagePositionPatient, np.cross(*np.reshape(ds.ImageOrientationPatient, (2, 3))))))
                actual = {**geometry, 'range': [float(voxels.min()), float(voxels.max())],
                          'pixelHash': hashlib.sha256(np.ascontiguousarray(voxels, '<f8').tobytes()).hexdigest(),
                          'firstPlanePosition': planes[0], 'lastPlanePosition': planes[1]}
                issues += differences(volume[key], actual, key)
                if [str(ds.SOPInstanceUID) for ds in ordered] != members:
                    issues.append(f'{key}: membership order')
            yield volume['id'], 'pass' if not issues else 'fail', issues, False


# ---- commands ---------------------------------------------------------------

def dumps(value):
    """Indented JSON with numeric arrays on one line, as the manifests are written."""
    number = r'-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?'
    return re.sub(rf'\[\s*({number}(?:,\s*{number})*)\s*\]',
                  lambda m: '[' + ', '.join(re.split(r',\s*', m.group(1))) + ']',
                  json.dumps(value, indent=2))


def propose(args):
    if args.generated:
        name, url = args.generated, None
        path = CACHE / name
        if not path.exists():
            sys.exit(f'{path} is missing; run npx tsx tests/fixtures/dicom-pages/writeGeneratedCorpus.ts')
    else:
        name, url = args.name, args.url
        path = CACHE / name
        if not path.exists():
            CACHE.mkdir(parents=True, exist_ok=True)
            request = urllib.request.Request(url, headers={'User-Agent': 'dicom-corpus-reference'})
            with urllib.request.urlopen(request, timeout=120) as response:
                path.write_bytes(response.read())
    data = path.read_bytes()
    facts, kind = single_file_facts(path, args.storage)
    entry = {
        'id': args.id or Path(name).stem,
        'name': name,
        **({'generator': args.generated} if args.generated else
           {'url': url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}),
        'license': 'TODO', 'attribution': 'TODO', 'sourcePage': 'TODO', 'quirk': 'TODO',
        'facts': facts,
        'module': {'outcome': 'volume' if 'volume' in facts else 'error',
                   **({'storage': args.storage} if args.storage != 'native' else {})},
    }
    if kind == 'manual' and facts['pixels']:
        entry['facts']['derivation'] = 'TODO: tags and arithmetic for spacing, origin and direction'
        entry['facts']['derivationTags'] = {}
    print(dumps(entry))


def verify(args):
    names = [args.manifest] if args.manifest else ['volume', 'extended', 'composition']
    counts = {'pass': 0, 'fail': 0, 'missing': 0}
    manual = []
    for name in names:
        path = MANIFESTS[name]
        if not path.exists():
            continue
        corpus = json.loads(path.read_text())
        print(f'== {name}')
        results = (verify_composition(corpus) if name == 'composition' else
                   ((e['id'], *verify_entry(e)) for e in corpus['datasets']))
        for entry_id, status, issues, is_manual in results:
            counts[status] += 1
            if is_manual:
                manual.append(entry_id)
            print(f'{status:7} {entry_id}' + ''.join(f'\n          {i}' for i in issues))
    print(f"\n{counts['pass']} pass, {counts['fail']} fail, {counts['missing']} missing")
    print(f'manual entries ({len(manual)}): {", ".join(manual) or "none"}')
    sys.exit(1 if counts['fail'] or counts['missing'] else 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('propose')
    p.add_argument('url', nargs='?')
    p.add_argument('--name')
    p.add_argument('--id')
    p.add_argument('--generated')
    p.add_argument('--storage', default='native', choices=['native', 'float32'])
    v = commands.add_parser('verify')
    v.add_argument('--manifest', choices=list(MANIFESTS))
    args = parser.parse_args()
    if args.command == 'propose':
        if not args.generated and not (args.url and args.name):
            parser.error('propose needs URL and --name, or --generated NAME')
        propose(args)
    else:
        verify(args)


if __name__ == '__main__':
    main()
