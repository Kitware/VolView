import type vtkLabelMap from '@/src/vtk/LabelMap';
import {
  clipExtent,
  extentUnion,
  isEmptyExtent,
  reframeMaskScalars,
  type Extent3D,
} from '@/src/segmentation/geometry';
import type {
  OccupiedDepthInput,
  OccupiedDepthMaskUpdate,
} from './occupiedDepth';

type Mask = OccupiedDepthInput['mask'];

/** Accumulates every edit until this consumer copies its next worker update. */
export function createMaskSnapshot(image: vtkLabelMap) {
  // null means a full replacement; undefined means no pending voxel writes.
  let dirty: Extent3D | null | undefined = null;
  let copied: Mask | undefined;
  let scalars = image.getPointData().getScalars();
  const invalidate = () => {
    dirty = null;
  };
  let scalarSubscription = scalars?.onModified(invalidate);
  const imageSubscription = image.onModified(() => {
    const extent = image.getModifiedExtent();
    dirty =
      extent && dirty !== null
        ? dirty
          ? extentUnion(dirty, extent)
          : [...extent]
        : null;
    const nextScalars = image.getPointData().getScalars();
    if (scalars !== nextScalars) {
      scalarSubscription?.unsubscribe();
      scalars = nextScalars;
      scalarSubscription = scalars?.onModified(invalidate);
      invalidate();
    }
  });

  const sameStorage = (mask: Mask) =>
    copied?.values === mask.values &&
    copied.dimensions.every(
      (value, index) => value === mask.dimensions[index]
    ) &&
    copied.extent.every((value, index) => value === mask.extent[index]);

  function take(
    mask: Mask,
    force = false
  ): OccupiedDepthMaskUpdate | undefined {
    const replacement = force || dirty === null || !sameStorage(mask);
    const extent = replacement
      ? ([...mask.extent] as Extent3D)
      : dirty && clipExtent(dirty, mask.extent as Extent3D);
    let update: OccupiedDepthMaskUpdate | undefined;
    if (replacement) {
      update = {
        kind: 'replace',
        mask: {
          values: new Uint8Array(mask.values),
          dimensions: [...mask.dimensions],
          extent: [...mask.extent],
        },
      };
    } else if (extent && !isEmptyExtent(extent)) {
      update = {
        kind: 'patch',
        extent,
        values: reframeMaskScalars(
          mask.values,
          mask.extent as Extent3D,
          extent
        ),
      };
    }
    copied = {
      values: mask.values,
      dimensions: [...mask.dimensions],
      extent: [...mask.extent],
    };
    dirty = undefined;
    return update;
  }

  return {
    take,
    invalidate,
    dispose: () => {
      imageSubscription?.unsubscribe();
      scalarSubscription?.unsubscribe();
    },
  };
}
