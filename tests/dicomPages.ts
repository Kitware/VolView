import { expect, type Page } from '@playwright/test';

export const waitForDicomPage = async (
  page: Page,
  expectedError?: string,
  status = 'complete'
) => {
  const error = page.locator('#error');
  const statusText = page.locator('#status');
  await expect
    .poll(
      async () =>
        (await error.count()) > 0 ||
        ((await statusText.count()) > 0 &&
          (await statusText.innerText()) === status),
      { message: `Expected the DICOM page to reach "${status}" or an error` }
    )
    .toBe(true);
  if (expectedError) {
    await expect(error).toHaveText(expectedError);
    return;
  }
  if (await error.count()) throw new Error(await error.innerText());
  await expect(statusText).toHaveText(status);
};

export const openDicomPage = async (
  page: Page,
  url: string,
  expectedError?: string
) => {
  await page.goto(url);
  await waitForDicomPage(page, expectedError);
};
