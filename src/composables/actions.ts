import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';
import { useRectangleStore } from '../store/tools/rectangles';
import { useRulerStore } from '../store/tools/rulers';
import { usePolygonStore } from '../store/tools/polygons';
import { useViewStore } from '../store/views';
import { Action, NOOP } from '../constants';
import { useKeyboardShortcutsStore } from '../store/keyboard-shortcuts';
import { useCurrentImage } from './useCurrentImage';
import { useSliceConfig } from './useSliceConfig';
import { useDatasetStore } from '../store/datasets';

const applyLabelOffset = (offset: number) => () => {
  const toolToStore = {
    [Tools.Rectangle]: useRectangleStore(),
    [Tools.Ruler]: useRulerStore(),
    [Tools.Polygon]: usePolygonStore(),
  };
  const toolStore = useToolStore();

  // @ts-ignore - toolToStore may not have keys of all tools
  const activeToolStore = toolToStore[toolStore.currentTool];
  if (!activeToolStore) return;

  const labels = Object.entries(activeToolStore.labels);
  const activeLabelIndex = labels.findIndex(
    ([name]) => name === activeToolStore.activeLabel
  );

  const [nextLabel] = labels.at((activeLabelIndex + offset) % labels.length)!;
  activeToolStore.setActiveLabel(nextLabel);
};

const setTool = (tool: Tools) => () => {
  useToolStore().setCurrentTool(tool);
};

const showKeyboardShortcuts = () => {
  const keyboardStore = useKeyboardShortcutsStore();
  keyboardStore.settingsOpen = !keyboardStore.settingsOpen;
};

const changeSlice = (offset: number) => () => {
  const { currentImageID } = useCurrentImage();
  const { activeViewID } = useViewStore();

  const { slice: currentSlice } = useSliceConfig(activeViewID, currentImageID);
  currentSlice.value += offset;
};

const clearScene = () => () => {
  const datasetStore = useDatasetStore();
  datasetStore.removeAll();
};

const deleteCurrentImage = () => () => {
  const datasetStore = useDatasetStore();
  datasetStore.remove(datasetStore.primaryImageID);

  // Automatically select next image
  datasetStore.setPrimarySelection(datasetStore.idsAsSelections[0]);
};

export const ACTION_TO_FUNC = {
  windowLevel: setTool(Tools.WindowLevel),
  pan: setTool(Tools.Pan),
  zoom: setTool(Tools.Zoom),
  ruler: setTool(Tools.Ruler),
  paint: setTool(Tools.Paint),
  brushSize: NOOP, // act as modifier key rather than immediate effect, so no-op
  rectangle: setTool(Tools.Rectangle),
  crosshairs: setTool(Tools.Crosshairs),
  temporaryCrosshairs: NOOP, // behavior implemented elsewhere
  crop: setTool(Tools.Crop),
  polygon: setTool(Tools.Polygon),
  select: setTool(Tools.Select),

  nextSlice: changeSlice(1),
  previousSlice: changeSlice(-1),
  grabSlice: NOOP, // acts as a modifier key rather than immediate effect, so no-op

  decrementLabel: applyLabelOffset(-1),
  incrementLabel: applyLabelOffset(1),

  deleteCurrentImage: deleteCurrentImage(),
  clearScene: clearScene(),

  mergeNewPolygon: NOOP, // acts as a modifier key rather than immediate effect, so no-op

  showKeyboardShortcuts,
} as const satisfies Record<Action, () => void>;
