import { Maybe, UnwrapAll } from '@/src/types';
import { ref } from 'vue';
import { TOOL_COLORS } from '@/src/config';
import { useIdStore } from '../id';

const labelDefault = Object.freeze({
  labelName: 'New Label' as string,
  color: TOOL_COLORS[0] as string,
});

export type Label<Props> = Partial<Props & typeof labelDefault>;
export type Labels<Props> = Record<string, Label<Props>>;

type LabelID = string;

// param newLabelDefault should contain all label controlled props
// of the tool so placing tool does hold any last active label props.
export const useLabels = <Props>(newLabelDefault: Props) => {
  type ToolLabel = Label<Props>;
  type ToolLabels = Labels<Props>;

  const labels = ref<ToolLabels>({});

  const activeLabel = ref<string | undefined>();
  const setActiveLabel = (id: string | undefined) => {
    activeLabel.value = id;
  };

  let nextToolColorIndex = 0;

  const createLabel = (label: ToolLabel, activate: boolean) => {
    const id = useIdStore().nextId();
    labels.value[id] = {
      ...labelDefault,
      ...newLabelDefault,
      color: TOOL_COLORS[nextToolColorIndex],
      ...label,
    };

    nextToolColorIndex = (nextToolColorIndex + 1) % TOOL_COLORS.length;

    if (activate) setActiveLabel(id);
    return id;
  };

  const addLabel = (label: ToolLabel = {}) => createLabel(label, true);

  const deleteLabel = (id: LabelID) => {
    if (!(id in labels.value)) throw new Error('Label does not exist');

    delete labels.value[id];
    labels.value = { ...labels.value }; // trigger reactive update for measurement list

    // pick another active label if deleted was active
    if (id === activeLabel.value) {
      const labelIDs = Object.keys(labels.value);
      if (labelIDs.length !== 0) setActiveLabel(labelIDs[0]);
      else setActiveLabel('');
    }
  };

  const updateLabel = (id: LabelID, patch: ToolLabel) => {
    if (!(id in labels.value)) throw new Error('Label does not exist');

    labels.value = { ...labels.value, [id]: { ...labels.value[id], ...patch } };
  };

  const replaceLabel = (id: LabelID, label: ToolLabel) => {
    if (!(id in labels.value)) throw new Error('Label does not exist');
    labels.value = { ...labels.value, [id]: label };
  };

  // Flag to indicate if should clear existing labels
  const defaultLabels = ref(true);

  const clearDefaultLabels = () => {
    if (defaultLabels.value) labels.value = {};
    defaultLabels.value = false;
  };

  const findLabel = (name: Maybe<string>) => {
    return Object.entries(labels.value).find(
      ([, { labelName }]) => name === labelName
    );
  };

  /*
   * If input label has the same name as existing label, update existing label with input label properties.
   *
   * param label: label to merge
   * param clearDefault: if true, clear initial labels, do nothing if initial labels already cleared
   */
  const mergeLabelWithSelection = (label: ToolLabel, activate: boolean) => {
    const { labelName } = label;
    const matchingName = findLabel(labelName);

    if (matchingName) {
      const [existingID] = matchingName;
      updateLabel(existingID, label);
      return existingID;
    }

    return createLabel(label, activate);
  };

  const mergeLabel = (label: ToolLabel) => mergeLabelWithSelection(label, true);

  const mergeLabelWithoutSelection = (label: ToolLabel) =>
    mergeLabelWithSelection(label, false);

  /*
   * If input label has the same name as existing label, update existing label with input label properties.
   *
   * param newLabels: each key is the label name
   * param clearDefault: if true, clear initial labels, do nothing if initial labels already cleared
   */
  const mergeLabels = (newLabels: Maybe<ToolLabels>) => {
    Object.entries(newLabels ?? {}).forEach(([labelName, props]) =>
      mergeLabel({ ...props, labelName })
    );
  };

  return {
    labels,
    activeLabel,
    setActiveLabel,
    addLabel,
    deleteLabel,
    updateLabel,
    replaceLabel,
    mergeLabel,
    mergeLabelWithoutSelection,
    mergeLabels,
    findLabel,
    clearDefaultLabels,
  };
};

export type LabelsStore<Tool> = UnwrapAll<ReturnType<typeof useLabels<Tool>>>;
