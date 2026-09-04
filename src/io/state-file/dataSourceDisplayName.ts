import { getURLBasename } from '@/src/utils';
import { basename } from '@/src/utils/path';
import type { DataSourceType } from '@/src/io/state-file/schema';

export const dataSourcesById = (
  sources: DataSourceType[]
): Record<number, DataSourceType> =>
  Object.fromEntries(sources.map((source) => [source.id, source]));

const leafDataSourceDisplayNames = (
  source: Exclude<DataSourceType, { type: 'collection' }>,
  datasetFilePath: Record<string, string> | undefined
) => {
  if (source.type === 'uri') {
    return [source.name ?? getURLBasename(source.uri) ?? source.uri];
  }
  if (source.type === 'file') {
    const path = datasetFilePath?.[source.fileId];
    return path ? [basename(path)] : [];
  }
  return [basename(source.path)];
};

const dataSourceDisplayNames = (
  id: number,
  byId: Record<number, DataSourceType>,
  datasetFilePath: Record<string, string> | undefined,
  visiting = new Set<number>()
): string[] => {
  if (visiting.has(id)) return [];
  const source = byId[id];
  if (!source) return [];

  const nextVisiting = new Set(visiting).add(id);
  if (source.type !== 'collection') {
    return leafDataSourceDisplayNames(source, datasetFilePath);
  }
  return source.sources.flatMap((sourceId) =>
    dataSourceDisplayNames(sourceId, byId, datasetFilePath, nextVisiting)
  );
};

export const summarizeDataSource = (
  id: number,
  byId: Record<number, DataSourceType>,
  datasetFilePath: Record<string, string> | undefined,
  fallback: string
) => {
  const names = [...new Set(dataSourceDisplayNames(id, byId, datasetFilePath))];
  if (names.length === 0) return fallback;
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')}, … (${names.length} files)`;
};
