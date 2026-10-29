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

The Heidelberg reference retains the original voxel-column reductions.
`physicalSlabSampling` separately records the shared slab sampler: half the
minimum absolute source spacing, with the selected slab's two endpoints included.
For this fixture the depth spacing is the smallest spacing, so the 0.001936 mm
step is half a depth voxel. A column with `N` voxels has `2N - 1` samples.
Its Sum is `2 * voxelSum - (firstVoxel + lastVoxel) / 2`; Mean divides by
`2N - 1`. The partial slab applies the same rule to inclusive depths 100
through 300. These values are calculated from the raw 8-bit DICOM pixel payload
at the recorded source checksum, independently of the renderer.
