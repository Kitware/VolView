import { volViewPage } from '../pageobjects/volview.page';

export async function setReferenceLinesEnabled(enabled: boolean) {
  await $('header').moveTo();
  await browser.waitUntil(
    async () => (await $$('.Vue-Toastification__toast').length) === 0
  );
  const dialog = await volViewPage.openSettings();
  const label = dialog.$('label*=Reference Lines');
  await label.waitForClickable();
  const input = dialog.$('[data-testid="reference-lines-switch"] input');
  if ((await input.isSelected()) !== enabled) await label.click();
  await expect(label).toHaveText(
    expect.stringContaining(enabled ? 'On' : 'Off')
  );
  await volViewPage.closeSettings();
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
