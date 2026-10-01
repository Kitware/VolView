"""Generate an illustrative synthetic curved layer, never clinical ground truth."""
import argparse
import gzip
import math
from pathlib import Path

import pydicom


def generate(source, destination):
    image = pydicom.dcmread(source, stop_before_pixels=True)
    width, depth, frames = image.Columns, image.Rows, int(image.NumberOfFrames)
    spacing = [float(image.PixelSpacing[1]), float(image.PixelSpacing[0]),
               float(image.SpacingBetweenSlices)]
    assert (width, depth, frames) == (128, 222, 32)
    mask = bytearray(width * depth * frames)
    thin_columns = 0
    for z in range(frames):
        for x in range(width):
            # An approximate shape for display, not a detected retinal boundary.
            bottom = math.floor(145 + 26 * math.sin(math.pi * x / (width - 1))
                                + 2 * math.sin(math.pi * z / (frames - 1)) + 0.5)
            thin = ((x - 76) / 12) ** 2 + ((z - 16) / 3) ** 2 <= 1
            thickness = 2 if thin else 5
            thin_columns += thin
            for y in range(bottom - thickness + 1, bottom + 1):
                mask[(z * depth + y) * width + x] = 1
    header = (
        "NRRD0005\ntype: unsigned char\ndimension: 3\n"
        f"sizes: {width} {depth} {frames}\nspace: left-posterior-superior\n"
        f"space directions: ({spacing[0]},0,0) (0,{spacing[1]},0) (0,0,{spacing[2]})\n"
        "space origin: (0,0,0)\nencoding: gzip\n\n"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(header.encode() + gzip.compress(mask, mtime=0))
    print(f"{destination}: {thin_columns} synthetic thin A-lines out of {width * frames}")
    print("Synthetic thicknesses: 20.8 and 52 microns; display threshold: 31 microns")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--source", type=Path,
                        default=Path(__file__).with_name("retina-derived.dcm"))
    args = parser.parse_args()
    generate(args.source, args.destination)
