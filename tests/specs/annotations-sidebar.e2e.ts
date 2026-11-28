import { test, expect } from '../fixtures';
import { setValueVueInput } from '../pageobjects/volview.page';
import { PROSTATEX_DATASET } from '../datasets';
import type { VolViewPage } from '../pageobjects/volview.page';
import type { AnnotationUtils } from './annotationTestUtils';

const placeRectangle = async (
  volview: VolViewPage,
  annotation: AnnotationUtils
) => {
  const placed = await annotation.setupTest();
  await volview.activateRectangle();
  await annotation.clickAt(placed.centerX - 60, placed.centerY - 60);
  await annotation.clickAt(placed.centerX + 60, placed.centerY + 60);
  await volview.selectTool('mdi-cursor-default');
  await annotation.waitForCircleCount(
    placed.axialView,
    2,
    'Placed rectangle should render both handles'
  );
  return placed;
};

// The sidebar sections are stacked rather than tabbed, so the Segments list is
// reachable whatever tool is active.
const DRAWING_TOOLS = [
  'mdi-vector-square',
  'mdi-pentagon-outline',
  'mdi-ruler',
  'mdi-brush',
];

test.describe('Annotations sidebar', () => {
  test('uses the annotation panel height immediately when switching from Rendering', async ({
    page,
    utils,
  }) => {
    await utils.openUrls([PROSTATEX_DATASET]);
    await page.locator('[data-testid="module-tab-Annotations"]').click();
    await expect(
      page.locator('[data-testid="measurements-section"]')
    ).toBeVisible();
    await page.locator('[data-testid="module-tab-Rendering"]').click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const panel = document.querySelector('.module-window')!;
            return [
              ...panel.querySelectorAll(
                '.v-window__container, .module-window-item'
              ),
            ].every((element) => element.getAnimations().length === 0);
          }),
        { message: 'Rendering panel transition did not finish' }
      )
      .toBe(true);

    const heights = await page.evaluate(
      () =>
        new Promise<{ available: number; maximum: number; final: number }>(
          (done) => {
            const container =
              document.querySelector<HTMLElement>('#module-container')!;
            const panel = document.querySelector('.module-window')!;
            let maximum = 0;
            const sample = () => {
              maximum = Math.max(maximum, container.scrollHeight);
              if (
                [
                  ...panel.querySelectorAll(
                    '.v-window__container, .module-window-item'
                  ),
                ]
                  .flatMap((element) => element.getAnimations())
                  .some((animation) => animation.playState === 'running')
              ) {
                requestAnimationFrame(sample);
              } else {
                done({
                  available: container.clientHeight,
                  maximum,
                  final: container.scrollHeight,
                });
              }
            };
            document
              .querySelector<HTMLElement>(
                '[data-testid="module-tab-Annotations"]'
              )!
              .click();
            requestAnimationFrame(sample);
          }
        )
    );

    expect(heights.final).toBe(heights.available);
    expect(heights.maximum).toBe(heights.available);
  });

  test('deletes a segment with its painted mask and measurement without a notification', async ({
    page,
    volview,
    annotation,
    segmentation,
  }) => {
    const { axialView } = await placeRectangle(volview, annotation);
    await volview.activatePaint();
    await volview.paintStrokeOnView(axialView);
    await segmentation.openAnnotationSegments();
    await segmentation.waitForSegmentContent('Segment 1');
    await expect(volview.saveSegmentsButtons.first()).toBeEnabled();
    await segmentation.openSegmentShapes();
    expect(await segmentation.shapeRowTexts()).toHaveLength(1);

    await segmentation.deleteSegment('Segment 1');
    expect(await segmentation.segmentNames()).toEqual([]);
    await expect(
      page.locator('[data-testid="segment-shape-row"]').first()
    ).not.toBeAttached();
    await expect(axialView.locator('svg rect').first()).not.toBeAttached();
    await expect(volview.saveSegmentsButtons.first()).toBeDisabled();
    await volview.notifications.click();
    await expect(page.locator('.message-center')).toBeVisible();
    const titles = await page
      .locator('.message-center .header > span')
      .allInnerTexts();
    expect(titles.some((title) => title.startsWith('Deleted '))).toBe(false);
  });

  test('keeps the Segments list in place and selected across tool switches', async ({
    page,
    volview,
    annotation,
    segmentation,
  }) => {
    await annotation.setupTest();

    await volview.activatePaint();
    await volview.paintStrokeOnView(volview.views2D.first());

    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    await segmentation.addSegment();
    await segmentation.renameSegment('Segment 2', 'Lesion');
    await segmentation.selectSegment('Lesion');

    const top = await segmentation.segmentListTop();
    expect(await segmentation.selectedSegmentName()).toEqual('Lesion');

    for (const icon of DRAWING_TOOLS) {
      await volview.selectTool(icon);
      await expect(page.locator('[data-testid="segment-list"]')).toBeVisible();
      expect(await segmentation.segmentNames()).toEqual([
        'Segment 1',
        'Lesion',
      ]);
      expect(await segmentation.selectedSegmentName()).toEqual('Lesion');
      expect(await segmentation.segmentListTop()).toEqual(top);
    }
  });

  test('creates and selects one segment when ruler placement begins', async ({
    volview,
    annotation,
    segmentation,
  }) => {
    const { centerX, centerY } = await annotation.setupTest();

    await volview.selectTool('mdi-ruler');
    await segmentation.openAnnotationSegments();
    expect(await segmentation.segmentNames()).toEqual([]);

    // vtk.js ignores the first pointer move after an idle period, and the
    // sidebar work above is one, so each end is nudged onto and then pressed.
    await annotation.nudgeTo(centerX - 40, centerY);
    await annotation.pressAtPointer();
    await segmentation.waitForNamedSegments();
    expect(await segmentation.segmentNames()).toEqual(['Segment 1']);
    expect(await segmentation.selectedSegmentName()).toEqual('Segment 1');
    await annotation.nudgeTo(centerX + 40, centerY);
    await annotation.pressAtPointer();

    await segmentation.waitForNamedSegments();
    expect(await segmentation.segmentNames()).toEqual(['Segment 1']);

    await segmentation.openSegmentShapes();
    const shapes = await segmentation.shapeRowTexts();
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatch(/mm/);
  });

  test('hides rendered annotations with their segment and preserves individually hidden shapes', async ({
    page,
    volview,
    annotation,
    segmentation,
  }) => {
    const { axialView, centerX, centerY } = await placeRectangle(
      volview,
      annotation
    );
    await segmentation.openAnnotationSegments();
    const row = await segmentation.segmentRow('Segment 1');
    await row.locator('button:has(i.mdi-eye)').click();
    await annotation.waitForCircleCount(
      axialView,
      0,
      'Hiding the segment should remove its rectangle widget'
    );

    // Removing the SVG alone would leave VTK handles pickable. The old handle
    // must not open its annotation menu after the segment is hidden.
    await annotation.rightClickAt(centerX - 60, centerY - 60);
    const menuTitles = await page
      .locator('.v-overlay--active .v-list-item-title')
      .allInnerTexts();
    expect(menuTitles).not.toContain('Delete Annotation');
    await row.locator('button:has(i.mdi-eye-off)').click();
    await annotation.waitForCircleCount(
      axialView,
      2,
      'Showing the segment should restore its rectangle'
    );

    await segmentation.openSegmentShapes();
    await page
      .locator('[data-testid="segment-shape-row"] button i[class~="mdi-eye"]')
      .click();
    await annotation.waitForCircleCount(
      axialView,
      0,
      'The child visibility control should hide the rectangle'
    );
    await page
      .locator('[data-testid="toggle-segments-visible-button"]')
      .click();
    await page
      .locator('[data-testid="toggle-segments-visible-button"]')
      .click();
    await annotation.waitForCircleCount(
      axialView,
      0,
      'Showing every segment must preserve a hidden child'
    );
    await page
      .locator(
        '[data-testid="segment-shape-row"] button i[class~="mdi-eye-off"]'
      )
      .click();
    await annotation.waitForCircleCount(
      axialView,
      2,
      'Showing the child should restore the same rectangle'
    );
  });

  test('hides the selection outline of a selected annotation with its segment', async ({
    page,
    volview,
    annotation,
    segmentation,
  }) => {
    const { axialView } = await placeRectangle(volview, annotation);

    // BoundingRectangle.vue draws this around the selected annotation.
    const outline = axialView.locator('svg rect[stroke="lightgray"]').first();
    expect((await outline.count()) > 0).toBe(false);

    await segmentation.openAnnotationSegments();
    const row = await segmentation.segmentRow('Segment 1');
    await segmentation.openSegmentShapes();
    await page
      .locator('[data-testid="segment-shape-row"] .v-checkbox-btn')
      .click();
    await expect(
      outline,
      'Selecting the rectangle should draw its selection outline'
    ).toBeAttached();

    await row.locator('button:has(i.mdi-eye)').click();
    await annotation.waitForCircleCount(
      axialView,
      0,
      'Hiding the segment should remove its selected rectangle'
    );
    await expect(
      outline,
      'Hiding the segment should remove the selection outline'
    ).not.toBeAttached();

    await row.locator('button:has(i.mdi-eye-off)').click();
    await annotation.waitForCircleCount(
      axialView,
      2,
      'Showing the segment should restore its rectangle'
    );
    await expect(
      outline,
      'Showing the segment should restore the selection outline'
    ).toBeAttached();
  });

  test('explains disabled controls and prevents the locked color button from opening the editor', async ({
    page,
    volview,
    utils,
    annotation,
    segmentation,
  }) => {
    await annotation.setupTest();
    await volview.selectTool('mdi-ruler');
    await segmentation.openAnnotationSegments();
    await segmentation.addSegment();
    await segmentation.lockSegment('Segment 1');
    const row = await segmentation.segmentRow('Segment 1');
    const controls = [
      {
        button: row.locator('[data-testid="segment-color-button"]'),
        reason: 'Unlock this segment to change its color',
      },
      {
        button: row.locator('[data-testid="edit-segment-button"]'),
        reason: 'Unlock this segment to edit it',
      },
      {
        button: row.locator('[data-testid="delete-segment-button"]'),
        reason: 'Unlock this segment to delete it',
      },
      {
        button: row.locator('[data-testid="reveal-segment-button"]'),
        reason: 'This segment has nothing on this image',
      },
      {
        button: page.locator('[data-testid="save-segments-button"]').first(),
        reason: 'Nothing is painted on this image yet',
      },
    ];
    for (const { button, reason } of controls) {
      expect(await button.isEnabled()).toBe(false);
      // Vuetify disables pointer events on the button, so hover its wrapper.
      await utils.moveToElement(button.locator('..'));
      await expect(
        page.locator('.v-tooltip.v-overlay--active .v-overlay__content')
      ).toHaveText(reason);
    }
    const dot = row.locator('[data-testid="segment-color-button"]');
    const box = await dot.boundingBox();
    if (!box) throw new Error('The color button is not on screen');
    await annotation.clickAt(box.x + box.width / 2, box.y + box.height / 2);
    const dialog = page.locator('div[role="dialog"]').first();
    expect(await dialog.isVisible()).toBe(false);
    expect(await segmentation.segmentNames()).toEqual(['Segment 1']);

    await row.locator('button i[class~="mdi-lock"]').click();
    await dot.click();
    await expect(dialog).toBeVisible();
    await volview.editLabelModalDoneButton.click();
    await expect(dialog).toBeHidden();
  });

  test('cancels segment edits with Escape while keeping tool shortcuts isolated', async ({
    page,
    volview,
    annotation,
    segmentation,
  }) => {
    await annotation.setupTest();
    await volview.selectTool('mdi-ruler');
    await segmentation.openAnnotationSegments();
    await segmentation.addSegment();
    const row = await segmentation.segmentRow('Segment 1');
    const edit = row.locator('[data-testid="edit-segment-button"]');
    const dialog = page.locator('div[role="dialog"]').first();
    const name = dialog.locator('.v-text-field input').first();
    const paint = page.locator('button.tool-btn:has(i.mdi-brush)');

    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await setValueVueInput(name, 'Discarded draft');
    await volview.editLabelModalDoneButton.focus();
    await page.keyboard.press('p');
    expect(await paint.getAttribute('class')).not.toContain(
      'tool-btn-selected'
    );
    await name.focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await segmentation.segmentNames()).toEqual(['Segment 1']);

    await edit.click();
    await expect(dialog).toBeVisible();
    expect(await name.inputValue()).toEqual('Segment 1');
    await setValueVueInput(name, 'Committed');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    expect(await segmentation.segmentNames()).toEqual(['Committed']);
    // The row locator matches by title, so find the same row by its new name.
    await (await segmentation.segmentRow('Committed')).focus();
    await page.keyboard.press('p');
    expect(await paint.getAttribute('class')).toContain('tool-btn-selected');
  });

  test('names segment actions and exposes keyboard selection and measurement disclosure', async ({
    page,
    volview,
    annotation,
    segmentation,
  }) => {
    const { centerX, centerY } = await annotation.setupTest();
    await volview.activateRectangle();
    await segmentation.openAnnotationSegments();
    await annotation.clickAt(centerX - 40, centerY - 40);
    await annotation.clickAt(centerX + 40, centerY + 40);

    const row = await segmentation.segmentRow('Segment 1');
    const expander = page.locator('[data-testid="measurements-section"]');
    const shape = page.locator('[data-testid="segment-shape-row"]').first();
    await expect(shape).toBeVisible();
    await expect(expander).toHaveAccessibleName('Measurements');
    expect(await expander.getAttribute('aria-expanded')).toEqual('true');
    await expander.focus();
    await page.keyboard.press('Enter');
    await expect(shape).not.toBeAttached();
    expect(await expander.getAttribute('aria-expanded')).toEqual('false');
    await page.keyboard.press('Space');
    await expect(shape).toBeVisible();
    expect(await expander.getAttribute('aria-expanded')).toEqual('true');

    const create = page.locator('[data-testid="segment-list"] .create-row');
    await expect(create).toHaveRole('button');
    await expect(create).toHaveAccessibleName('New segment');
    await create.focus();
    await page.keyboard.press('Enter');
    expect(await segmentation.segmentNames()).toEqual([
      'Segment 1',
      'Segment 2',
    ]);
    const second = await segmentation.segmentRow('Segment 2');
    await second.focus();
    await page.keyboard.press('Enter');
    expect(await segmentation.selectedSegmentName()).toEqual('Segment 2');
    expect(await second.getAttribute('aria-current')).toEqual('true');
    expect(await row.getAttribute('aria-current')).toBeNull();
    await row.focus();
    await page.keyboard.press('Space');
    expect(await segmentation.selectedSegmentName()).toEqual('Segment 1');
    expect(await row.getAttribute('aria-current')).toEqual('true');
    expect(await second.getAttribute('aria-current')).toBeNull();

    await segmentation.renameSegment('Segment 1', 'Lesion');
    const controls = [
      ['segment-color-button', 'Change color for Lesion'],
      ['reveal-segment-button', 'Reveal slice for Lesion'],
      ['edit-segment-button', 'Edit Lesion'],
      ['delete-segment-button', 'Delete Lesion from this image'],
      ['save-segments-button', 'Save segments'],
    ];
    for (const [testId, label] of controls) {
      await expect(
        page.locator(`[data-testid="${testId}"]`).first()
      ).toHaveAccessibleName(label);
    }
    // The row locator matches by title, so find the same row by its new name.
    const lesion = await segmentation.segmentRow('Lesion');
    // One button whichever icon it shows.
    const hide = lesion.locator(
      'button:has(i.mdi-eye), button:has(i.mdi-eye-off)'
    );
    await expect(hide).toHaveAccessibleName('Hide Lesion');
    await hide.focus();
    await page.keyboard.press('Enter');
    await expect(hide).toHaveAccessibleName('Show Lesion');
    await page.keyboard.press('Space');
    await expect(hide).toHaveAccessibleName('Hide Lesion');
    await segmentation.lockSegment('Lesion');
    await expect(lesion.locator('button:has(i.mdi-lock)')).toHaveAccessibleName(
      'Unlock Lesion'
    );
    expect(
      await lesion.locator('[data-testid="edit-segment-button"]').isEnabled()
    ).toBe(false);
  });
});

test.describe('Reveal Slice on a segment', () => {
  test('jumps the view back to a slice the segment covers', async ({
    volview,
    utils,
    segmentation,
  }) => {
    await utils.openUrls([PROSTATEX_DATASET]);

    await volview.focusFirst2DView();
    await expect
      .poll(volview.getFirst2DSlice, {
        message: 'Slice overlay never appeared',
      })
      .not.toBeUndefined();
    const paintedSlice = await volview.getFirst2DSlice();

    await volview.activatePaint();
    await volview.paintStrokeOnView(volview.views2D.first());

    await segmentation.openAnnotationSegments();
    await segmentation.waitForNamedSegments();
    expect(await segmentation.segmentNames()).toEqual(['Segment 1']);

    // Scroll away so revealing has somewhere to jump back from.
    await volview.selectTool('mdi-cursor-default');
    await volview.focusFirst2DView();
    await volview.advanceSliceAndWait();
    await volview.advanceSliceAndWait();
    expect(await volview.getFirst2DSlice()).not.toEqual(paintedSlice);

    await segmentation.revealSegment('Segment 1');

    await expect
      .poll(volview.getFirst2DSlice, {
        message: `Expected the view to return to slice ${paintedSlice}`,
      })
      .toBe(paintedSlice);
  });
});
