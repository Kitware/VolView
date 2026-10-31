import { setValueVueInput } from '../pageobjects/volview.page';
import { getEnFaceWindow, openEnFaceWindowInputs } from './octTestUtils';

export async function requestEnFaceWindow(
  width: number,
  level: number,
  view?: WebdriverIO.Element
) {
  const inputs = await openEnFaceWindowInputs(view);
  await setValueVueInput(inputs[1], String(level));
  await setValueVueInput(inputs[0], String(width));
  // Leave the width field so the shared controls display the committed value.
  await inputs[1].click();
  await browser.keys('Escape');
  await inputs[0].waitForDisplayed({ reverse: true });
  return getEnFaceWindow(view);
}

type ObservedProjection = HTMLElement & {
  finishRedrawObservation?: () => string[];
};

export async function observeProjectionRedraw(view: WebdriverIO.Element) {
  await view.execute((element) => {
    const root = element as ObservedProjection;
    const history = new Set<string>();
    const inspectNode = (node: Node) => {
      if (
        node instanceof Element &&
        (node.matches('.loading-indicator') ||
          node.querySelector('.loading-indicator'))
      )
        history.add('progress indicator');
    };
    const inspectRecords = (records: MutationRecord[]) => {
      if (root.getAttribute('aria-busy') === 'true') history.add('aria-busy');
      if (root.querySelector('.loading-indicator'))
        history.add('progress indicator');
      for (const record of records) {
        if (record.attributeName === 'aria-busy' && record.oldValue === 'true')
          history.add('aria-busy');
        record.addedNodes.forEach(inspectNode);
        record.removedNodes.forEach(inspectNode);
      }
    };
    const observer = new MutationObserver(inspectRecords);
    inspectRecords([]);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-busy', 'class'],
      attributeOldValue: true,
    });
    root.finishRedrawObservation = () => {
      inspectRecords(observer.takeRecords());
      observer.disconnect();
      return [...history];
    };
  });
}

export async function expectNoRedrawInterruption(view: WebdriverIO.Element) {
  const history = await view.execute((element) => {
    const root = element as ObservedProjection;
    const observed = root.finishRedrawObservation!();
    delete root.finishRedrawObservation;
    return observed;
  });
  expect(history).toEqual([]);
}
