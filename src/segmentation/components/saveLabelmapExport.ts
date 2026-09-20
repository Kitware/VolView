import { saveAs } from 'file-saver';
import { planLabelmapExport } from '@/src/segmentation/io/composition';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import {
  bundleExportFiles,
  writeLabelmapParts,
  type ExportFile,
} from '@/src/segmentation/io/export';

export async function saveLabelmapExport(
  parentId: string,
  stem: string,
  format: string
) {
  useSegmentationEditsStore().beforeRead();
  const files: ExportFile[] = [];
  await writeLabelmapParts(
    { parentId, parts: planLabelmapExport(parentId).parts },
    stem,
    format,
    {
      deliver: (file) => {
        files.push(file);
      },
    }
  );
  const bundle = await bundleExportFiles(stem, files);
  saveAs(bundle.blob, bundle.name);
}
