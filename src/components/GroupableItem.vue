<script>
export default {
  name: 'GroupableItem',
  inject: ['group'],
  props: {
    value: { required: true },
  },
  render() {
    const nodes = this.$scopedSlots.default({
      active: this.group.isSelected(this.value),
      select: this.select,
      toggle: this.toggle,
    });
    // always return first node, if any.
    return nodes[0];
  },
  methods: {
    select() {
      this.group.selectItem(this.value);
    },
    toggle() {
      if (this.group.isSelected(this.value)) {
        this.group.selectItem(null);
      } else {
        this.group.selectItem(this.value);
      }
    },
  },
};
</script>
