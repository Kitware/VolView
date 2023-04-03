import JSZip from 'jszip';
import { FileEntry } from './types';

export async function extractFilesFromZip(zipFile: File): Promise<FileEntry[]> {
  const zip = await JSZip.loadAsync(zipFile);
  const promises: Promise<File>[] = [];
  const paths: string[] = [];
  zip.forEach((relPath, file) => {
    if (!file.dir) {
      const splitPath = file.name.split('/');
      const baseName = splitPath[splitPath.length - 1];
      const path = [...splitPath.slice(0, splitPath.length - 1), ''].join('/');
      const fileEntry = zip.file(file.name);
      if (fileEntry) {
        promises.push(
          fileEntry.async('blob').then((blob) => new File([blob], baseName))
        );
        paths.push(path);
      }
    }
  });

  return Promise.all(promises).then((files) => {
    return files.map((file, index) => {
      return {
        file,
        archivePath: paths[index],
      };
    });
  });
}
