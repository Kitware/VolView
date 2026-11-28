import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { createSaveDownload, type Scratch } from '../scratch';

/** `stylePath` for a visual check that leaves out the view overlays. */
export const HIDE_VIEW_ANNOTATIONS = fileURLToPath(
  new URL('./hideViewAnnotations.css', import.meta.url)
);

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole text equal to `text`, ignoring surrounding whitespace. */
export const exactText = (text: string) =>
  new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);

/** Case-sensitive substring. */
export const containsText = (text: string) => new RegExp(escapeRegExp(text));

const VIEWS_2D =
  'div[data-testid~="vtk-two-view"], div[data-testid~="vtk-cine-view"]';
const VIEW_3D = 'div[data-testid="vtk-view vtk-volume-view"]';
const TRANSITIONING = '[class*="-enter-active"], [class*="-leave-active"]';

/**
 * Waits until no Vue transition or finite animation moves `locator`, whether it
 * runs on the element, inside it, or on an ancestor sliding it in.
 */
export const waitForTransitions = (locator: Locator, message?: string) =>
  expect
    .poll(
      () =>
        locator.evaluate((element, selector) => {
          if (element.closest(selector) || element.querySelector(selector))
            return true;
          return document.getAnimations().some((animation) => {
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return (
              animation.playState === 'running' &&
              Number.isFinite(animation.effect?.getComputedTiming().endTime) &&
              !!target &&
              (target.contains(element) || element.contains(target))
            );
          });
        }, TRANSITIONING),
      { message: message ?? 'Expected the element to finish moving' }
    )
    .toBe(false);

/**
 * Rendered and not transparent, whatever its size. `toBeVisible` rejects a
 * zero-height box such as a horizontal SVG line.
 */
export const expectDisplayed = async (locator: Locator, message?: string) => {
  await expect(locator, message).toBeAttached();
  await expect
    .poll(
      () =>
        locator.evaluate((element) =>
          element.checkVisibility({
            opacityProperty: true,
            visibilityProperty: true,
          })
        ),
      { message: message ?? 'Expected the element to be displayed' }
    )
    .toBe(true);
};

// Vue inputs ignore a programmatic clear, so select all and type over it.
export const setValueVueInput = async (input: Locator, value: string) => {
  await input.click();
  if (await input.inputValue()) {
    await input.page().keyboard.press('ControlOrMeta+a');
    await input.page().keyboard.press('Backspace');
  }
  await input.pressSequentially(value);
};

// Steps a focused slider with one held key. A press per step would wait on the
// page between steps.
export const holdKey = async (page: Page, key: string, repeats: number) => {
  if (repeats === 0) return;
  await Promise.all(
    Array.from({ length: repeats }, () => page.keyboard.down(key))
  );
  await page.keyboard.up(key);
};

export const createVolViewPage = (page: Page, scratch: Scratch) => {
  const saveDownload = createSaveDownload(page, scratch);
  const samplesList = page.locator('div[data-testid="samples-list"]');
  const prostateSample = samplesList.locator('div[title="MRI PROSTATEx"]');
  const layoutButton = page.locator(
    'button[data-testid="control-button-Layouts"]'
  );
  const notifications = page.locator('#notifications');
  const views2D = page.locator(VIEWS_2D);
  const processPreviewButton = page.locator('button', {
    hasText: containsText('Preview'),
  });
  const processApplyButton = page.locator('button', {
    hasText: containsText('Apply'),
  });
  const processModeButton = page
    .locator('button', { hasText: containsText('Process') })
    .first();
  const processTypeSelector = page.locator(
    '[data-testid="process-type-selector"]'
  );
  const fillHolesProcessOption = page.locator(
    '[data-testid="process-type-fillHoles"]'
  );
  const saveButton = page.locator('button span i[class~=mdi-content-save-all]');
  const saveSessionFilenameInput = page.locator('#session-state-filename');
  const saveSessionConfirmButton = page.locator(
    'span[data-testid="save-session-confirm-button"]'
  );
  const saveSegmentsButtons = page.locator(
    'button[data-testid="save-segments-button"]'
  );
  const activeDialog = page.locator('div[role="dialog"]').first();
  const settingsDialog = page.locator(
    '.v-dialog.v-overlay--active .closeable-dialog'
  );

  const open = (url = '/') => page.goto(url);

  const waitForViews = (expectation = expect) =>
    expectation
      .poll(
        () =>
          page.evaluate(() =>
            Array.from(
              document.querySelectorAll('div[data-testid~="vtk-view"] canvas')
            ).some((c) => {
              // A canvas carries its default 300x300 attributes before it is
              // laid out, so its box on the page has to have a size as well.
              const canvas = c as HTMLCanvasElement;
              const box = canvas.getBoundingClientRect();
              return (
                canvas.width > 10 &&
                canvas.height > 10 &&
                box.width > 10 &&
                box.height > 10
              );
            })
          ),
        {
          message:
            'expected at least 1 view to be rendered with real dimensions',
        }
      )
      .toBe(true);

  const getNotificationsCount = async () => {
    const text = await notifications
      .locator('span[aria-label="Badge"]')
      .innerText();
    return text === '' ? 0 : parseInt(text, 10);
  };

  const waitForNotification = () =>
    expect
      .poll(getNotificationsCount, {
        message: 'expected notification badge to display',
      })
      .toBeGreaterThanOrEqual(1);

  /** Opens the message center once no toast covers its button. */
  const openNotifications = async () => {
    await expect(page.locator('.Vue-Toastification__toast')).toHaveCount(0);
    await notifications.click();
  };

  const getNotificationTitles = async () => {
    await openNotifications();
    const titles = page.locator(
      '.message-center .v-expansion-panel-title .header > span'
    );
    await expect(titles.first()).toBeVisible();
    return titles.allInnerTexts();
  };

  const selectTool = (icon: string) =>
    page.locator(`button.tool-btn i[class~=${icon}]`).click();

  const selectFillHolesProcess = async () => {
    await processTypeSelector.click();
    await fillHolesProcessOption.click();
  };

  const runFillHoles = async () => {
    await processModeButton.click();
    await selectFillHolesProcess();
    await processPreviewButton.click();
    // Reaching the "previewing" state (Apply appears) only happens after the
    // algorithm runs successfully on the label map.
    await processApplyButton.click();
    // Applying returns the workflow to its start state (Preview reappears).
    await expect(processPreviewButton).toBeVisible();
  };

  /** A square loop starting `offsetX` pixels right of the view's center. */
  const paintStrokeOnView = async (view: Locator, offsetX = 0) => {
    const box = await view.locator('canvas').boundingBox();
    if (!box) throw new Error('The view has no canvas on screen');
    const centerX = Math.round(box.x + box.width / 2) + offsetX;
    const centerY = Math.round(box.y + box.height / 2);
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 40, centerY);
    await page.mouse.move(centerX + 40, centerY + 40);
    await page.mouse.move(centerX, centerY + 40);
    await page.mouse.move(centerX, centerY);
    await page.mouse.up();
  };

  const clickSaveSegmentsButton = async () => {
    await expect(saveSegmentsButtons.first()).toBeAttached();
    await saveSegmentsButtons.first().click();
  };

  /** Saves a session under TEMP_DIR and returns its file name. */
  const saveSession = async () => {
    await saveButton.click();
    await setValueVueInput(
      saveSessionFilenameInput,
      `${randomUUID()}-session.volview.zip`
    );
    const filePath = await saveDownload(() => saveSessionConfirmButton.click());
    return path.basename(filePath);
  };

  const getVolumeRenderingSection = () => page.locator('div.pwf-editor');

  const getView3D = async () => {
    const view3D = page.locator(VIEW_3D);
    return (await view3D.count()) ? view3D : undefined;
  };

  const getView2D = async () => {
    const view2D = views2D.first();
    return (await view2D.count()) ? view2D : undefined;
  };

  const waitForViewCounts = (
    expected2DCount: number,
    expected3DExists: boolean
  ) =>
    expect
      .poll(
        () =>
          page.evaluate(
            ([views2DSelector, view3DSelector]) => ({
              view2DCount: document.querySelectorAll(views2DSelector).length,
              view3DExists: document.querySelector(view3DSelector) !== null,
            }),
            [VIEWS_2D, VIEW_3D]
          ),
        {
          message: `Expected ${expected2DCount} 2D views and ${
            expected3DExists ? 'a' : 'no'
          } 3D view`,
        }
      )
      .toEqual({
        view2DCount: expected2DCount,
        view3DExists: expected3DExists,
      });

  const menuContent = (contentId: string) =>
    page.locator(`[id="${contentId}"] > .v-overlay__content`);

  const openMenu = async (activator: Locator) => {
    await expect(activator).toBeVisible();
    if ((await activator.getAttribute('aria-expanded')) !== 'true')
      await activator.click();
    await expect(activator).toHaveAttribute('aria-expanded', 'true');
    const contentId = await activator.getAttribute('aria-controls');
    if (!contentId) throw new Error('Menu activator has no linked content');
    const content = menuContent(contentId);
    await expect(content).toBeVisible();
    await waitForTransitions(content);
    return content;
  };

  const closeMenu = async (activator: Locator) => {
    const contentId = await activator.getAttribute('aria-controls');
    if ((await activator.getAttribute('aria-expanded')) === 'true') {
      // Wait for the opening transition before Escape can dismiss the popup.
      if (contentId) {
        await expect(menuContent(contentId)).toBeVisible();
        await waitForTransitions(menuContent(contentId));
      }
      // A tall popup can cover its activator in a compact pane.
      await page.keyboard.press('Escape');
    }
    await expect(activator).toHaveAttribute('aria-expanded', 'false');
    if (contentId) await expect(menuContent(contentId)).toBeHidden();
  };

  const openSettings = async () => {
    if (!(await settingsDialog.isVisible()))
      await page
        .locator('button[data-testid="control-button-Settings"]')
        .click();
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.locator('.v-card-title')).toHaveText(
      'Settings'
    );
    await waitForTransitions(settingsDialog);
    return settingsDialog;
  };

  const closeSettings = async () => {
    await expect(settingsDialog.locator('.v-card-title')).toHaveText(
      'Settings'
    );
    // The active class leaves on close, so follow the element itself out.
    const dialog = await settingsDialog.elementHandle();
    await settingsDialog.locator('button.close-button').click();
    await dialog?.waitForElementState('hidden');
  };

  const openLayoutMenu = async (minOptionCount = 1) => {
    const menu = await openMenu(layoutButton);
    await expect
      .poll(() => menu.locator('.v-list-item').count(), {
        message: `Expected layout menu to show at least ${minOptionCount} layout options`,
      })
      .toBeGreaterThanOrEqual(minOptionCount);
    return menu;
  };

  const getLayoutOptionTitles = () =>
    page.evaluate((titleSelector) => {
      const items = Array.from(document.querySelectorAll(titleSelector));
      return items.map((item) => item.textContent?.trim() ?? '');
    }, '.v-list-item-title');

  const selectLayoutOption = (targetText: string) =>
    page.evaluate(
      ([text, titleSelector]) => {
        const items = Array.from(document.querySelectorAll(titleSelector));
        const targetItem = items.find(
          (item) => item.textContent?.trim() === text
        );
        if (!targetItem) return;
        const listItem = targetItem.closest(
          '.v-list-item'
        ) as HTMLElement | null;
        listItem?.click();
      },
      [targetText, '.v-list-item-title']
    );

  const focusFirst2DView = async () => {
    if (!(await views2D.count()))
      throw new Error('No 2D views rendered to focus');
    await views2D.first().locator('canvas').click();
  };

  const getFirst2DSlice = () =>
    page.evaluate((selector) => {
      const views = document.querySelectorAll(selector);
      if (views.length === 0) return undefined;
      const match = views[0].textContent?.match(/Slice:\s*(\d+)/);
      return match ? parseInt(match[1], 10) : undefined;
    }, VIEWS_2D);

  const waitForSliceDecrease = (initialSlice: number | undefined) =>
    expect
      .poll(
        async () => {
          const currentSlice = await getFirst2DSlice();
          if (initialSlice === undefined) return currentSlice !== undefined;
          return currentSlice !== undefined && currentSlice < initialSlice;
        },
        { message: 'Expected slice to decrease after advancing' }
      )
      .toBe(true);

  const advanceSliceAndWait = async () => {
    const initialSlice = await getFirst2DSlice();
    await page.keyboard.press('ArrowDown');
    await waitForSliceDecrease(initialSlice);
  };

  /** Every view has a sized canvas and none is still loading its image. */
  const waitForViewsLoaded = () =>
    expect
      .poll(
        () =>
          page.evaluate(() => {
            const canvases = Array.from(
              document.querySelectorAll<HTMLCanvasElement>(
                'div[data-testid~="vtk-view"] canvas'
              )
            );
            return (
              canvases.length > 0 &&
              canvases.every(
                ({ width, height }) => width > 10 && height > 10
              ) &&
              !document.querySelector('.loading-indicator')
            );
          }),
        { message: 'Expected every view to finish loading' }
      )
      .toBe(true);

  const volumeCards = page.locator('.volume-card');

  /** Waits for the volume cards' "[N]" slice counts, ascending, to be `expected`. */
  const waitForVolumeCardSliceCounts = (expected: number[]) =>
    expect
      .poll(
        async () =>
          (await volumeCards.allInnerTexts())
            .map((label) => Number(label.match(/\[(\d+)\]/)?.[1]))
            .filter(Number.isFinite)
            .sort((a, b) => a - b),
        {
          message: `expected volume cards holding ${expected.join(', ')} slices`,
        }
      )
      .toEqual(expected);

  /** Deletes the volume whose card label carries `[sliceCount]`. */
  const deleteVolumeCard = async (sliceCount: number) => {
    await volumeCards
      .filter({ hasText: `[${sliceCount}]` })
      .locator('button[data-testid="dataset-menu-button"]')
      .click();
    await page
      .locator('.v-overlay-container .v-list-item', {
        hasText: exactText('Delete'),
      })
      .click();
  };

  const waitForLoadingIndicator = (view: Locator) =>
    expect
      .poll(
        () =>
          view.evaluate((element) => {
            const container = element.closest(
              '[data-testid="two-view-container"]'
            );
            return (
              !!container && !container.querySelector('.loading-indicator')
            );
          }),
        { message: 'Expected loading indicator to disappear' }
      )
      .toBe(true);

  return {
    open,
    samplesList,
    prostateSample,
    downloadProstateSample: () => prostateSample.click(),
    views: page.locator('div[data-testid~="vtk-view"] canvas'),
    views2D,
    layoutButton,
    waitForViews,
    notifications,
    getNotificationsCount,
    waitForNotification,
    openNotifications,
    getNotificationTitles,
    selectTool,
    activateRectangle: () => selectTool('mdi-vector-square'),
    activatePaint: () => selectTool('mdi-brush'),
    processModeButton,
    processTypeSelector,
    fillHolesProcessOption,
    fillHolesWholeVolumeButton: page.locator('button', {
      hasText: containsText('All slices'),
    }),
    fillHolesSelectedSegmentButton: page.locator('button', {
      hasText: containsText('Selected segment'),
    }),
    processPreviewButton,
    processApplyButton,
    processOriginalButton: page.locator('button', {
      hasText: containsText('Original'),
    }),
    processProcessedButton: page.locator('button', {
      hasText: containsText('Processed'),
    }),
    // The selected button in a Vuetify v-btn-toggle carries v-btn--active.
    isPreviewToggleActive: async (button: Locator) =>
      ((await button.getAttribute('class')) ?? '').includes('v-btn--active'),
    paintStrokeOnView,
    runFillHoles,
    selectFillHolesProcess,
    viewTwoContainer: page.locator('div[data-testid~="two-view-container"]'),
    saveButton,
    annotationsModuleTab: page.locator(
      'button[data-testid="module-tab-Annotations"]'
    ),
    activeDialog,
    saveSessionFilenameInput,
    saveSessionConfirmButton,
    saveSegmentsButtons,
    segmentList: page.locator('[data-testid="segment-list"]'),
    saveSegmentsFilenameInput: activeDialog.locator('#filename'),
    saveSegmentsConfirmButton: activeDialog.locator('button', {
      hasText: exactText('Save'),
    }),
    clickSaveSegmentsButton,
    saveSession,
    segmentStrokeWidthSlider: page.locator(
      '[role="slider"][aria-label="Stroke Width"]'
    ),
    editLabelModalDoneButton: page.locator(
      'button[data-testid="segment-editor-done-button"]'
    ),
    datasetMenuButtons: page.locator(
      'button[data-testid="dataset-menu-button"]'
    ),
    renderingModuleTab: page.locator(
      'button[data-testid="module-tab-Rendering"]'
    ),
    layerOpacitySliders: page.locator(
      'div[data-testid="layer-opacity-slider"]'
    ),
    getVolumeRenderingSection,
    getView3D,
    getView2D,
    waitForViewCounts,
    openMenu,
    closeMenu,
    openSettings,
    closeSettings,
    openLayoutMenu,
    getLayoutOptionTitles,
    selectLayoutOption,
    focusFirst2DView,
    getFirst2DSlice,
    waitForSliceDecrease,
    advanceSliceAndWait,
    waitForLoadingIndicator,
    waitForViewsLoaded,
    volumeCards,
    waitForVolumeCardSliceCounts,
    deleteVolumeCard,
  };
};

export type VolViewPage = ReturnType<typeof createVolViewPage>;
