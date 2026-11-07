import { DataSource } from '@/src/io/import/dataSource';
import { basename } from '@/src/utils/path';

// LICENSE files and macOS metadata ship beside real data but never load.
// `__MACOSX/` holds only `._*` files, so the file name alone suffices.
export const isIgnoredFileName = (name: string) =>
  name.toLowerCase() === 'license' ||
  name === '.DS_Store' ||
  name.startsWith('._');

export const shouldSkipImportSource = (source: DataSource) =>
  (source.type === 'file' && isIgnoredFileName(source.file.name)) ||
  (source.type === 'uri' && isIgnoredFileName(basename(source.name)));
