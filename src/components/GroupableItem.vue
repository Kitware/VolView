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
    });
    // always return first node, if any.
    return nodes[0];
  },
  methods: {
    select() {
      this.group.selectItem(this.value);
    },
  },
};
</script>
