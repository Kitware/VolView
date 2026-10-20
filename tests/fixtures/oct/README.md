# OCT test fixtures

The fixtures are generated in memory or in the ignored test run directory. No
clinical pixel datasets belong in Git.

`dicom.ts` produces a 128 x 222 x 32 synthetic raster, with spacing
(0.046875, 0.0104, 0.1875) mm and intensity `x + 2*y + 3*z`.
`reference.json` records closed-form expectations: full-depth mean is
`x + 221 + 3*z`, maximum is `x + 442 + 3*z`, and the inclusive 100-103
slab mean is `x + 203 + 3*z`. These values do not call the projection code.

`volumes.ts` encodes the same raster as NRRD and NIfTI and generates synthetic
segmentation masks. The two flat bands occupy 2 and 4 voxels (20.8 and 41.6
micrometers), respectively, across 43 columns each. A second label occupies
5 voxels across every column. The optional curved mask is a display illustration.
None of the masks are anatomical ground truth.

The real DICOM smoke test uses the shared SHA-256-checked dataset cache. Its
public source and license are recorded with that dataset declaration.
