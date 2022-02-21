/**
 * Percent is in [0, 1]. If it's negative, then the progress is indeterminate.
 */
export type ProgressCallback = (percent: number) => void;

export async function fetchFileWithProgress(
  url: string,
  name: string,
  progress: ProgressCallback,
  options: RequestInit | undefined
): Promise<File | null> {
  const response = await fetch(url, options);
  const contentLength = Number(response.headers.get('content-length')) || 0;

  if (contentLength <= 0) {
    progress(0);

    const blob = await response.blob();
    return new File([blob], name);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }

  const bytes = new Uint8Array(contentLength);
  let recv = 0;
  let done = false;
  do {
    // eslint-disable-next-line no-await-in-loop
    const readData = await reader.read();
    done = readData.done;
    if (readData.value && !done) {
      bytes.set(readData.value, recv);
      recv += readData.value.length;
      progress(recv / contentLength);
    }
  } while (!done);

  return new File([bytes], name);
}
