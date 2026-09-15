import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '@/src/__tests__/sourceAudit';
import { setActivePinia, createPinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';

import SegmentList from '@/src/segmentation/components/SegmentList.vue';
import {
  seatSpecImage as seatImage,
  store,
  mintSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useViewStore } from '@/src/store/views';

// ---------------------------------------------------------------------------
// The segmentation panel is one flat list scoped to the viewed image. Saving
// that image's segmentation to a file lives on the list, and is absent when the
// image has nothing to save.
//
// Phase 2's exit condition is on user-visible text: no panel says "segment
// group", "labelmap", "label value" or "layer". Identifiers are out of scope,
// so the scan reads text nodes and the static attributes a user actually reads,
// never template expressions or component names.
// ---------------------------------------------------------------------------

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const ItemListStub = defineComponent({
  name: 'EditableItemList',
  props: ['items', 'itemKey', 'itemTitle', 'modelValue', 'createText'],
  emits: ['update:model-value', 'create'],
  template: `
    <div class="item-list">
      <div v-for="item in items" :key="item.id" class="item-row" :data-id="item.id">
        <slot name="item-prepend" :key="item.id" :item="item" />
        <slot name="item-append" :key="item.id" :item="item" />
      </div>
    </div>
  `,
});

const BtnStub = defineComponent({
  name: 'VBtn',
  props: ['icon', 'disabled'],
  template: `<button :data-icon="icon" :disabled="disabled || undefined"><slot name="prepend" /><slot /></button>`,
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
    EditableItemList: ItemListStub,
    SegmentEditor: { template: '<div class="segment-editor" />' },
    SaveSegmentGroupDialog: SaveDialogStub,
    IsolatedDialog: DialogHostStub('IsolatedDialog'),
    CloseableDialog: DialogHostStub('CloseableDialog'),
    VDialog: DialogHostStub('VDialog'),
    VBtn: BtnStub,
    VIcon: { template: '<i class="icon"><slot /></i>' },
    VTooltip: { template: '<span class="tooltip"><slot /></span>' },
    VMenu: {
      template: '<div><slot name="activator" :props="{}" /><slot /></div>',
    },
    VList: { template: '<div><slot /></div>' },
    VListItem: { template: '<div><slot /></div>' },
    VSpacer: { template: '<span />' },
    VSlider: { props: ['label', 'modelValue'], template: '<input />' },
    VExpansionPanels: { template: '<div><slot /></div>' },
    VExpansionPanel: { template: '<div><slot /></div>' },
    VExpansionPanelTitle: { template: '<button><slot /></button>' },
    VExpansionPanelText: { template: '<div><slot /></div>' },
    VDivider: { template: '<hr />' },
  },
};

const mountList = () =>
  mount(SegmentList, {
    props: {
      registry: useSegmentStore().segments,
      noun: 'segment',
      masked: true,
    },
    global: globalOptions,
  });

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

  it('offers the save affordance disabled, saying why, until something is painted', async () => {
    const wrapper = mountList();
    await nextTick();

    expect(saveButton(wrapper).exists()).toBe(true);
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Nothing is painted on this image yet');
  });

  it('offers one save affordance once the viewed image has segments', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createMask(segmentation.id, mintSegment({ name: 'Tumor' }));
    const wrapper = mountList();
    await nextTick();

    expect(
      wrapper.findAll('[data-testid="save-segments-button"]')
    ).toHaveLength(1);
  });

  it('opens the save dialog on the viewed image segmentation', async () => {
    const segmentation = store().ensureSegmentationForImage('img-1');
    store().createMask(segmentation.id, mintSegment({ name: 'Tumor' }));
    const wrapper = mountList();
    await nextTick();

    expect(saveDialog(wrapper).exists()).toBe(false);
    expect(saveButton(wrapper).exists()).toBe(true);

    await saveButton(wrapper).trigger('click');
    await nextTick();

    expect(saveDialog(wrapper).props('id')).toBe(segmentation.id);
  });

  // The create affordance names the row it adds, and it reads as an expression
  // rather than a literal attribute, so the source scan below cannot see it.
  it('names what the create affordance adds without a storage word', async () => {
    const wrapper = mountList();
    await nextTick();

    expect(wrapper.findComponent(ItemListStub).props('createText')).toBe(
      'New segment'
    );
  });

  it('follows the viewed image rather than the selected type', async () => {
    const first = store().ensureSegmentationForImage('img-1');
    store().createMask(first.id, mintSegment({ name: 'Tumor' }));
    const second = store().ensureSegmentationForImage('img-2');
    const onSecond = store().createMask(
      second.id,
      mintSegment({ name: 'Node' })
    );
    // The selected type has its mask on the image that is NOT being viewed.
    useSegmentStore().segments.selectSegment(onSecond.segmentId);
    const wrapper = mountList();
    await nextTick();

    expect(saveButton(wrapper).exists()).toBe(true);
    await saveButton(wrapper).trigger('click');
    await nextTick();

    expect(saveDialog(wrapper).props('id')).toBe(first.id);
  });
});

// --- Phase 2 exit condition: user-visible panel text --- //

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
  'create-text',
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
  'src/segmentation/components/SegmentList.vue',
  'src/segmentation/components/SegmentEditor.vue',
  'src/segmentation/components/PaintControls.vue',
  'src/segmentation/components/SaveSegmentGroupDialog.vue',
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
    expect(exists('src/segmentation/components/SegmentList.vue')).toBe(true);

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
    const hits = [
      ...componentFiles('src/components'),
      ...componentFiles('src/segmentation'),
    ].flatMap((rel) => bannedIn(rel, banned).map((line) => `${rel}: ${line}`));

    expect(hits).toEqual([]);
  });
});
