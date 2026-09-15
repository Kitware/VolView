/**
 * The value every mask marks its own voxels with. A mask holds one segment and
 * nothing else, so the byte says only claimed or not; which segment it belongs
 * to is the mask's identity, not its content. Export assigns its own values at
 * write time, where one file does have to tell segments apart per voxel.
 */
export const SEGMENT_VALUE = 1;
