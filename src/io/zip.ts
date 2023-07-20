import { basename, dirname } from '@/src/utils/path';
import { FileEntry } from './types';

const importJSZip = () => import('@/src/lazy/lazyJSZip');

export async function extractFilesFromZip(zipFile: File): Promise<FileEntry[]> {
  const { JSZip } = await importJSZip();
  const zip = await JSZip.loadAsync(zipFile);
  const promises: Promise<File>[] = [];
  const paths: string[] = [];
  zip.forEach((relPath, file) => {
    if (!file.dir) {
      const fileName = basename(file.name);
      const path = dirname(file.name);
      const fileEntry = zip.file(file.name);
      if (fileEntry) {
        promises.push(
          fileEntry.async('blob').then((blob) => new File([blob], fileName))
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
