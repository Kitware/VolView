"""Create the real-pixel OCT test fixture; requires numpy and pydicom."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct
import urllib.request

import numpy as np
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.tag import Tag
from pydicom.uid import ExplicitVRLittleEndian, OphthalmicTomographyImageStorage

SOURCE_URL = "https://ndownloader.figshare.com/files/3330704"
SOURCE_MD5 = "7f52cc7f440810e71d4cb038efb13dca"
UID = "1.2.826.0.1.3680043.10.999.466"
STEP = 4


def read_pixels_and_spacing(source):
    # Read image and physical spacing only; discard all source patient metadata.
    with source.open("rb") as stream:
        assert stream.read(4) == b"FOCT"
        stream.seek(15)
        while (length := stream.read(1)) and length[0]:
            name = stream.read(length[0])
            size = struct.unpack("<I", stream.read(4))[0]
            start = stream.tell()
            if name == b"@IMG_SCAN_03":
                mode, width, depth, bits, frames, _, byte_count = struct.unpack(
                    "<BIIIIBI", stream.read(22)
                )
                assert mode == 2 and bits == 16
                volume = np.frombuffer(stream.read(byte_count), dtype="<u2").reshape(
                    frames, depth, width
                )
            if name == b"@PARAM_SCAN_04":
                _, _, _, width_mm, height_mm, depth_um, _, _, _, _ = struct.unpack(
                    "<III5dBB", stream.read(54)
                )
            stream.seek(start + size)
    spacing = (width_mm / width, depth_um / 1000, height_mm / frames)
    return np.ascontiguousarray(volume[::STEP, ::STEP, ::STEP]), tuple(
        value * STEP for value in spacing
    )


def code(value, meaning, scheme="DCM"):
    item = Dataset()
    item.CodeValue = value
    item.CodingSchemeDesignator = scheme
    item.CodeMeaning = meaning
    return Sequence([item])


def write_dicom(target, volume, spacing):
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = OphthalmicTomographyImageStorage
    meta.MediaStorageSOPInstanceUID = f"{UID}.3"
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.ImplementationClassUID = f"{UID}.99"
    ds = FileDataset(str(target), {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = f"{UID}.1"
    ds.SeriesInstanceUID = f"{UID}.2"
    ds.FrameOfReferenceUID = f"{UID}.4"
    ds.ImageType = ["DERIVED", "PRIMARY"]
    ds.Modality = "OPT"
    ds.PatientName = "PUBLIC^OCT^TEST"
    ds.PatientID = "FIGSHARE-466-DERIVED"
    ds.PatientBirthDate = ""
    ds.PatientSex = ""
    ds.StudyDate = "20150511"
    ds.StudyTime = "000000"
    ds.SeriesDate = "20150511"
    ds.SeriesTime = "000000"
    ds.ContentDate = "20150511"
    ds.ContentTime = "000000"
    ds.StudyID = "PUBLIC-OCT"
    ds.SeriesNumber = 1
    ds.InstanceNumber = 1
    ds.SeriesDescription = "Public retinal OCT (derived test fixture)"
    ds.Manufacturer = "Topcon"
    ds.DerivationDescription = "Public Figshare 466.fds; every fourth voxel in all axes."
    ds.BurnedInAnnotation = "NO"
    ds.PatientIdentityRemoved = "YES"
    ds.DeidentificationMethod = "Image-only derivation; source metadata discarded"
    ds.NumberOfFrames, ds.Rows, ds.Columns = volume.shape
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.PixelSpacing = [spacing[1], spacing[0]]
    ds.SliceThickness = spacing[2]
    ds.SpacingBetweenSlices = spacing[2]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.ImagePositionPatient = [0, 0, 0]
    ds.OphthalmicVolumetricPropertiesFlag = "YES"
    ds.AcquisitionDeviceTypeCodeSequence = code(
        "392012008", "Optical Coherence Tomography Scanner", "SCT"
    )
    ds.ScanPatternTypeCodeSequence = code("128280", "Raster B-scan pattern")
    shared = Dataset()
    measures = Dataset()
    measures.PixelSpacing = ds.PixelSpacing
    measures.SliceThickness = ds.SliceThickness
    measures.SpacingBetweenSlices = ds.SpacingBetweenSlices
    shared.PixelMeasuresSequence = Sequence([measures])
    orientation = Dataset()
    orientation.ImageOrientationPatient = ds.ImageOrientationPatient
    shared.PlaneOrientationSequence = Sequence([orientation])
    ds.SharedFunctionalGroupsSequence = Sequence([shared])
    organization = Dataset()
    organization.DimensionOrganizationUID = f"{UID}.5"
    ds.DimensionOrganizationSequence = Sequence([organization])
    dimension = Dataset()
    dimension.DimensionOrganizationUID = organization.DimensionOrganizationUID
    dimension.DimensionIndexPointer = Tag(0x0020, 0x9057)
    dimension.FunctionalGroupPointer = Tag(0x0020, 0x9111)
    dimension.DimensionDescriptionLabel = "B-scan index"
    ds.DimensionIndexSequence = Sequence([dimension])
    groups = []
    for frame in range(volume.shape[0]):
        group = Dataset()
        position = Dataset()
        position.ImagePositionPatient = [0, 0, spacing[2] * frame]
        group.PlanePositionSequence = Sequence([position])
        content = Dataset()
        content.StackID = "1"
        content.InStackPositionNumber = frame + 1
        content.DimensionIndexValues = [frame + 1]
        group.FrameContentSequence = Sequence([content])
        anatomy = Dataset()
        anatomy.FrameLaterality = "L"
        anatomy.AnatomicRegionSequence = code("81745001", "Eye", "SCT")
        group.FrameAnatomySequence = Sequence([anatomy])
        groups.append(group)
    ds.PerFrameFunctionalGroupsSequence = Sequence(groups)
    ds.PixelData = volume.tobytes()
    ds.save_as(target, enforce_file_format=True)


def write_labelmap(target, volume, spacing):
    mask = np.zeros(volume.shape, dtype="u1")
    # Synthetic test bands, not anatomical annotations: 20.8 um and 41.6 um.
    mask[:, 100:102, :43] = 1
    mask[:, 100:104, 43:86] = 1
    mask[:, 110:115, :] = 2
    directions = f"({spacing[0]},0,0) (0,{spacing[1]},0) (0,0,{spacing[2]})"
    header = (
        "NRRD0005\ntype: unsigned char\ndimension: 3\n"
        f"sizes: {volume.shape[2]} {volume.shape[1]} {volume.shape[0]}\n"
        "space: left-posterior-superior\n"
        f"space directions: {directions}\nspace origin: (0,0,0)\n"
        "encoding: gzip\n\n"
    )
    target.write_bytes(header.encode() + gzip.compress(mask.tobytes(), mtime=0))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Path to public 466.fds")
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if args.download and not args.source.exists():
        args.source.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(SOURCE_URL, args.source)
    assert hashlib.md5(args.source.read_bytes()).hexdigest() == SOURCE_MD5
    volume, spacing = read_pixels_and_spacing(args.source)
    destination = Path(__file__).parent
    write_dicom(destination / "retina-derived.dcm", volume, spacing)
    write_labelmap(destination / "synthetic-thickness.nrrd", volume, spacing)
    points = [(0, 0), (31, 127), (12, 60), (5, 30), (20, 90)]
    projections = {}
    for name, reducer in [("mean", np.mean), ("max", np.max), ("min", np.min)]:
        projected = reducer(volume, axis=1)
        projections[name] = [float(projected[z, x]) for z, x in points]
    reference = {
        "size": [volume.shape[2], volume.shape[1], volume.shape[0]],
        "spacing": list(spacing),
        "range": [int(volume.min()), int(volume.max())],
        "points": [{"x": x, "z": z} for z, x in points],
        "projections": projections,
        "slab": {
            "start": 100,
            "end": 103,
            "mean": [float(np.mean(volume[z, 100:104, x])) for z, x in points],
        },
        "thinColumns": 43 * volume.shape[0],
        "allSegmentedColumns": 86 * volume.shape[0],
        "alternateSegmentColumns": volume.shape[2] * volume.shape[0],
    }
    (destination / "reference.json").write_text(json.dumps(reference, indent=2) + "\n")
    print(json.dumps(reference, indent=2))


if __name__ == "__main__":
    main()
