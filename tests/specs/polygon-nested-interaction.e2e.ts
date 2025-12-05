import AppPage from '../pageobjects/volview.page';
import { MINIMAL_DICOM } from './configTestUtils';

describe('Polygon tool nested interaction', () => {
  it('should not show first polygon handles when hovering over it while placing second polygon', async () => {
    await AppPage.open(
      `?urls=${MINIMAL_DICOM.url}&names=${MINIMAL_DICOM.name}`
    );
    await AppPage.waitForViews();

    const views2D = await AppPage.getViews2D();
    const axialView = views2D[0];
    const canvas = await axialView.$('canvas');
    const location = await canvas.getLocation();
    const size = await canvas.getSize();

    const centerX = location.x + size.width / 2;
    const centerY = location.y + size.height / 2;

    const polygonButton = await $('button span i[class~=mdi-pentagon-outline]');
    await polygonButton.click();

    // Create first polygon (outer, larger)
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 80), y: Math.round(centerY - 80) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 80), y: Math.round(centerY - 80) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 80), y: Math.round(centerY + 80) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 80), y: Math.round(centerY + 80) })
      .down()
      .up()
      .perform();

    // Close first polygon by clicking first point
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 80), y: Math.round(centerY - 80) })
      .down()
      .up()
      .perform();

    // Verify first polygon has 4 handles
    const firstPolygonHandles = await axialView.$$('svg circle');
    expect(await firstPolygonHandles.length).toBe(4);

    // Start second polygon inside first - place first point
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 40), y: Math.round(centerY - 40) })
      .down()
      .up()
      .perform();

    // Place second point of new polygon
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 40), y: Math.round(centerY - 40) })
      .down()
      .up()
      .perform();

    // Now hover over the FIRST polygon's corner (top-left) to trigger hover handles
    // Bug: This should NOT show handles on first polygon while placing second
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 80), y: Math.round(centerY - 80) })
      .perform();

    // Wait a moment for hover state to update
    await browser.waitUntil(
      async () => {
        const allCircles = await axialView.$$('svg circle');
        // Count visible circles - should only be from placing polygon (2 points)
        // not from first polygon's hover handles
        let visibleCount = 0;
        for (const circle of allCircles) {
          const visibility = await circle.getAttribute('visibility');
          if (visibility !== 'hidden') {
            visibleCount++;
          }
        }
        // Should be 2 (placing polygon points) + 4 (first polygon, but hidden)
        // If bug exists: will be 6+ (first polygon handles become visible on hover)
        return visibleCount <= 2;
      },
      {
        timeout: 3000,
        timeoutMsg:
          'First polygon handles should NOT be visible when hovering while placing second polygon',
      }
    );
  });

  it('should allow right-click to remove points on third polygon inside existing one', async () => {
    await AppPage.open(
      `?urls=${MINIMAL_DICOM.url}&names=${MINIMAL_DICOM.name}`
    );
    await AppPage.waitForViews();

    const views2D = await AppPage.getViews2D();
    const axialView = views2D[0];
    const canvas = await axialView.$('canvas');
    const location = await canvas.getLocation();
    const size = await canvas.getSize();

    const centerX = location.x + size.width / 2;
    const centerY = location.y + size.height / 2;

    const polygonButton = await $('button span i[class~=mdi-pentagon-outline]');
    await polygonButton.click();

    // Create first (outer) polygon
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 100), y: Math.round(centerY - 100) })
      .down()
      .up()
      .perform();
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 100), y: Math.round(centerY - 100) })
      .down()
      .up()
      .perform();
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 100), y: Math.round(centerY + 100) })
      .down()
      .up()
      .perform();
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 100), y: Math.round(centerY + 100) })
      .down()
      .up()
      .perform();
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 100), y: Math.round(centerY - 100) })
      .down()
      .up()
      .perform();

    // Create second polygon inside first, finish it
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 60), y: Math.round(centerY - 60) })
      .down()
      .up()
      .perform();
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 20), y: Math.round(centerY - 60) })
      .down()
      .up()
      .perform();
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 40), y: Math.round(centerY - 20) })
      .down()
      .up()
      .perform();
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 60), y: Math.round(centerY - 60) })
      .down()
      .up()
      .perform();

    // Start third polygon inside first, place 2 points
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 20), y: Math.round(centerY + 20) })
      .down()
      .up()
      .perform();
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 60), y: Math.round(centerY + 20) })
      .down()
      .up()
      .perform();

    const circlesBeforeRightClick = await axialView.$$('svg circle');
    const countBefore = await circlesBeforeRightClick.length;

    // Right-click to remove second point of third polygon
    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 40), y: Math.round(centerY + 40) })
      .down({ button: 2 })
      .up({ button: 2 })
      .perform();

    await browser.waitUntil(
      async () => {
        const circlesAfterRightClick = await axialView.$$('svg circle');
        const countAfter = await circlesAfterRightClick.length;
        return countAfter === countBefore - 1;
      },
      {
        timeout: 5000,
        timeoutMsg:
          'Right-click should remove one point from the third polygon',
      }
    );
  });

  it('should allow right-click to remove points while placing new polygon inside existing one', async () => {
    await AppPage.open(
      `?urls=${MINIMAL_DICOM.url}&names=${MINIMAL_DICOM.name}`
    );
    await AppPage.waitForViews();

    const views2D = await AppPage.getViews2D();
    const axialView = views2D[0];
    const canvas = await axialView.$('canvas');
    const location = await canvas.getLocation();
    const size = await canvas.getSize();

    const centerX = location.x + size.width / 2;
    const centerY = location.y + size.height / 2;

    const polygonButton = await $('button span i[class~=mdi-pentagon-outline]');
    await polygonButton.click();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 80), y: Math.round(centerY - 80) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 80), y: Math.round(centerY - 80) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 80), y: Math.round(centerY + 80) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 80), y: Math.round(centerY + 80) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 80), y: Math.round(centerY - 80) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX - 40), y: Math.round(centerY - 40) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 40), y: Math.round(centerY - 40) })
      .down()
      .up()
      .perform();

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX + 40), y: Math.round(centerY + 40) })
      .down()
      .up()
      .perform();

    // Count total circles (handles may not be visible when placing)
    const circlesBeforeRightClick = await axialView.$$('svg circle');
    const countBefore = await circlesBeforeRightClick.length;

    // Right-click inside the first polygon to test that placing polygon handles it
    await browser
      .action('pointer')
      .move({
        x: Math.round(centerX),
        y: Math.round(centerY),
      })
      .down({ button: 2 })
      .up({ button: 2 })
      .perform();

    await browser.waitUntil(
      async () => {
        const circlesAfterRightClick = await axialView.$$('svg circle');
        const countAfter = await circlesAfterRightClick.length;
        // Should remove exactly one point
        return countAfter === countBefore - 1;
      },
      {
        timeout: 5000,
        timeoutMsg:
          'Right-click should remove exactly one point from the placing polygon',
      }
    );
  });
});
