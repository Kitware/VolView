import { test, expect } from '../fixtures';
import type { ViewLayoutUtils } from './viewLayoutTestUtils';

const waitForEveryPaneToShow = (layout: ViewLayoutUtils, name: string) =>
  expect
    .poll(
      async () => {
        const texts = await layout.panes.allTextContents();
        return texts.length > 0 && texts.every((text) => text.includes(name));
      },
      { message: `Expected every pane to show ${name}` }
    )
    .toBe(true);

const sessionOf = (image: string, layoutFields: Record<string, unknown>) => ({
  dataSources: [{ id: 0, type: 'uri', uri: `/tmp/${image}`, name: image }],
  datasets: [{ id: '0', dataSourceId: 0 }],
  ...layoutFields,
});

const axialView = (id: string) => ({
  id,
  type: '2D',
  name: 'Axial',
  dataID: '0',
  options: { orientation: 'Axial' },
});

test.describe('Restoring a session whose layout cannot be restored', () => {
  test('shows the restored image in the panes it keeps', async ({
    volview,
    utils,
    layout,
  }) => {
    const current = utils.writeMetaImage('rejected-layout-current.mha');
    const restored = utils.writeMetaImage('rejected-layout-restored.mha', {
      step: 3,
    });
    const session = await utils.writeManifestToFile(
      sessionOf(restored, {
        version: '9.0.0',
        // A view shown in two panes is not a layout VolView can restore.
        layout: {
          direction: 'row',
          items: [
            { type: 'view', viewId: 'saved' },
            { type: 'view', viewId: 'saved' },
          ],
        },
        activeView: 'saved',
        viewByID: { saved: axialView('saved') },
      }),
      'rejected-layout.volview.json'
    );

    await volview.open(`?urls=[tmp/${current}]`);
    await volview.waitForViews();
    await waitForEveryPaneToShow(layout, current);

    await utils.openThroughDialog(session);
    await waitForEveryPaneToShow(layout, restored);
  });

  test('opens an 8.0.0 session whose layout names a slot it never saved', async ({
    volview,
    utils,
    layout,
  }) => {
    const image = utils.writeMetaImage('unslotted-layout.mha');
    const session = 'unslotted-layout.volview.json';
    await utils.writeManifestToFile(
      sessionOf(image, {
        version: '8.0.0',
        layout: { direction: 'row', items: [{ type: 'slot', slotIndex: 0 }] },
        viewByID: { axial: axialView('axial') },
      }),
      session
    );

    await volview.open(`?urls=[tmp/${session}]`);
    await volview.waitForViews();
    await waitForEveryPaneToShow(layout, image);
  });
});
