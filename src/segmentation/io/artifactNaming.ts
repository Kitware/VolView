const defaultName = (baseName: string, index: number) =>
  `Segment Group ${index} for ${baseName}`;

/**
 * Default names for segmentation artifacts, counted per parent image. The
 * count keeps rising so a deleted artifact's name is not immediately handed to
 * the next one, and `taken` skips a name something already holds.
 */
export function createArtifactNamer(taken: () => Set<string>) {
  const nextIndex: Record<string, number> = Object.create(null);
  return {
    pick(parentImageId: string, baseName: string) {
      const held = taken();
      let name = '';
      do {
        const index = nextIndex[parentImageId] ?? 1;
        nextIndex[parentImageId] = index + 1;
        name = defaultName(baseName, index);
      } while (held.has(name));
      return name;
    },
    /** Called by the deletion cascade, so a removed image stops counting. */
    forget(parentImageId: string) {
      delete nextIndex[parentImageId];
    },
  };
}
