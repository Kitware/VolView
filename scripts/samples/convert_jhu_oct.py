#!/usr/bin/env python3
"""Convert the JHU hc01 OCT image and manual boundaries into a data-only ZIP.

Requires NumPy and SciPy. Supply the original .vol and .mat files from the
archive identified in jhu-oct-provenance.json. Outputs contain local scan
coordinates and no patient header fields. The optional validity image stays
outside the ZIP, which contains only the image and named segmentation.
"""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct
import zipfile

import numpy as np
from scipy.io import loadmat


NAMES = ["Retinal nerve fiber layer (RNFL)", "Ganglion cell and inner plexiform layers (GCL+IPL)",
         "Inner nuclear layer (INL)", "Outer plexiform layer (OPL)", "Outer nuclear layer (ONL)",
         "Photoreceptor inner segments (IS)", "Photoreceptor outer segments (OS)",
         "Retinal pigment epithelium (RPE)"]
COLORS = [(230, 70, 70), (245, 160, 40), (225, 210, 50), (85, 190, 90),
          (55, 185, 210), (80, 115, 225), (165, 90, 210), (235, 105, 180)]
COLUMNS = [0, 1, 3, 4, 5, 6, 7, 8, 9]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def interpolate_controls(controls, width):
    """Use the source reader's natural cubic in unit parameter intervals."""
    controls = controls[np.argsort(controls[:, 0], kind="stable")]
    x, indices = np.unique(controls[:, 0], return_index=True)
    y = controls[indices, 1]
    if len(x) < 2 or not np.all(x == np.floor(x)):
        raise ValueError("Expected at least two integer lateral control positions")
    n = len(y) - 1
    gamma, delta, derivative = (np.zeros(n + 1) for _ in range(3))
    gamma[0] = 0.5
    for i in range(1, n):
        gamma[i] = 1 / (4 - gamma[i - 1])
    gamma[-1] = 1 / (2 - gamma[-2])
    delta[0] = 3 * (y[1] - y[0]) * gamma[0]
    for i in range(1, n):
        delta[i] = (3 * (y[i + 1] - y[i - 1]) - delta[i - 1]) * gamma[i]
    delta[-1] = (3 * (y[-1] - y[-2]) - delta[-2]) * gamma[-1]
    derivative[-1] = delta[-1]
    for i in range(n - 1, -1, -1):
        derivative[i] = delta[i] - gamma[i] * derivative[i + 1]
    values = np.zeros(int(x[-1] - x[0] + 1))
    for i in range(n):
        left, right = int(x[i] - x[0]), int(x[i + 1] - x[0])
        t = np.arange(1, right - left) / (right - left)
        c2 = 3 * (y[i + 1] - y[i]) - 2 * derivative[i] - derivative[i + 1]
        c3 = -2 * (y[i + 1] - y[i]) + derivative[i] + derivative[i + 1]
        values[left] = y[i]
        values[left + 1:right] = y[i] + derivative[i] * t + c2 * t * t + c3 * t * t * t
    values[-1] = y[-1]
    return values[np.clip(np.arange(1, width + 1) - int(x[0]), 0, len(values) - 1)]


def read_sources(volume_path, annotation_path):
    with volume_path.open("rb") as source:
        header = source.read(2048)
        width, frames, depth = struct.unpack_from("<III", header, 12)
        if header[:12] != b"HSF-OCT-103\0" or (width, depth, frames) != (1024, 496, 49):
            raise ValueError("Expected the original JHU hc01 HSF-OCT-103 volume")
        lateral, _, axial = struct.unpack_from("<ddd", header, 24)
        slo_width, slo_height = struct.unpack_from("<II", header, 48)
        scan_header = struct.unpack_from("<I", header, 100)[0]
        base = 2048 + slo_width * slo_height
        image = np.empty((frames, depth, width // 2), np.float32)
        valid = np.empty_like(image, dtype=bool)
        coordinates = []
        native_invalid = 0
        for frame in range(frames):
            offset = base + frame * (scan_header + width * depth * 4)
            source.seek(offset + 16)
            coordinates.append(struct.unpack("<dddd", source.read(32)))
            source.seek(offset + scan_header)
            raw = np.frombuffer(source.read(width * depth * 4), "<f4").reshape(depth, width)
            good = np.isfinite(raw) & (raw >= 0) & (raw <= 1)
            native_invalid += int((~good).sum())
            image[frame] = np.sqrt(np.sqrt(np.where(good[:, ::2], raw[:, ::2], 0)))
            valid[frame] = good[:, ::2]
    controls = loadmat(annotation_path, variable_names=["control_pts"])["control_pts"]
    if controls.shape != (frames, 11):
        raise ValueError("Expected 49 frames with eleven annotation slots")
    boundaries = np.zeros((frames, width, 9))
    crossing_clamps = 0
    for frame in range(frames):
        for boundary, column in enumerate(COLUMNS):
            curve = interpolate_controls(controls[frame, column], width)
            if boundary:
                crossing_clamps += int((curve < boundaries[frame, :, boundary - 1]).sum())
                curve = np.maximum(curve, boundaries[frame, :, boundary - 1])
            boundaries[frame, :, boundary] = curve
    return image, valid, boundaries, np.array(coordinates), [lateral, axial], native_invalid, crossing_clamps


def regularize(image, valid, boundaries, coordinates, spacing):
    frames, depth, width = image.shape
    native_x = np.arange(0, width * 2, 2)
    fraction = native_x / (width * 2 - 1)
    slow = coordinates[0, 1] - (coordinates[:, 1, None] + fraction * (coordinates[:, 3] - coordinates[:, 1])[:, None])
    if not np.all(np.diff(slow, axis=0) > 0):
        raise ValueError("Source B-scans must have increasing slow-axis positions")
    target = np.linspace(slow[0, 0], slow[-1, 0], frames)
    lower = np.empty((frames, width), np.int32)
    upper = np.empty_like(lower)
    weight = np.empty((frames, width))
    physical = np.empty((frames, width), bool)
    regular_boundaries = np.empty((frames, width, 9))
    for x in range(width):
        positions = slow[:, x]
        physical[:, x] = (target >= positions[0]) & (target <= positions[-1])
        lo = np.clip(np.searchsorted(positions, target, side="right") - 1, 0, frames - 1)
        hi = np.minimum(lo + 1, frames - 1)
        t = np.divide(target - positions[lo], positions[hi] - positions[lo], out=np.zeros(frames), where=hi != lo)
        t = np.clip(t, 0, 1)
        t[np.abs(t) < 1e-10] = 0
        t[np.abs(1 - t) < 1e-10] = 1
        lower[:, x], upper[:, x], weight[:, x] = lo, hi, t
        regular_boundaries[:, x] = (1 - t[:, None]) * boundaries[lo, native_x[x]] + t[:, None] * boundaries[hi, native_x[x]]
    output = np.empty_like(image)
    validity = np.empty_like(image, dtype=np.uint8)
    labels = np.zeros_like(image, dtype=np.uint8)
    complete = np.empty((frames, width), bool)
    for frame in range(frames):
        x = np.arange(width)
        lo, hi, t = lower[frame], upper[frame], weight[frame]
        good = ((t[:, None] == 1) | valid[lo, :, x]) & ((t[:, None] == 0) | valid[hi, :, x]) & physical[frame, :, None]
        values = (1 - t[:, None]) * image[lo, :, x].astype(np.float64) + t[:, None] * image[hi, :, x].astype(np.float64)
        output[frame] = np.where(good, values, 0).T
        validity[frame] = good.T
        rounded = np.floor(regular_boundaries[frame] + 0.5).astype(np.int32)
        if rounded.min() < 0 or rounded.max() > depth or np.any(np.diff(rounded, axis=1) < 0):
            raise ValueError("Invalid rounded retinal boundary ordering")
        layer = np.zeros((depth, width), np.uint8)
        rows = np.arange(depth)[:, None]
        # The author assigns one-based rows upper+1 through lower inclusive.
        for segment in range(8):
            layer[(rows >= rounded[:, segment]) & (rows < rounded[:, segment + 1])] = segment + 1
        complete[frame] = ~np.any((layer > 0) & ~good.T, axis=0) & physical[frame]
        labels[frame] = np.where(complete[frame][None, :], layer, 0)
    return output, labels, validity, [spacing[0] * 2, spacing[1], float(target[1] - target[0])], complete


def write_nrrd(path, data, spacing, provenance, metadata):
    attribution = provenance["citation"]
    lines = ["NRRD0005", "# Local scan coordinates; anatomical patient orientation is not inferred.",
             "type: " + ("float" if data.dtype == np.float32 else "unsigned char"),
             "dimension: 3", "space dimension: 3", "sizes: " + " ".join(map(str, data.shape[::-1])),
             f"space directions: ({spacing[0]:.17g},0,0) (0,{spacing[1]:.17g},0) (0,0,{spacing[2]:.17g})",
             "kinds: domain domain domain", "endian: little", "encoding: gzip",
             'space units: "mm" "mm" "mm"', "space origin: (0,0,0)",
             "# Source: " + provenance["archive_url"], "# Paper: " + provenance["paper_url"],
             "# Attribution: " + attribution,
             *["# SHA256 " + source["filename"] + " " + source["sha256"] for source in provenance["sources"]],
             "OCT_AxisMeaning:=lateral depth slow", "OCT_DepthAxis:=1",
             "OCT_Source:=JHU IACL hc01 manually delineated healthy-control OCT",
             *[key + ":=" + value for key, value in metadata.items()]]
    path.write_bytes(("\n".join(lines) + "\n\n").encode("ascii") + gzip.compress(data.tobytes(order="C"), mtime=0))
    return {"filename": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Directory containing the original hc01 .vol and .mat")
    parser.add_argument("output", type=Path, help="Output directory outside the checkout or in an ignored directory")
    parser.add_argument("--write-validity", action="store_true", help="Write an additional validity NRRD outside the ZIP")
    args = parser.parse_args()
    provenance = json.loads(Path(__file__).with_name("jhu-oct-provenance.json").read_text())
    inputs = [args.source / entry["filename"] for entry in provenance["sources"]]
    for path, expected in zip(inputs, provenance["sources"]):
        if sha256(path) != expected["sha256"]:
            raise ValueError(f"Unexpected source checksum: {path.name}")
    *grid, native_invalid, crossing_clamps = read_sources(*inputs)
    image, labels, validity, spacing, complete = regularize(*grid)
    excluded, total = int((~complete).sum()), int(complete.size)
    coverage = f"{excluded} of {total} columns excluded"
    if not np.all(np.isfinite(image)) or image.min() < 0 or image.max() > 1:
        raise ValueError("Converted image must contain finite reflectivity display values from zero to one")
    if np.any(labels[validity == 0]) or set(np.unique(labels)) != set(range(9)):
        raise ValueError("Expected eight labeled layers entirely within valid reflectivity")
    image = np.rint(image.astype(np.float64) * 255).astype(np.uint8)
    args.output.mkdir(parents=True, exist_ok=True)
    metadata = {"Segmentation_MasterRepresentation": "Binary labelmap", "Segmentation_ContainedRepresentationNames": "Binary labelmap|",
                "Segmentation_ReferenceImageExtentOffset": "0 0 0",
                "OCT_CoveragePolicy": f"All eight labels excluded for a column if any expected retinal voxel is invalid; {coverage}"}
    width, depth, frames = image.shape[::-1]
    for index, (name, color) in enumerate(zip(NAMES, COLORS)):
        fields = {"ID": f"Segment_{index + 1}", "Name": name, "LabelValue": str(index + 1),
                  "Color": " ".join(f"{channel / 255:.6f}" for channel in color), "Layer": "0",
                  "Extent": f"0 {width - 1} 0 {depth - 1} 0 {frames - 1}", "Tags": "|"}
        metadata.update({f"Segment{index}_{key}": value for key, value in fields.items()})
    files = [write_nrrd(args.output / "jhu-hc01.nrrd", image, spacing, provenance,
                        {"OCT_IntensityTransform": "Nested float32 sqrt(sqrt(valid native reflectivity)) before slow-axis interpolation",
                         "OCT_InvalidPadding": "Missing reflectivity is zero; genuine zero and missing samples are indistinguishable without the optional validity sidecar",
                         "OCT_RetinalCoverage": f"{coverage} from all labels because expected retina has missing reflectivity",
                         "OCT_IntensityEncoding": "uint8; normalized intensity = stored value / 255; nearest rounding after slow-axis interpolation"}),
             write_nrrd(args.output / "jhu-hc01.seg.nrrd", labels, spacing, provenance, metadata)]
    archive = args.output / "jhu-retinal-layers.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
        for entry in files:
            info = zipfile.ZipInfo(entry["filename"], (2026, 10, 18, 0, 0, 0))
            info.create_system = 3  # Preserve reference Unix metadata across platforms.
            info.external_attr = 0o644 << 16
            bundle.writestr(info, (args.output / entry["filename"]).read_bytes())
    if args.write_validity:
        write_nrrd(args.output / "jhu-hc01-validity.nrrd", validity, spacing, provenance,
                   {"OCT_Validity": "One iff every source with nonzero interpolation weight is valid"})
    report = {"dimensions": list(image.shape[::-1]), "spacing_mm": spacing, "axial_spacing_microns": spacing[1] * 1000,
              "intensity_type": "uint8", "normalized_intensity_scale": 255,
              "native_invalid_voxels": native_invalid, "surface_crossing_clamps": crossing_clamps,
              "complete_retinal_columns": int(complete.sum()), "excluded_retinal_columns": excluded,
              "total_retinal_columns": total, "files": files,
              "archive": {"filename": archive.name, "bytes": archive.stat().st_size, "sha256": sha256(archive)}}
    (args.output / "jhu-hc01-conversion.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
