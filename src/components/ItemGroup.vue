<script>
/**
 * This is meant as a smaller, more specific version of
 * vuetify's v-item-group + v-item.
 */
export default {
  name: 'ItemGroup',
  model: {
    prop: 'value',
    event: 'change',
  },
  provide() {
    return {
      group: {
        selectItem: this.selectItem,
        isSelected: this.isSelected,
      },
    };
  },
  data() {
    return {
      value: null,
    };
  },
  render(h) {
    return h('div', null, this.$scopedSlots.default());
  },
  methods: {
    selectItem(itemValue) {
      this.value = itemValue;
      this.$emit('change', itemValue);
    },
    isSelected(valueToTest) {
      if (this.value === null || this.value === undefined) {
        return false;
      }
      return valueToTest === this.value;
    },
  },
};
</script>
