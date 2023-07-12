import { Maybe } from '@/src/types';
import { ref } from 'vue';
import { StoreActions, StoreState } from 'pinia';
import { useIdStore } from '../id';

export type Label<Props> = Partial<Props & { labelName: string }>;
export type Labels<Props> = Record<string, Label<Props>>;

type LabelID = string;

const labelDefault = { labelName: 'New Label' };

// param newLabelDefault should contain all label controlled props
// of the tool so placing tool does hold any last active label props.
export const useLabels = <Props>(newLabelDefault: Label<Props>) => {
  type ToolLabel = Label<Props>;

  const labels = ref<Labels<Props>>({});

  const activeLabel = ref<string | undefined>();
  const setActiveLabel = (id: string) => {
    activeLabel.value = id;
  };

  const addLabel = (label: ToolLabel = {}) => {
    const id = useIdStore().nextId();
    labels.value[id] = {
      ...labelDefault,
      ...newLabelDefault,
      ...label,
    };

    setActiveLabel(id);
    return id;
  };

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

  // Flag to indicate if should clear existing labels
  const defaultLabels = ref(true);

  const clearDefaultLabels = () => {
    if (defaultLabels.value) labels.value = {};
    defaultLabels.value = false;
  };

  /*
   * If new label have the same name as existing label, overwrite existing label.
   *
   * param label: label to merge
   * param clearDefault: if true, clear initial labels, do nothing if initial labels already cleared
   */
  const mergeLabel = (label: ToolLabel, clearDefault: boolean = true) => {
    if (clearDefault) clearDefaultLabels();

    const { labelName } = label;
    const sameLabelName = Object.entries(labels.value).find(
      ([, { labelName: existingName }]) => existingName === labelName
    );

    if (sameLabelName) {
      const [existingID] = sameLabelName;
      updateLabel(existingID, label);
      return existingID;
    }

    return addLabel(label);
  };

  /*
   * If new label have the same name as existing label, overwrite existing label.
   *
   * param newLabels: each key is the label name
   * param clearDefault: if true, clear initial labels, do nothing if initial labels already cleared
   */
  const mergeLabels = (
    newLabels: Maybe<Labels<Props>>,
    clearDefault: boolean = true
  ) => {
    Object.entries(newLabels ?? {}).forEach(([labelName, props]) =>
      mergeLabel({ ...props, labelName }, clearDefault)
    );
  };

  return {
    labels,
    activeLabel,
    setActiveLabel,
    addLabel,
    deleteLabel,
    updateLabel,
    mergeLabel,
    mergeLabels,
  };
};

type UseLabels<Tool> = ReturnType<typeof useLabels<Tool>>;

export type LabelsStore<Tool> = StoreState<UseLabels<Tool>> &
  StoreActions<UseLabels<Tool>>;
