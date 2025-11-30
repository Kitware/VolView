import AppPage from '../pageobjects/volview.page';

describe('Paint tool rendering', () => {
  it('should not black out axial view after painting', async () => {
    await AppPage.open();
    await AppPage.downloadProstateSample();
    await AppPage.waitForViews();

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
  });
});
