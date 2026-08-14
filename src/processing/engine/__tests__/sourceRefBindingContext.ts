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
  backgroundImageId: 'image-1',
  activeSegmentGroupId: null,
  segmentGroups: { orderByParent: {}, metadataByID: {} },
  hasFinishedAnnotations: false,
  getDataSource: () => defaultDataSource,
  ...overrides,
});
