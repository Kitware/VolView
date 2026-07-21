import { describe, it, expect } from 'vitest';

import { createProvider } from '../createProvider';
import type { ProcessingProviderConfig } from '@/src/processing/types';

const config: ProcessingProviderConfig = {
  id: 'girder-slicer-cli:folder-1',
  label: 'Analysis — Folder',
  baseUrl: `${window.location.origin}/api/v1/folder/f1/volview_processing`,
  jobsBaseUrl: `${window.location.origin}/api/v1/volview_processing`,
};

const REQUIRED_METHODS = [
  'listTasks',
  'getTaskSpec',
  'runTask',
  'getJob',
  'getResults',
  'cancelJob',
  'deleteJob',
  'stageInput',
  'listJobHistory',
  'getJobHistoryDetail',
] as const;

describe('createProvider — every operation is required', () => {
  it('exposes all ten operations as functions', () => {
    const provider = createProvider(config);
    REQUIRED_METHODS.forEach((method) => {
      expect(
        typeof (provider as unknown as Record<string, unknown>)[method]
      ).toBe('function');
    });
  });

  it('carries the config it was built from', () => {
    const provider = createProvider(config);
    expect(provider.config).toBe(config);
  });
});
