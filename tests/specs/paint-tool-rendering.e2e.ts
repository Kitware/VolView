import AppPage from '../pageobjects/volview.page';
import { PROSTATEX_DATASET } from '../datasets';
import { openUrls } from './utils';
import { moveTo } from './annotationTestUtils';

describe('Paint tool rendering', () => {
  it('should not black out axial view after painting', async () => {
    await openUrls([PROSTATEX_DATASET]);

    const views2D = await AppPage.getViews2D();
    const axialView = views2D[0];

    await AppPage.activatePaint();

    const canvas = await axialView.$('canvas');
    const location = await canvas.getLocation();
    const size = await canvas.getSize();

    const centerX = location.x + size.width / 2;
    const centerY = location.y + size.height / 2;

    await browser
      .action('pointer')
      .move({ x: Math.round(centerX), y: Math.round(centerY) })
      .down()
      .move({ x: Math.round(centerX + 50), y: Math.round(centerY + 30) })
      .up()
      .perform();

    for (let i = 0; i < 5; i++) {
      await browser
        .action('pointer')
        .move({ x: Math.round(centerX + i * 20), y: Math.round(centerY) })
        .perform();
    }

    await browser.waitUntil(
      async () => {
        const result = await browser.checkElement(
          axialView,
          'paint_tool_axial_view_after_stroke'
        );
        return (result as number) < 5;
      },
      {
        timeout: 10000,
        timeoutMsg:
          'Axial view should not go black after painting with paint tool',
        interval: 1000,
      }
    );

    const canvasImage = () =>
      browser.execute(
        (element) => (element as HTMLCanvasElement).toDataURL(),
        canvas
      );
    const hovered = await canvasImage();
    await moveTo(10, 10);
    await browser.waitUntil(async () => (await canvasImage()) !== hovered, {
      timeoutMsg: 'Brush preview should disappear when leaving the view',
    });
    const withoutPreview = await canvasImage();

    await moveTo(centerX - 60, centerY);
    await browser.waitUntil(
      async () => (await canvasImage()) !== withoutPreview,
      { timeoutMsg: 'Brush preview should appear without painting' }
    );
    const firstPreview = await canvasImage();
    await moveTo(centerX - 30, centerY);
    await browser.waitUntil(
      async () => (await canvasImage()) !== firstPreview,
      { timeoutMsg: 'Brush preview should follow the pointer without painting' }
    );

    await moveTo(10, 10);
    await browser.waitUntil(
      async () => (await canvasImage()) === withoutPreview,
      {
        timeoutMsg:
          'Moving the preview should leave the painted image unchanged',
      }
    );
  });
});
