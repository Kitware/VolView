import fs from 'node:fs';
import path from 'node:path';
import { createNrrdVolume } from '../fixtures/oct/volumes';

export function stageProjectionContrastVolume(directory: string) {
  const scalars = Uint16Array.from({ length: 8 * 5 * 6 }, (_, index) => {
    const x = index % 8;
    const y = Math.floor(index / 8) % 5;
    const z = Math.floor(index / 40);
    return 10 * x + 3 * z + (y === 0 ? 500 : 20 * y);
  });
  const bytes = createNrrdVolume({
    scalars,
    dimensions: [8, 5, 6],
    spacing: [1, 1, 1],
  });
  fs.writeFileSync(path.join(directory, 'source.nrrd'), bytes);
}
