export async function closeMenuWithEscape(activator: WebdriverIO.Element) {
  const id = await activator.getAttribute('aria-controls');
  expect(id).toBeTruthy();
  const content = $(`[id="${id}"] .v-overlay__content`);
  if ((await activator.getAttribute('aria-expanded')) === 'true') {
    await content.waitForDisplayed();
    await content.waitForStable();
    await browser.keys('Escape');
    await expect(activator).toHaveAttribute('aria-expanded', 'false');
  }
  await content.waitForDisplayed({ reverse: true, opacityProperty: false });
}
