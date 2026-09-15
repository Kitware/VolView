import type { DataSource } from '@/src/io/import/dataSource';
import type { SourceRefBindingContext } from '../sourceRefs';

const defaultDataSource: DataSource = {
  type: 'uri',
  uri: '/api/x/scan.nrrd',
  name: 'scan.nrrd',
};

export const createSourceRefBindingContext = (
  overrides: Partial<SourceRefBindingContext> = {}
): SourceRefBindingContext => ({
  activeDataSource: defaultDataSource,
  segmentationId: undefined,
  hasFinishedAnnotations: false,
  ...overrides,
});
