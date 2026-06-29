import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { PaintMode } from '@/src/core/tools/paint';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { usePaintProcessStore } from '@/src/store/tools/paintProcess';

function makeLabelMap(values: Uint8Array) {
  const labelMap = vtkLabelMap.newInstance();
  labelMap.setDimensions([values.length, 1, 1]);
  labelMap.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values,
    })
  );
  labelMap.computeTransforms();
  return labelMap;
}

function getScalars(labelMap: vtkLabelMap) {
  return Array.from(labelMap.getPointData().getScalars().getData());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function addTestSegmentGroup(values = new Uint8Array([0, 0])) {
  const segmentGroupStore = useSegmentGroupStore();
  const labelMap = makeLabelMap(values);
  const groupId = segmentGroupStore.addLabelmap(labelMap, {
    name: 'Test group',
    parentImage: 'image-1',
    segments: {
      order: [1],
      byValue: {
        1: {
          value: 1,
          name: 'Segment 1',
          color: [255, 0, 0, 255],
          visible: true,
          locked: false,
        },
      },
    },
  });

  return { groupId, labelMap };
}

describe('Paint process store', () => {
  beforeEach(() => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  it('opens process controls without changing the paint interaction mode', () => {
    const paintStore = usePaintToolStore();

    paintStore.setMode(PaintMode.Erase);
    paintStore.setProcessControlsOpen(true);

    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.Erase);
    expect(paintStore.activePaintMode).toBe(PaintMode.Erase);
    expect(paintStore.isPaintingModeActive).toBe(true);
  });

  it('uses process interaction mode only while previewing', async () => {
    const paintStore = usePaintToolStore();
    const processStore = usePaintProcessStore();
    const { groupId, labelMap } = addTestSegmentGroup();

    paintStore.setMode(PaintMode.Erase);
    paintStore.activeSegmentGroupID = groupId;
    paintStore.activeSegment = 1;

    expect(paintStore.processControlsOpen).toBe(false);

    await processStore.startProcess(
      groupId,
      async () => new Uint8Array([2, 2])
    );

    expect(processStore.processState.step).toBe('previewing');
    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.Process);
    expect(paintStore.activePaintMode).toBe(PaintMode.Erase);
    expect(paintStore.isPaintingModeActive).toBe(false);
    expect(getScalars(labelMap)).toEqual([2, 2]);

    processStore.confirmProcess();

    expect(processStore.processState.step).toBe('start');
    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.Erase);
    expect(paintStore.activePaintMode).toBe(PaintMode.Erase);
    expect(paintStore.isPaintingModeActive).toBe(true);
  });

  it('restores the paint interaction mode when preview is canceled', async () => {
    const paintStore = usePaintToolStore();
    const processStore = usePaintProcessStore();
    const { groupId, labelMap } = addTestSegmentGroup();

    paintStore.setMode(PaintMode.CirclePaint);
    paintStore.setProcessControlsOpen(true);
    paintStore.activeSegmentGroupID = groupId;
    paintStore.activeSegment = 1;

    await processStore.startProcess(
      groupId,
      async () => new Uint8Array([3, 3])
    );

    processStore.cancelProcess();

    expect(processStore.processState.step).toBe('start');
    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.CirclePaint);
    expect(paintStore.activePaintMode).toBe(PaintMode.CirclePaint);
    expect(paintStore.isPaintingModeActive).toBe(true);
    expect(getScalars(labelMap)).toEqual([0, 0]);
  });

  it('ignores stale async results after a newer process starts', async () => {
    const paintStore = usePaintToolStore();
    const { groupId, labelMap } = addTestSegmentGroup();

    paintStore.activeSegmentGroupID = groupId;
    paintStore.activeSegment = 1;
    paintStore.activeMode = PaintMode.Process;
    const processStore = usePaintProcessStore();

    const first = deferred<Uint8Array>();
    const second = deferred<Uint8Array>();
    const firstRun = processStore.startProcess(groupId, () => first.promise);
    const secondRun = processStore.startProcess(groupId, () => second.promise);

    first.resolve(new Uint8Array([9, 9]));
    await firstRun;

    expect(processStore.processState.step).toBe('computing');
    expect(getScalars(labelMap)).toEqual([0, 0]);

    second.resolve(new Uint8Array([2, 2]));
    await secondRun;

    expect(processStore.processState.step).toBe('previewing');
    expect(getScalars(labelMap)).toEqual([2, 2]);
  });
});
