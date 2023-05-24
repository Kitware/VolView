<script lang="ts">
import {
  defineComponent,
  onMounted,
  PropType,
  provide,
  ref,
  toRefs,
  watch,
} from 'vue';

type EqualsTestFunc<T> = (a: T, b: T) => boolean;

export const ItemGroupProvider = Symbol('ItemGroup');

export interface ItemGroupProviderValue {
  selectItem: (item: unknown) => void;
  isSelected: (item: unknown) => boolean;
}

export default defineComponent({
  props: {
    modelValue: null,
    mandatory: Boolean,
    equalsTest: Function as PropType<EqualsTestFunc<any>>,
  },
  setup(props, { emit, slots }) {
    const { modelValue, mandatory, equalsTest } = toRefs(props);
    const internalValue = ref<unknown>();

    watch(modelValue, (v) => {
      if (v !== internalValue.value) {
        internalValue.value = v;
      }
    });

    onMounted(() => {
      internalValue.value = modelValue.value;
    });

    const selectItem = (item: unknown) => {
      if (mandatory.value && !item) {
        return;
      }
      internalValue.value = item;
      emit('update:modelValue', internalValue.value);
    };

    const isSelected = (item: unknown) => {
      if (internalValue.value == null) {
        return false;
      }

      return equalsTest.value
        ? equalsTest.value(item, internalValue.value)
        : item === internalValue.value;
    };

    provide<ItemGroupProviderValue>(ItemGroupProvider, {
      selectItem,
      isSelected,
    });

    return () => slots.default?.();
  },
});
</script>
