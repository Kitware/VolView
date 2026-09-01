import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useViewStore } from '@/src/store/views';
import { ManifestSchema } from '@/src/io/state-file/schema';

// ---------------------------------------------------------------------------
// Config labels are declared once for a session, before any image is loaded.
// They are templates, not segments: viewing an image must not mint segments and
// must not take over the active segment, because only the one edit entry point
// creates segments. A template becomes a segment on the first edit that uses
// it, and a second config replaces the first config's untouched templates.
// ---------------------------------------------------------------------------

const store = () => useSegmentationStore();

const seatImage = (id: string) =>
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id,
  });

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const seatAndView = async (id: string) => {
  seatImage(id);
  await viewImage(id);
};

const segmentNames = (imageId: string) => {
  const segmentation = store().getSegmentationForImage(imageId);
  if (!segmentation) return [];
  return segmentation.order.map((id) => segmentation.segments[id].name);
};

const labelNames = (labels: Record<string, { labelName?: string }>) =>
  Object.values(labels).map((label) => label.labelName);

const labelIdNamed = (
  labels: Record<string, { labelName?: string }>,
  name: string
) => {
  const found = Object.entries(labels).find(
    ([, label]) => label.labelName === name
  );
  if (!found) throw new Error(`No label named "${name}"`);
  return found[0];
};

describe('config labels seed nothing on their own', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('creates no segment when the configured image is viewed', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });

    await seatAndView('img-1');

    expect(segmentNames('img-1')).toEqual([]);
  });

  it('creates no segment on any image the user views', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });

    await seatAndView('img-1');
    await seatAndView('img-2');

    expect(store().getSegmentationForImage('img-1')?.order ?? []).toEqual([]);
    expect(store().getSegmentationForImage('img-2')?.order ?? []).toEqual([]);
  });

  it('activates nothing when the configured image is viewed', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });

    await seatAndView('img-1');

    expect(polygons.activeLabel).toBeUndefined();
    expect(store().activeSegmentId).toBeUndefined();
  });

  it('leaves the user’s active segment alone when a config arrives', async () => {
    await seatAndView('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const segment = store().createSegment(segmentation.id, { name: 'Mine' });
    const polygons = usePolygonStore();
    polygons.setActiveSegment(segment.id);

    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });
    await nextTick();

    expect(polygons.activeLabel).toBe(segment.id);
    expect(segmentNames('img-1')).toEqual(['Mine']);
  });

  it('offers a configured label on the viewed image without minting it', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });

    await seatAndView('img-1');

    expect(labelNames(polygons.labels)).toEqual(['Tumor']);
    expect(Object.values(polygons.labels)[0].color).toBe('#00ff00');
    expect(segmentNames('img-1')).toEqual([]);
  });

  it('offers the configured labels on every image the user views', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });

    await seatAndView('img-1');
    await seatAndView('img-2');

    expect(labelNames(polygons.labels)).toEqual(['Tumor']);
    expect(segmentNames('img-2')).toEqual([]);
  });
});

describe('a config label becomes a segment on the first edit', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatAndView('img-1');
  });

  it('materializes the selected template with its configured name and color', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });
    await nextTick();
    polygons.setActiveLabel(labelIdNamed(polygons.labels, 'Tumor'));

    const resolved = store().resolveEditTarget('img-1');

    expect(store().getSegment(resolved).name).toBe('Tumor');
    expect(store().getSegment(resolved).color).toEqual([0, 255, 0, 255]);
    expect(segmentNames('img-1')).toEqual(['Tumor']);
  });

  it('materializes the template once, not once per edit', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });
    await nextTick();
    polygons.setActiveLabel(labelIdNamed(polygons.labels, 'Tumor'));

    const first = store().resolveEditTarget('img-1');
    const second = store().resolveEditTarget('img-1');

    expect(second).toBe(first);
    expect(store().activeSegmentId).toBe(first);
    expect(segmentNames('img-1')).toEqual(['Tumor']);
  });

  // The props follow the template only onto what the template became; picking
  // another segment abandons the template rather than restyling that segment.
  it('leaves a segment picked instead of the template with its own props', async () => {
    const rectangles = useRectangleStore();
    rectangles.mergeLabels({
      Tumor: { color: '#00ff00', fillColor: '#00ff0033' },
    });
    await nextTick();
    const segmentation = store().ensureSegmentationForImage('img-1');
    const mine = store().createSegment(segmentation.id, { name: 'Mine' });
    rectangles.setActiveLabel(labelIdNamed(rectangles.labels, 'Tumor'));

    rectangles.setActiveLabel(mine.id);

    expect(rectangles.labels[mine.id].fillColor).toBe('transparent');
  });

  it('leaves the other configured templates unmaterialized', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({
      Tumor: { color: '#00ff00' },
      Node: { color: '#ff0000' },
    });
    await nextTick();
    polygons.setActiveLabel(labelIdNamed(polygons.labels, 'Tumor'));

    store().resolveEditTarget('img-1');

    expect(segmentNames('img-1')).toEqual(['Tumor']);
    expect(labelNames(polygons.labels)).toEqual(['Tumor', 'Node']);
  });
});

describe('a template the first edit already materialized', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    seatImage('img-1');
    seatImage('img-2');
    await viewImage('img-1');
  });

  const materializeTumorOnImage1 = async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });
    await nextTick();
    polygons.setActiveLabel(labelIdNamed(polygons.labels, 'Tumor'));
    store().resolveEditTarget('img-1');
    return polygons;
  };

  it('is not reported selected on an image it has no segment on', async () => {
    const polygons = await materializeTumorOnImage1();

    await viewImage('img-2');

    expect(polygons.activeLabel).toBeUndefined();
    const toolId = polygons.addTool({ imageID: 'img-2', placing: false });
    expect(polygons.toolByID[toolId].label).toBeFalsy();
  });

  it('keeps its landed segment when the template is picked again', async () => {
    const polygons = await materializeTumorOnImage1();

    // The template is offered again where no segment holds its name yet.
    await viewImage('img-2');
    polygons.setActiveLabel(labelIdNamed(polygons.labels, 'Tumor'));
    await viewImage('img-1');
    store().resolveEditTarget('img-1');

    expect(segmentNames('img-1')).toEqual(['Tumor']);
  });

  // The clone carries the configured props because it inherits them from the
  // segment the template became, not from the template the intent has dropped.
  it('carries the configured per-tool props onto a cross-image clone', async () => {
    const rectangles = useRectangleStore();
    rectangles.mergeLabels({
      Tumor: { color: '#00ff00', fillColor: '#00ff0033' },
    });
    await nextTick();
    rectangles.setActiveLabel(labelIdNamed(rectangles.labels, 'Tumor'));
    const onImage1 = store().resolveEditTarget('img-1');

    const onImage2 = store().resolveEditTarget('img-2');

    expect(onImage2).not.toBe(onImage1);
    expect(rectangles.allLabels[onImage2]).toMatchObject({
      labelName: 'Tumor',
      color: '#00ff00',
      fillColor: '#00ff0033',
    });
  });

  it('carries a user’s own props onto a cross-image clone', async () => {
    const rectangles = useRectangleStore();
    const segmentation = store().ensureSegmentationForImage('img-1');
    const mine = store().createSegment(segmentation.id, { name: 'Mine' });
    rectangles.updateLabel(mine.id, { fillColor: '#ff000033' });
    rectangles.setActiveSegment(mine.id);

    const onImage2 = store().resolveEditTarget('img-2');

    expect(rectangles.allLabels[onImage2]).toMatchObject({
      labelName: 'Mine',
      fillColor: '#ff000033',
    });
  });
});

describe('a second config replaces the first', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatAndView('img-1');
  });

  it('drops the first config’s untouched templates', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });
    await nextTick();

    polygons.clearDefaultLabels();
    polygons.mergeLabels({ Node: { color: '#ff0000' } });
    await nextTick();

    expect(labelNames(polygons.labels)).toEqual(['Node']);
    expect(segmentNames('img-1')).toEqual([]);
  });

  it('does not mint a replaced template on the next edit', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });
    await nextTick();
    polygons.setActiveLabel(labelIdNamed(polygons.labels, 'Tumor'));

    polygons.clearDefaultLabels();
    polygons.mergeLabels({ Node: { color: '#ff0000' } });
    await nextTick();
    const resolved = store().resolveEditTarget('img-1');

    expect(store().getSegment(resolved).name).toBe('Segment 1');
  });

  it('keeps a segment the first config’s template already became', async () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });
    await nextTick();
    polygons.setActiveLabel(labelIdNamed(polygons.labels, 'Tumor'));
    store().resolveEditTarget('img-1');

    polygons.clearDefaultLabels();
    polygons.mergeLabels({ Node: { color: '#ff0000' } });
    await nextTick();

    expect(segmentNames('img-1')).toEqual(['Tumor']);
    expect(labelNames(polygons.labels)).toEqual(['Tumor', 'Node']);
  });
});

// ---------------------------------------------------------------------------
// A template is not a segment, so nothing on the segmentation carries it. An
// annotation labeled with one must still come back labeled, which means the
// template travels in the tool's own manifest entry and its synthetic id
// survives the restore instead of being remapped to nothing.
// ---------------------------------------------------------------------------
describe('an annotation labeled with an unmaterialized template', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatAndView('img-1');
  });

  const throughManifest = (serialized: unknown) => {
    const manifest = ManifestSchema.parse({
      version: '7.0.0',
      dataSources: [],
      tools: { rectangles: JSON.parse(JSON.stringify(serialized)) },
    });
    return manifest.tools?.rectangles;
  };

  const placeTumorRectangle = async () => {
    const rectangles = useRectangleStore();
    rectangles.mergeLabels({
      Tumor: { color: '#00ff00', fillColor: '#00ff0033' },
    });
    await nextTick();
    const template = labelIdNamed(rectangles.labels, 'Tumor');
    rectangles.setActiveLabel(template);
    rectangles.addTool({ imageID: 'img-1', placing: false, label: template });
    return { rectangles, template };
  };

  const restore = async (saved: ReturnType<typeof throughManifest>) => {
    setActivePinia(createPinia());
    await seatAndView('img-1');
    const rectangles = useRectangleStore();
    rectangles.deserializeTools(saved, { 'img-1': 'img-1' });
    return rectangles;
  };

  it('shows the template’s name and color before anything is saved', async () => {
    const { rectangles } = await placeTumorRectangle();

    const tool = rectangles.toolByID[rectangles.toolIDs[0]];
    expect(tool.labelName).toBe('Tumor');
    expect(tool.color).toBe('#00ff00');
    expect(tool.fillColor).toBe('#00ff0033');
  });

  it('comes back labeled with the same template', async () => {
    const { rectangles, template } = await placeTumorRectangle();

    const restored = await restore(
      throughManifest(rectangles.serializeTools())
    );

    const tool = restored.toolByID[restored.toolIDs[0]];
    expect(tool.label).toBe(template);
    expect(tool.labelName).toBe('Tumor');
    expect(tool.fillColor).toBe('#00ff0033');
  });

  it('mints no segment on restore', async () => {
    const { rectangles } = await placeTumorRectangle();

    await restore(throughManifest(rectangles.serializeTools()));

    expect(segmentNames('img-1')).toEqual([]);
  });

  it('offers the restored template in the picker', async () => {
    const { rectangles } = await placeTumorRectangle();

    const restored = await restore(
      throughManifest(rectangles.serializeTools())
    );

    expect(labelNames(restored.labels)).toEqual(['Tumor']);
  });

  it('lands unlabeled when the saved entry carries no template', async () => {
    const { rectangles } = await placeTumorRectangle();
    const saved = throughManifest(rectangles.serializeTools());

    const restored = await restore({ ...saved!, templates: undefined });

    expect(restored.toolByID[restored.toolIDs[0]].label).toBe('');
  });
});
