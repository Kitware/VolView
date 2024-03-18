import { z } from 'zod';

export const RemoteResource = z.object({
  url: z.string(),
  name: z.optional(z.string()),
});

export const RemoteDataManifest = z.object({
  resources: z.array(RemoteResource),
});

export async function readRemoteManifestFile(manifestFile: File) {
  const decoder = new TextDecoder();
  const ab = await manifestFile.arrayBuffer();
  const text = decoder.decode(new Uint8Array(ab));
  const manifest = RemoteDataManifest.parse(JSON.parse(text));
  return manifest;
}
