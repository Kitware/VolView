import { z } from 'zod';
import { makeRemote } from '../store/datasets-files';
import { getURLBasename } from '../utils';
import { fetchFile } from '../utils/fetch';

const RemoteResource = z.object({
  url: z.string(),
  name: z.optional(z.string()),
});

export const RemoteDataManifest = z.object({
  resources: z.array(RemoteResource),
});

export async function fetchRemoteManifest(
  manifest: z.infer<typeof RemoteDataManifest>
) {
  return Promise.all(
    manifest.resources.map(async (resource) =>
      makeRemote(
        resource.url,
        await fetchFile(
          resource.url,
          resource.name ?? getURLBasename(resource.url)
        )
      )
    )
  );
}

export async function readRemoteManifestFile(manifestFile: File) {
  const decoder = new TextDecoder();
  const ab = await manifestFile.arrayBuffer();
  const text = decoder.decode(new Uint8Array(ab));
  const manifest = RemoteDataManifest.parse(JSON.parse(text));
  return manifest;
}
