import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import JSZip from 'jszip';
import vtkXMLImageDataReader from '@kitware/vtk.js/IO/XML/XMLImageDataReader';
import vtkSTLReader from '@kitware/vtk.js/IO/Geometry/STLReader';
import { z } from 'zod';

import { loadDataSources, loadFiles } from '@/src/actions/loadUserFiles';
import { FILE_READERS } from '@/src/io';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { readFile } from '@/src/io/vtk/common';
import { fileToDataSource } from '@/src/io/import/dataSource';
import { registerConfigSection } from '@/src/io/import/configJson';
import { buildSegNrrdMetadata } from '@/src/io/segNrrdMetadata';
import { useImageStore } from '@/src/store/datasets-images';
import { useViewStore } from '@/src/store/views';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import useLoadDataStore from '@/src/store/load-data';
import SegmentAssignmentList from '@/src/segmentation/components/SegmentAssignmentList.vue';
import {
  activateAppPinia,
  markedVoxels,
  strokeAt,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { defer } from '@/src/utils';

enableAutoUnmount(afterEach);

const imageFile = (name: string, mask = false) =>
  new File(
    [
      `<?xml version="1.0"?>
<VTKFile type="ImageData" version="0.1" byte_order="LittleEndian">
<ImageData WholeExtent="0 3 0 3 0 1" Origin="0 0 0" Spacing="1 1 1">
<Piece Extent="0 3 0 3 0 1"><PointData Scalars="Scalars">
<DataArray type="UInt8" Name="Scalars" NumberOfComponents="1" format="ascii">${Array.from({ length: 32 }, (_, i) => (mask ? Number(i === 5) : i)).join(' ')}</DataArray>
</PointData><CellData/></Piece></ImageData></VTKFile>`,
    ],
    name
  );

const configFile = (name: string, extra = {}) =>
  new File(
    [JSON.stringify({ segments: { [name]: { color: '#ff0000' } }, ...extra })],
    'config.json'
  );
const badImage = () => new File(['not VTI'], 'broken.vti');
const vtiMime = FILE_EXT_TO_MIME.vti;
const stlMime = FILE_EXT_TO_MIME.stl;
const originalReaders = new Map([
  [vtiMime, FILE_READERS.get(vtiMime)!],
  [stlMime, FILE_READERS.get(stlMime)!],
]);
let slowEntered = defer<void>();
let slowGate = defer<void>();

beforeEach(() => {
  activateAppPinia();
  slowEntered = defer<void>();
  slowGate = defer<void>();
  // Run the production codecs in process; only their Worker transport differs.
  FILE_READERS.set(vtiMime, async (file) => {
    if (file.name === 'pending.vti') {
      slowEntered.resolve();
      await slowGate.promise;
    }
    const dataObject = await readFile(file, vtkXMLImageDataReader);
    const headerMetadata = file.name.endsWith('.seg.vti')
      ? buildSegNrrdMetadata(
          [{ value: 1, name: 'Tumor', color: [0, 0, 255, 255], visible: true }],
          [4, 4, 2]
        )
      : undefined;
    return { dataObject, headerMetadata };
  });
  FILE_READERS.set(stlMime, async (file) => ({
    dataObject: await readFile(file, vtkSTLReader, false),
  }));
});

afterEach(() => {
  originalReaders.forEach((reader, mime) => FILE_READERS.set(mime, reader));
  vi.restoreAllMocks();
});

const openImage = async (name: string) => {
  const ids = await loadFiles([imageFile(name)]);
  expect(ids).toHaveLength(1);
  return ids![0];
};
const picker = (imageId: string) => {
  const wrapper = mount(SegmentAssignmentList, {
    props: { imageId },
    global: {
      stubs: {
        VList: { template: '<ul><slot /></ul>' },
        VListItem: { template: '<li><slot /></li>' },
        VListItemTitle: { template: '<span class="title"><slot /></span>' },
      },
    },
  });
  return () => wrapper.findAll('.title').map((title) => title.text());
};
const paintedName = (imageId: string) => {
  strokeAt(imageId, [1, 1, 0]);
  const store = useSegmentationStore();
  const [maskId] = store.getSegmentationForImage(imageId)!.order;
  expect(markedVoxels(maskId)!.length).toBeGreaterThan(0);
  return useSegmentStore().segments.appearanceOf(
    store.getMask(maskId).segmentId
  ).name;
};
const duringPendingImage = async (check: () => Promise<void>) => {
  const pending = loadFiles([imageFile('pending.vti')]);
  await slowEntered.promise;
  try {
    await check();
  } finally {
    slowGate.resolve();
    await pending;
  }
};

describe('image segment initialization through public loading', () => {
  it.each(['configured', 'borrowed'] as const)(
    'keeps %s definitions usable while an unrelated image is unfinished',
    async (source) => {
      if (source === 'configured') await loadFiles([configFile('Liver')]);
      else {
        const first = await openImage('first.vti');
        useSegmentStore().segments.addSegment(first, { name: 'Liver' });
      }
      await duringPendingImage(async () => {
        const completed = await openImage('completed.vti');
        expect(useLoadDataStore().isLoading).toBe(true);
        useViewStore().setDataForAllViews(completed);
        await nextTick();
        expect(picker(completed)()).toEqual(['Liver']);
        expect(paintedName(completed)).toBe('Liver');
      });
    }
  );

  it('seeds configured defaults with no other operation pending', async () => {
    await loadFiles([configFile('Liver')]);
    const completed = await openImage('completed.vti');
    expect(picker(completed)()).toEqual(['Liver']);
    expect(paintedName(completed)).toBe('Liver');
  });

  it('uses its accompanying segmentation before borrowed defaults', async () => {
    await loadFiles([configFile('Liver')]);
    await duringPendingImage(async () => {
      const ids = await loadFiles([
        imageFile('scan.vti'),
        imageFile('scan.seg.vti', true),
      ]);
      const views = useViewStore();
      const imageId = views.getView(views.activeView)!.dataID!;
      expect(ids).toContain(imageId);
      expect(picker(imageId)()).toEqual(['Tumor']);
      expect(paintedName(imageId)).toBe('Tumor');
    });
  });

  it('keeps a published image reserved for its own unread companion config', async () => {
    await loadFiles([configFile('Liver')]);
    const config = configFile('Tumor');
    const readText = config.text.bind(config);
    const configEntered = defer<void>();
    const configGate = defer<void>();
    vi.spyOn(config, 'text').mockImplementation(async () => {
      configEntered.resolve();
      await configGate.promise;
      return readText();
    });
    const published = defer<string>();
    const unsubscribe = useImageStore().$onAction(({ name, args, after }) => {
      if (name === 'addVTKImageData' && args[0] === 'owned.vti')
        after((id) => published.resolve(id));
    });
    const unrelated = loadFiles([imageFile('pending.vti')]);
    await slowEntered.promise;
    const own = loadFiles([imageFile('owned.vti'), config]);
    try {
      const imageId = await published.promise;
      await configEntered.promise;
      useViewStore().setDataForAllViews(imageId);
      await nextTick();
      const names = picker(imageId);
      expect(names()).toEqual([]);
      slowGate.resolve();
      await unrelated;
      await nextTick();
      expect(names()).toEqual([]);
      configGate.resolve();
      await own;
      await nextTick();
      expect(names()).toEqual(['Tumor']);
      expect(paintedName(imageId)).toBe('Tumor');
    } finally {
      unsubscribe();
      configGate.resolve();
      slowGate.resolve();
      await Promise.all([own, unrelated]);
    }
  });
});

describe('destination scope when companion data imports fail', () => {
  it.each(['files', 'collection', 'archive'] as const)(
    'does not apply the companion config to the active image through %s',
    async (container) => {
      const [active] = (await loadFiles([
        imageFile('active.vti'),
        configFile('Liver'),
      ]))!;
      const files = [badImage(), configFile('Tumor')];
      let ids: string[] | undefined;
      if (container === 'collection') {
        ids = await loadDataSources([
          { type: 'collection', sources: files.map(fileToDataSource) },
        ]);
      } else if (container === 'archive') {
        const zip = new JSZip();
        for (const file of files) zip.file(file.name, await file.text());
        ids = await loadFiles([
          new File(
            [await zip.generateAsync({ type: 'arraybuffer' })],
            'batch.zip'
          ),
        ]);
      } else ids = await loadFiles(files);
      await nextTick();
      expect(ids).toEqual([]);
      expect(picker(active)()).toEqual(['Liver']);
      expect(
        useSegmentStore().seedSegmentDefaults.map(({ name }) => name)
      ).toEqual(['Tumor']);
    }
  );

  it('keeps model-only companion config off the active image', async () => {
    const [active] = (await loadFiles([
      imageFile('active.vti'),
      configFile('Liver'),
    ]))!;
    const model = new File(
      [
        `solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid triangle`,
      ],
      'triangle.stl'
    );
    await loadFiles([model, configFile('Tumor')]);
    expect(picker(active)()).toEqual(['Liver']);
  });

  it.each([false, true])(
    'still applies standalone config with a pre-state failure of %s',
    async (failPreState) => {
      const [active] = (await loadFiles([
        imageFile('active.vti'),
        configFile('Liver'),
      ]))!;
      registerConfigSection({
        key: 'loadingBoundaryFailure',
        schema: z.boolean().optional(),
        apply: (value) => {
          if (value) throw new Error('Unavailable config section');
        },
      });
      await loadFiles([
        configFile('Tumor', { loadingBoundaryFailure: failPreState }),
      ]);
      expect(picker(active)()).toEqual(['Tumor']);
    }
  );
});
