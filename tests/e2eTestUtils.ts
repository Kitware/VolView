import { dirname } from 'path';
import { fileURLToPath } from 'url';

export function projectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}
