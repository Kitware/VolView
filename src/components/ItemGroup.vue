<script>
/**
 * This is meant as a smaller, more specific version of
 * vuetify's v-item-group + v-item.
 */
export default {
  name: 'ItemGroup',
  provide() {
    return {
      group: {
        selectItem: this.selectItem,
        isSelected: this.isSelected,
      },
    };
  },
  props: ['value'],
  model: {
    prop: 'value',
    event: 'change',
  },
  data() {
    return {
      internalValue: null,
    };
  },
  watch: {
    value(v) {
      this.internalValue = v;
    },
  },
  mounted() {
    this.internalValue = this.value;
  },
  render(h) {
    return h('div', null, this.$slots.default);
  },
  methods: {
    selectItem(itemValue) {
      this.internalValue = itemValue;
      this.$emit('change', this.internalValue);
    },
    isSelected(valueToTest) {
      if (this.internalValue === null || this.internalValue === undefined) {
        return false;
      }
      return valueToTest === this.internalValue;
    },
  },
};
</script>
