import { makeDefaultSegmentName } from '@/src/segmentation/model';

/** One image's segment names, each held by one id, and free names. */
export const createNameIndex = () => {
  const idByName = new Map<string, string>();
  const suffixFloors = new Map<string, number>();

  const add = (name: string, id: string) => idByName.set(name, id);

  // Releasing a name may free a suffix below its family's cached floor.
  const remove = (name: string) => {
    idByName.delete(name);
    suffixFloors.clear();
  };

  const idNamed = (name: string) => idByName.get(name.trim());

  const taken = (name: string) => idByName.has(name);

  // `family` keys the floor: every name `nameFor` gives belongs to it.
  const lowestFree = (
    family: string,
    nameFor: (index: number) => string,
    first: number
  ) => {
    let index = suffixFloors.get(family) ?? first;
    while (taken(nameFor(index))) index += 1;
    suffixFloors.set(family, index);
    return nameFor(index);
  };

  const uniqueName = (stem: string) => {
    const base = stem.trim();
    return taken(base)
      ? lowestFree(`${base} (`, (index) => `${base} (${index})`, 2)
      : base;
  };

  const rename = (id: string, from: string, to: string) => {
    remove(from);
    const name = uniqueName(to);
    add(name, id);
    return name;
  };

  // A stem family ends in ' (', so this key never collides with one.
  const defaultName = () => lowestFree('default', makeDefaultSegmentName, 1);

  return { add, remove, rename, idNamed, uniqueName, defaultName };
};
