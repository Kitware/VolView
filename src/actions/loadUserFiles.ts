import { fileToDataSource, uriToDataSource } from '@/src/io/import/dataSource';
import useLoadDataStore from '@/src/store/load-data';
import { wrapInArray } from '@/src/utils';
import { basename } from '@/src/utils/path';
import { parseUrl } from '@/src/utils/url';
import { UrlParams } from '@vueuse/core';

export function openFileDialog() {
  return new Promise<File[]>((resolve) => {
    const fileEl = document.createElement('input');
    fileEl.setAttribute('type', 'file');
    fileEl.setAttribute('multiple', 'multiple');
    fileEl.setAttribute('accept', '*');
    fileEl.addEventListener('change', () => {
      const files = [...(fileEl.files ?? [])];
      resolve(files);
    });
    fileEl.click();
  });
}

export async function loadFiles(files: File[]) {
  const dataSources = files.map(fileToDataSource);
  return useLoadDataStore().loadDataSources(dataSources);
}

export async function loadUserPromptedFiles() {
  const files = await openFileDialog();
  return loadFiles(files);
}

export async function loadUrls(params: UrlParams) {
  const urls = wrapInArray(params.urls);
  const names = wrapInArray(params.names ?? []); // optional names should resolve to [] if params.names === undefined
  const sources = urls.map((url, idx) =>
    uriToDataSource(
      url,
      names[idx] ||
        basename(parseUrl(url, window.location.href).pathname) ||
        url
    )
  );

  return useLoadDataStore().loadDataSources(sources);
}
