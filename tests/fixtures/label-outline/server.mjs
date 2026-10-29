import { startVtkFixture } from '../vtkFixtureServer.mjs';

export function startOutlineFixture() {
  return startVtkFixture(new URL('.', import.meta.url));
}
