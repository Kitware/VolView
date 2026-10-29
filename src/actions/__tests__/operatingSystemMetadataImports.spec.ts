import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import JSZip from 'jszip';

import { loadDataSources, loadFiles } from '@/src/actions/loadUserFiles';
import { config, applyPostStateConfig } from '@/src/io/import/configJson';
import { fileToDataSource, uriToDataSource } from '@/src/io/import/dataSource';
import SegmentAssignmentList from '@/src/segmentation/components/SegmentAssignmentList.vue';
import {
  activateAppPinia,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

enableAutoUnmount(afterEach);
beforeEach(() => activateAppPinia());

const configFile = () =>
  new File([JSON.stringify({ segments: { Tumor: {} } })], 'config.json');

async function viewedSegments() {
  await viewImage('active');
  applyPostStateConfig(config.parse({ segments: { Liver: {} } }), undefined, [
    'active',
  ]);
  const picker = mount(SegmentAssignmentList, {
    props: { imageId: 'active' },
    global: {
      stubs: {
        VList: { template: '<ul><slot /></ul>' },
        VListItem: { template: '<li><slot /></li>' },
        VListItemTitle: { template: '<span class="name"><slot /></span>' },
      },
    },
  });
  return () => picker.findAll('.name').map((row) => row.text());
}

async function importWithSibling(
  container: 'files' | 'collection' | 'archive' | 'uri',
  name: string
) {
  const sibling = new File(['Finder metadata'], name);
  if (container === 'archive') {
    const zip = new JSZip();
    zip.file('config.json', await configFile().text());
    zip.file(name, await sibling.text());
    return loadFiles([
      new File(
        [await zip.generateAsync({ type: 'arraybuffer' })],
        'config.zip'
      ),
    ]);
  }
  if (container === 'uri')
    return loadDataSources([
      fileToDataSource(configFile()),
      uriToDataSource('data:text/plain,Finder%20metadata', name),
    ]);
  const sources = [configFile(), sibling].map(fileToDataSource);
  return container === 'collection'
    ? loadDataSources([{ type: 'collection', sources }])
    : loadDataSources(sources);
}

describe('operating-system metadata beside a configuration', () => {
  it.each(['files', 'collection', 'archive', 'uri'] as const)(
    'applies a standalone config to the viewed image through %s',
    async (container) => {
      const names = await viewedSegments();
      await importWithSibling(container, '._config.json');
      await nextTick();
      expect(names()).toEqual(['Tumor']);
    }
  );

  it.each(['.DS_Store', '__MACOSX/ordinary-file'])(
    'ignores the metadata path %s in a dropped folder',
    async (relativePath) => {
      const names = await viewedSegments();
      const sibling = new File(
        ['Finder metadata'],
        relativePath.split('/').at(-1)!
      );
      Object.defineProperty(sibling, 'webkitRelativePath', {
        value: `folder/${relativePath}`,
      });
      await loadFiles([configFile(), sibling]);
      await nextTick();
      expect(names()).toEqual(['Tumor']);
    }
  );

  it('still treats an ordinary unsupported sibling as data intent', async () => {
    const names = await viewedSegments();
    await importWithSibling('files', 'README.md');
    await nextTick();
    expect(names()).toEqual(['Liver']);
  });

  it('honors an explicit manifest reference even when its name looks hidden', async () => {
    const names = await viewedSegments();
    await loadDataSources([
      fileToDataSource(configFile()),
      {
        ...fileToDataSource(new File(['unreadable data'], '._volume.vti')),
        stateFileLeaf: { stateID: 'saved-volume' },
      },
    ]);
    await nextTick();
    expect(names()).toEqual(['Liver']);
  });
});
