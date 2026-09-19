import { describe, expect, it } from 'vitest';

import { hits, isTest, read, sourceFiles } from '@/src/__tests__/sourceAudit';

// ---------------------------------------------------------------------------
// Registry order decides the sidebar, shortcuts, picking and flattened export
// precedence. It does not decide what is drawn on top: every segment actor is
// translucent, so vtk.js draws them through an order-independent pass and an
// overlap blends the same whichever segment is first. Nothing user-visible may
// promise otherwise.
// ---------------------------------------------------------------------------

const README = 'src/segmentation/README.md';

/** The body of a `## ` section of a Markdown file. */
const section = (rel: string, heading: string) => {
  const body = read(rel)
    .split(/^## /m)
    .find((part) => part.startsWith(heading));
  expect(body, `${rel} has no "${heading}" section`).toBeDefined();
  return body!.slice(heading.length);
};

// Phrases that tie segment order to drawing order rather than to picking,
// shortcuts or export.
const DEPTH_PROMISE =
  /render(s|ing)?\s+(in front|on top|above|depth)|(in front|on top|above)\s+of\s+(the\s+)?(other|earlier|later|sibling)\s+segments/i;

describe('what registry order is documented to control', () => {
  it('drops rendering depth from the README ordering section', () => {
    const ordering = section(README, 'Ordering and overlap');

    expect(ordering).not.toMatch(DEPTH_PROMISE);
    expect(ordering).not.toMatch(/rendering depth/i);
  });

  it('says overlapping segments blend in the slice view', () => {
    const ordering = section(README, 'Ordering and overlap');

    expect(ordering).toMatch(/blend/i);
  });

  it('keeps the sidebar, picking and export claims the order does keep', () => {
    const ordering = section(README, 'Ordering and overlap');

    expect(ordering).toMatch(/sidebar/i);
    expect(ordering).toMatch(/picking/i);
    expect(ordering).toMatch(/export precedence/i);
  });

  it('promises no drawing order from the reorder control', () => {
    const tooltip = read('src/components/EditableItemList.vue')
      .split('\n')
      .filter((line) => /reorder/i.test(line));

    expect(tooltip.join('\n')).not.toMatch(DEPTH_PROMISE);
  });

  it('promises no drawing order anywhere the user can read it', () => {
    const files = sourceFiles(
      import.meta.url,
      'src/segmentation',
      'src/components'
    ).filter((rel) => !isTest(rel));

    expect(hits(files, DEPTH_PROMISE)).toEqual([]);
  });
});
