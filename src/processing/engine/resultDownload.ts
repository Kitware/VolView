import { $fetch, canFetchUrl } from '@/src/utils/fetch';
import type { ProcessingResult } from '@/src/processing/types';

export async function fetchProcessingResult(
  result: ProcessingResult
): Promise<File> {
  if (!canFetchUrl(result.url)) {
    throw new Error(`Cannot download unsupported URL: ${result.url}`);
  }

  const response = await $fetch(result.url, {
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(
      `Result download failed: ${response.status} ${response.statusText}`
    );
  }

  const blob = await response.blob();
  return new File([blob], result.name, {
    type: result.mimeType ?? blob.type,
  });
}
