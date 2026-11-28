import { expect, type Locator, type Page } from '@playwright/test';
import type { Scratch } from '../scratch';
import { createOctUtils } from './octTestUtils';

export const createSlabContrastUtils = (page: Page, scratch: Scratch) => {
  const oct = createOctUtils(page, scratch);

  const requestEnFaceWindow = async (
    width: number,
    level: number,
    view?: Locator
  ) => {
    const inputs = await oct.enterEnFaceWindow(width, level, view);
    // Leave the width field so the shared controls display the committed value.
    await inputs[1].click();
    await page.keyboard.press('Escape');
    await expect(inputs[0]).toBeHidden();
    return oct.getEnFaceWindow(view);
  };

  return { requestEnFaceWindow };
};

export type SlabContrastUtils = ReturnType<typeof createSlabContrastUtils>;

type ObservedProjection = HTMLElement & {
  finishRedrawObservation?: () => string[];
};

export const observeProjectionRedraw = (view: Locator) =>
  view.evaluate((element) => {
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

export const expectNoRedrawInterruption = async (view: Locator) => {
  const history = await view.evaluate((element) => {
    const root = element as ObservedProjection;
    const observed = root.finishRedrawObservation!();
    delete root.finishRedrawObservation;
    return observed;
  });
  expect(history).toEqual([]);
};
