import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '@/src/__tests__/sourceAudit';

const exists = (rel: string) => fs.existsSync(path.resolve(repoRoot, rel));
const read = (rel: string) =>
  fs.readFileSync(path.resolve(repoRoot, rel), 'utf-8');

const VISIBLE_ATTRIBUTES = [
  'label',
  'title',
  'placeholder',
  'hint',
  'text',
  'subtitle',
  'aria-label',
  'create-text',
  'reorder-hint',
];

/**
 * The literal text a single-file component puts on screen: static text nodes
 * plus unbound user-facing attributes. Script, style, comments, tags,
 * attribute-bound expressions and `{{ }}` interpolations are all dropped, so an
 * internal identifier never counts as panel language.
 */
function visibleText(source: string) {
  const markup = source
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const attributes = VISIBLE_ATTRIBUTES.flatMap((name) =>
    [...markup.matchAll(new RegExp(`(^|\\s)${name}="([^"]*)"`, 'g'))].map(
      (match) => match[2]
    )
  );

  const text = markup
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/<[^>]*>/g, ' ');

  return [...attributes, text].join('\n');
}

const bannedIn = (rel: string, banned: RegExp) =>
  visibleText(read(rel))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => banned.test(line));

/**
 * Notification and error titles are panel language too, and they live in the
 * script block where `visibleText` cannot see them.
 */
const MESSAGE_CALL =
  /(?:useErrorMessage|addError|addWarning|addSuccess|new Error)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

const bannedMessagesIn = (rel: string, banned: RegExp) =>
  [...read(rel).matchAll(MESSAGE_CALL)]
    .map((match) => match[2])
    .filter((message) => banned.test(message));

const SEGMENTATION_PANEL = [
  'src/components/AnnotationsModule.vue',
  'src/segmentation/components/SegmentList.vue',
  'src/segmentation/components/SegmentEditor.vue',
  'src/segmentation/components/PaintControls.vue',
  'src/segmentation/components/SaveSegmentationDialog.vue',
];

const componentFiles = (dir: string): string[] =>
  fs
    .readdirSync(path.resolve(repoRoot, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) return componentFiles(rel);
      return entry.name.endsWith('.vue') ? [rel] : [];
    });

describe('panel language', () => {
  it('keeps the segmentation panel free of group and storage words', () => {
    expect(SEGMENTATION_PANEL.filter((rel) => !exists(rel))).toEqual([]);

    const banned = /segment group|labelmap|label value|layer/i;
    const hits = SEGMENTATION_PANEL.flatMap((rel) =>
      bannedIn(rel, banned).map((line) => `${rel}: ${line}`)
    );

    expect(hits).toEqual([]);
  });

  it("keeps the panel's notification titles free of storage words", () => {
    const files = SEGMENTATION_PANEL;
    // The panel reports at least one failure to the user, so the scan reads
    // something rather than passing on an empty match set.
    const messages = files.flatMap((rel) => bannedMessagesIn(rel, /.*/));
    expect(messages.length).toBeGreaterThan(0);

    const banned = /segment group|labelmap|label value/i;
    const hits = files.flatMap((rel) =>
      bannedMessagesIn(rel, banned).map((message) => `${rel}: ${message}`)
    );

    expect(hits).toEqual([]);
  });

  it('says "segment group" nowhere a user can read it', () => {
    // "Layer" is a separate VolView feature and keeps its name; the storage
    // words do not survive anywhere in the component tree.
    const banned = /segment group|labelmap|label value/i;
    const hits = [
      ...componentFiles('src/components'),
      ...componentFiles('src/segmentation'),
    ].flatMap((rel) => bannedIn(rel, banned).map((line) => `${rel}: ${line}`));

    expect(hits).toEqual([]);
  });
});
