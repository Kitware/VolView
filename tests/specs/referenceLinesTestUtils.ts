import { expect, type Page } from '@playwright/test';
import { containsText, createVolViewPage } from '../pageobjects/volview.page';
import type { Scratch } from '../scratch';
import { createUtils } from './utils';

export const createReferenceLinesUtils = (page: Page, scratch: Scratch) => {
  const volview = createVolViewPage(page, scratch);
  const utils = createUtils(page, scratch);

  const setReferenceLinesEnabled = async (enabled: boolean) => {
    await utils.moveToElement(page.locator('header'));
    await expect(page.locator('.Vue-Toastification__toast')).toHaveCount(0);
    const dialog = await volview.openSettings();
    const label = dialog.locator('label', {
      hasText: containsText('Reference Lines'),
    });
    const input = dialog.locator(
      '[data-testid="reference-lines-switch"] input'
    );
    if ((await input.isChecked()) !== enabled) await label.click();
    await expect(label).toContainText(enabled ? 'On' : 'Off');
    await volview.closeSettings();
    await expect(label).toBeHidden();
  };

  return { setReferenceLinesEnabled };
};

export type ReferenceLinesUtils = ReturnType<typeof createReferenceLinesUtils>;
