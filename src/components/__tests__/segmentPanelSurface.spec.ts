import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';

import SegmentList from '@/src/components/SegmentList.vue';
import {
  type Index3,
  seatImage as seatFixtureImage,
  store,
} from '@/src/store/__tests__/segmentMaskFixtures';
import { useViewStore } from '@/src/store/views';

// ---------------------------------------------------------------------------
// The segmentation panel after the group controls are deleted.
//
// Saving the image's segmentation to a file is real functionality and outlives
// its old host, so the flat list carries it: one affordance, scoped to the
// viewed image, and absent when that image has nothing to save. Creating a
// "group", renaming one, and converting an image from a second menu all go with
// the component, because a segment is added by the list's own create chip and
// the dataset browser already converts an image.
//
// Phase 2's exit condition is on user-visible text: no panel says "segment
// group", "labelmap", "label value" or "layer". Identifiers are out of scope,
// so the scan reads text nodes and the static attributes a user actually reads,
// never template expressions or component names.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 2];

const seatImage = async (id: string, name = 'CT') => {
  await seatFixtureImage(id, { name, dimensions: DIMENSIONS });
  return id;
};

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const ChipListStub = defineComponent({
  name: 'EditableChipList',
  props: ['items', 'itemKey', 'itemTitle', 'modelValue', 'createLabelText'],
  emits: ['update:model-value', 'create'],
  template: `
    <div class="chip-list">
      <div v-for="item in items" :key="item.id" class="chip-row" :data-id="item.id">
        <slot name="item-prepend" :key="item.id" :item="item" />
        <slot name="item-append" :key="item.id" :item="item" />
      </div>
    </div>
  `,
});

const BtnStub = defineComponent({
  name: 'VBtn',
  props: ['icon'],
  template: `<button :data-icon="icon"><slot name="prepend" /><slot /></button>`,
});

const SaveDialogStub = defineComponent({
  name: 'SaveSegmentGroupDialog',
  props: ['id'],
  emits: ['done'],
  template: `<div class="save-dialog-body" />`,
});

// Either dialog host works: the slot renders unless the host is explicitly
// closed, so a `v-model`-gated host and an inner `v-if` both read correctly.
const DialogHostStub = (name: string) =>
  defineComponent({
    name,
    props: ['modelValue', 'maxWidth'],
    emits: ['update:modelValue'],
    template: `<div v-if="modelValue !== false" class="dialog-host"><slot :close="() => $emit('update:modelValue', false)" /></div>`,
  });

const globalOptions = {
  stubs: {
    EditableChipList: ChipListStub,
    SegmentEditor: { template: '<div class="segment-editor" />' },
    SaveSegmentGroupDialog: SaveDialogStub,
    IsolatedDialog: DialogHostStub('IsolatedDialog'),
    CloseableDialog: DialogHostStub('CloseableDialog'),
    VDialog: DialogHostStub('VDialog'),
    ColorDot: { props: ['color'], template: '<span class="color-dot" />' },
    VBtn: BtnStub,
    VIcon: { template: '<i class="icon"><slot /></i>' },
    VTooltip: { template: '<span />' },
    VMenu: {
      template: '<div><slot name="activator" :props="{}" /><slot /></div>',
    },
    VList: { template: '<div><slot /></div>' },
    VListItem: { template: '<div><slot /></div>' },
    VSpacer: { template: '<span />' },
    VDivider: { template: '<hr />' },
  },
};

const mountList = () => mount(SegmentList, { global: globalOptions });

const saveButton = (wrapper: VueWrapper) =>
  wrapper.find('[data-testid="save-segments-button"]');

const saveDialog = (wrapper: VueWrapper) =>
  wrapper.findComponent(SaveDialogStub);

describe('saving from the flat segment panel', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await seatImage('img-2', 'MR');
    await viewImage('img-1');
  });

  it('offers no save affordance for an image with no segmentation', async () => {
    const wrapper = mountList();
    await nextTick();

    expect(saveButton(wrapper).exists()).toBe(false);
  });

  it('offers one save affordance once the viewed image has segments', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createSegment(segmentation.id, { name: 'Tumor' });
    const wrapper = mountList();
    await nextTick();

    expect(
      wrapper.findAll('[data-testid="save-segments-button"]')
    ).toHaveLength(1);
  });

  it('opens the save dialog on the viewed image segmentation', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createSegment(segmentation.id, { name: 'Tumor' });
    const wrapper = mountList();
    await nextTick();

    expect(saveDialog(wrapper).exists()).toBe(false);
    expect(saveButton(wrapper).exists()).toBe(true);

    await saveButton(wrapper).trigger('click');
    await nextTick();

    expect(saveDialog(wrapper).props('id')).toBe(segmentation.id);
  });

  it('follows the viewed image rather than the active segment', async () => {
    const first = store().ensureSegmentationForImage('img-1');
    store().createSegment(first.id, { name: 'Tumor' });
    const second = store().ensureSegmentationForImage('img-2');
    const onSecond = store().createSegment(second.id, { name: 'Node' });
    // The active segment lives on the image that is NOT being viewed.
    store().setActiveSegment(onSecond.id);
    const wrapper = mountList();
    await nextTick();

    expect(saveButton(wrapper).exists()).toBe(true);
    await saveButton(wrapper).trigger('click');
    await nextTick();

    expect(saveDialog(wrapper).props('id')).toBe(first.id);
  });
});

// --- Phase 2 exit condition: user-visible panel text --- //

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

const exists = (rel: string) => fs.existsSync(path.resolve(repoRoot, rel));
const read = (rel: string) =>
  fs.readFileSync(path.resolve(repoRoot, rel), 'utf-8');

/** Attributes Vuetify and plain HTML render as text the user reads. */
const VISIBLE_ATTRIBUTES = [
  'label',
  'title',
  'placeholder',
  'hint',
  'text',
  'subtitle',
  'aria-label',
  'create-label-text',
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

/** The segmentation panel: the tab, the list, the editors, the save dialog. */
const SEGMENTATION_PANEL = [
  'src/components/AnnotationsModule.vue',
  'src/components/SegmentList.vue',
  'src/components/SegmentEditor.vue',
  'src/components/PaintControls.vue',
  'src/components/SaveSegmentGroupDialog.vue',
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
    // The two the phase is built around must be present, so the scan is never
    // vacuous; a renamed save dialog simply drops out of the list.
    expect(exists('src/components/AnnotationsModule.vue')).toBe(true);
    expect(exists('src/components/SegmentList.vue')).toBe(true);

    const banned = /segment group|labelmap|label value|layer/i;
    const hits = SEGMENTATION_PANEL.filter(exists).flatMap((rel) =>
      bannedIn(rel, banned).map((line) => `${rel}: ${line}`)
    );

    expect(hits).toEqual([]);
  });

  it('keeps the panel’s notification titles free of storage words', () => {
    const files = SEGMENTATION_PANEL.filter(exists);
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
    const hits = componentFiles('src/components').flatMap((rel) =>
      bannedIn(rel, banned).map((line) => `${rel}: ${line}`)
    );

    expect(hits).toEqual([]);
  });
});
