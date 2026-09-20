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
  currentImageId: 'image-1',
  segmentation: undefined,
  hasFinishedAnnotations: false,
  ...overrides,
});
