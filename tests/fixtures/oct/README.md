# Retinal OCT test data

`retina-derived.dcm` uses pixels from **Enting Gao, “oct-data” v2 (2015)**,
[Figshare DOI](https://doi.org/10.6084/m9.figshare.1409373),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Source: [466.fds](https://ndownloader.figshare.com/files/3330704).
Every fourth voxel is retained and spacing is scaled accordingly; the DICOM
encoding is generated for testing. Source patient metadata is omitted.
FDS decoding follows the MIT-licensed [OCT-Converter](https://github.com/marksgraham/OCT-Converter).

The labelmaps are synthetic, not anatomical ground truth. `reference.json`
contains independent NumPy projection results.

Regenerate with NumPy and pydicom installed, from the repository root:

```sh
python tests/fixtures/oct/generate.py /tmp/466.fds --download
python tests/fixtures/oct/illustrative.py /tmp/illustrative-layer.nrrd
```

`public/samples/retinal-oct.dcm` is a native Heidelberg Spectralis export from
[Theis Lab, DeepRT](https://github.com/theislab/DeepRT/tree/be86ac601294866d0c3f1d924418d8fee41ead37/thickness_map_calculation/data/256692_R_20160524).
The patient module is emptied; pixels and geometry are unchanged.
[MIT license](../../../public/samples/LICENSE.DeepRT); Independent projection results: `heidelberg-reference.json`.

`tests/baseline/oct/retinal-flow.nrrd` contains three unchanged OCTA flow planes (0299–0301) from
subject 10323 of **Abdel-Razzak Al-Hinnawi, OCTA Macula Coronal Views (2023)**,
[DOI](https://doi.org/10.17632/p5h7x55zw7.1), CC BY 4.0. Physical units are not asserted.
`tests/baseline/oct/retinal-flow-source.png` is supplied plane 0300; `retinal-flow-reference.json`
records source hashes and independent mean values. This crop is not a full clinical scan.
