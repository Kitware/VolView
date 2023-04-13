<script lang="ts">
import { inject, defineComponent, toRefs } from 'vue';
import { ItemGroupProvider, ItemGroupProviderValue } from './ItemGroup.vue';

export default defineComponent({
  props: {
    value: {
      type: null,
      required: true,
    },
  },
  setup(props, { slots }) {
    const { value } = toRefs(props);
    const itemGroup = inject<ItemGroupProviderValue>(ItemGroupProvider);

    if (!itemGroup) {
      throw new Error('GroupableItem needs ItemGroup!');
    }

    const select = () => {
      itemGroup.selectItem(value.value);
    };

    const toggle = () => {
      if (!itemGroup) {
        return;
      }

      itemGroup.selectItem(
        itemGroup.isSelected(value.value) ? undefined : value.value
      );
    };

    return () =>
      slots.default?.({
        active: itemGroup.isSelected(value.value),
        select,
        toggle,
      });
  },
});
</script>
