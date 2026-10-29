import { startVtkFixture } from '../vtkFixtureServer.mjs';

export function startVolumeTextureFixture() {
  return startVtkFixture(new URL('.', import.meta.url));
}
