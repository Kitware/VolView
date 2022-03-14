import JSZip from 'jszip';

export async function extractFilesFromZip(zipFile: File) {
  const zip = await JSZip.loadAsync(zipFile);
  const promises: Promise<File>[] = [];
  zip.forEach((relPath, file) => {
    if (!file.dir) {
      const splitPath = file.name.split('/');
      const baseName = splitPath[splitPath.length - 1];
      const fileEntry = zip.file(file.name);
      if (fileEntry) {
        promises.push(
          fileEntry.async('blob').then((blob) => new File([blob], baseName))
        );
      }
    }
  });
  return Promise.all(promises);
}
