import { DOWNLOAD_TIMEOUT } from '../wdio.shared.conf';

export async function openDicomPage(url: string, expectedError?: string) {
  await browser.url(url);
  await waitForDicomPage(expectedError);
}

export async function waitForDicomPage(
  expectedError?: string,
  status = 'complete'
) {
  await browser.waitUntil(
    async () =>
      (await $('#error').isExisting()) ||
      ((await $('#status').isExisting()) &&
        (await $('#status').getText()) === status),
    { timeout: DOWNLOAD_TIMEOUT }
  );
  if (expectedError) {
    await expect($('#error')).toHaveText(expectedError);
    return;
  }
  if (await $('#error').isExisting())
    throw new Error(await $('#error').getText());
  await expect($('#status')).toHaveText(status);
}
