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
import { useDatasetStore } from '@/src/store/datasets';
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
const gatedConfig = (name: string) => {
  const file = configFile(name);
  const readText = file.text.bind(file);
  const entered = defer<void>();
  const gate = defer<void>();
  vi.spyOn(file, 'text').mockImplementation(async () => {
    entered.resolve();
    await gate.promise;
    return readText();
  });
  return { file, entered: entered.promise, release: () => gate.resolve() };
};
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
const loadContainedFiles = async (
  container: 'files' | 'collection' | 'archive',
  files: File[]
) => {
  if (container === 'collection')
    return loadDataSources([
      { type: 'collection', sources: files.map(fileToDataSource) },
    ]);
  if (container === 'archive') {
    const zip = new JSZip();
    for (const file of files) zip.file(file.name, await file.text());
    return loadFiles([
      new File([await zip.generateAsync({ type: 'arraybuffer' })], 'batch.zip'),
    ]);
  }
  return loadFiles(files);
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
    const {
      file: config,
      entered: configEntered,
      release: releaseConfig,
    } = gatedConfig('Tumor');
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
      await configEntered;
      useViewStore().setDataForAllViews(imageId);
      await nextTick();
      const names = picker(imageId);
      expect(names()).toEqual([]);
      slowGate.resolve();
      await unrelated;
      await nextTick();
      expect(names()).toEqual([]);
      releaseConfig();
      await own;
      await nextTick();
      expect(names()).toEqual(['Tumor']);
      expect(paintedName(imageId)).toBe('Tumor');
    } finally {
      unsubscribe();
      releaseConfig();
      slowGate.resolve();
      await Promise.all([own, unrelated]);
    }
  });
});

describe('standalone config destination during asynchronous loading', () => {
  it.each([
    'focus changed',
    'no initial image',
    'initial image removed',
  ] as const)(
    'keeps the destination captured when loading began: %s',
    async (transition) => {
      const initial =
        transition === 'no initial image'
          ? undefined
          : (await loadFiles([
              imageFile('initial.vti'),
              configFile('Liver'),
            ]))![0];
      let unrelated: string | undefined;
      if (transition === 'focus changed') {
        [unrelated] = (await loadFiles([
          imageFile('unrelated.vti'),
          configFile('Kidney'),
        ]))!;
        useViewStore().setDataForAllViews(initial!);
      }

      const {
        file: config,
        entered: configEntered,
        release: releaseConfig,
      } = gatedConfig('Tumor');
      const loading = loadFiles([config]);
      try {
        await configEntered;
        if (transition === 'initial image removed')
          useDatasetStore().remove(initial!);
        if (transition !== 'focus changed')
          unrelated = await openImage('unrelated.vti');
        useViewStore().setDataForAllViews(unrelated!);
        await nextTick();
        const names = picker(unrelated!);
        const expected =
          transition === 'focus changed'
            ? ['Kidney']
            : transition === 'initial image removed'
              ? ['Liver']
              : [];
        expect(names()).toEqual(expected);

        releaseConfig();
        await loading;
        await nextTick();
        expect(names()).toEqual(expected);
        if (transition === 'focus changed')
          expect(picker(initial!)()).toEqual(['Tumor']);
        if (transition === 'initial image removed')
          expect(
            useSegmentStore().segments.imageSets.value[initial!]
          ).toBeUndefined();
        expect(
          useSegmentStore().seedSegmentDefaults.map(({ name }) => name)
        ).toEqual(['Tumor']);
      } finally {
        releaseConfig();
        await loading;
      }
    }
  );

  it.each(
    (['files', 'collection', 'archive'] as const).flatMap((container) => [
      {
        container,
        failure: 'recognized config validation',
        contents: JSON.stringify({ segments: 17 }),
        expected: ['Tumor'],
      },
      {
        container,
        failure: 'unrecognized JSON syntax',
        contents: '{',
        expected: ['Liver'],
      },
    ])
  )(
    'keeps standalone config scope with a $failure failure through $container',
    async ({ container, contents, expected }) => {
      const [active] = (await loadFiles([
        imageFile('active.vti'),
        configFile('Liver'),
      ]))!;
      const setError = vi.spyOn(useLoadDataStore(), 'setError');
      const ids = await loadContainedFiles(container, [
        configFile('Tumor'),
        new File([contents], 'invalid-config.json'),
      ]);
      await nextTick();
      expect(ids).toEqual([]);
      expect(picker(active)()).toEqual(expected);
      expect(
        useSegmentStore().seedSegmentDefaults.map(({ name }) => name)
      ).toEqual(['Tumor']);
      expect(setError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.stringContaining('invalid-config.json'),
        })
      );
    }
  );
});

describe('destination scope when companion data imports fail', () => {
  it.each(['files', 'collection', 'archive'] as const)(
    'does not apply the companion config to the active image through %s',
    async (container) => {
      const [active] = (await loadFiles([
        imageFile('active.vti'),
        configFile('Liver'),
      ]))!;
      const ids = await loadContainedFiles(container, [
        badImage(),
        configFile('Tumor'),
      ]);
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
