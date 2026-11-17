import type { Extent3D } from '@/src/segmentation/geometry';

let current: Extent3D | undefined;

/**
 * Runs `write` with every mask it modifies announced as changed only within
 * `extent`, in parent index space, so observers can skip what it misses.
 */
export function confineWrites<T>(extent: Extent3D, write: () => T) {
  const outer = current;
  current = extent;
  try {
    return write();
  } finally {
    current = outer;
  }
}

/** The box a mask modification being announced now is confined to, if known. */
export const writeRegion = () => current;
