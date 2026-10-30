import { volViewPage } from '../pageobjects/volview.page';

export async function setReferenceLinesEnabled(enabled: boolean) {
  await browser.keys('Escape');
  await $('header').moveTo();
  await browser.waitUntil(
    async () => (await $$('.Vue-Toastification__toast').length) === 0
  );
  const settings = $('button[data-testid="control-button-Settings"]');
  await settings.waitForClickable();
  await settings.click();
  const label = $('label*=Reference Lines');
  await label.waitForClickable();
  const input = $('[data-testid="reference-lines-switch"] input');
  if ((await input.isSelected()) !== enabled) await label.click();
  await expect(label).toHaveText(
    expect.stringContaining(enabled ? 'On' : 'Off')
  );
  await browser.keys('Escape');
  await expect(label).not.toBeDisplayed();
}

/** Opens VolView with reference lines on for the suite, then turns them off. */
export function useReferenceLines() {
  before(async () => {
    await volViewPage.open();
    await setReferenceLinesEnabled(true);
  });
  after(async () => setReferenceLinesEnabled(false));
}
