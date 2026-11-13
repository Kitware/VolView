export async function openDicomConsumer(url: string, expectedError?: string) {
  await browser.url(url);
  await waitForDicomConsumer(expectedError);
}

export async function waitForDicomConsumer(
  expectedError?: string,
  status = 'complete'
) {
  await browser.waitUntil(
    async () =>
      (await $('#error').isExisting()) ||
      ((await $('#status').isExisting()) &&
        (await $('#status').getText()) === status)
  );
  if (expectedError) {
    await expect($('#error')).toHaveText(expectedError);
    return;
  }
  if (await $('#error').isExisting())
    throw new Error(await $('#error').getText());
  await expect($('#status')).toHaveText(status);
}
