import { unzip } from 'fflate';
import { FileEntry } from './types';

export async function extractFilesFromZip(zipFile: File): Promise<FileEntry[]> {
  const ab = await zipFile.arrayBuffer();
  return new Promise((resolve, reject) => {
    unzip(
      new Uint8Array(ab),
      {
        filter(file) {
          return !file.name.endsWith('/');
        },
      },
      (err, unzipped) => {
        if (err) reject(err);
        else {
          resolve(
            Object.entries(unzipped).map(([fullname, data]) => {
              const splitPath = fullname.split('/');
              const baseName = splitPath[splitPath.length - 1];
              const path = [
                ...splitPath.slice(0, splitPath.length - 1),
                '',
              ].join('/');
              const file = new File([data], baseName);
              return {
                file,
                path,
              };
            })
          );
        }
      }
    );
  });
}
