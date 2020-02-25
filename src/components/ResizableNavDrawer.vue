<script>
import { VNavigationDrawer } from 'vuetify/lib';

export const RESIZE_CURSOR = 'ew-resize';

export default {
  name: 'ResizableNavDrawer',
  props: {
    minWidth: Number,
    maxWidth: Number,
    width: Number,
    handleSize: {
      type: Number,
      default: 4,
    },
  },

  data() {
    return {
      internalWidth: this.width,
    };
  },

  computed: {
    handleSizeCSS() {
      return `${this.handleSize}px`;
    },
  },

  mounted() {
    this.oldCursor = '';
    this.oldUserSelect = '';

    this.setResizableStyles();
    this.setEvents();
  },

  beforeDestroy() {
    this.clearEvents();
    this.stopResize();
  },

  render(h) {
    // forwards slots, scoped slots, and more to v-navigation-drawer
    return h(
      VNavigationDrawer,
      {
        props: {
          // this.$attrs is the non-prop attrs we receive, which should
          // be forwarded to v-navigation-drawer
          ...this.$attrs,
          width: this.internalWidth,
        },
        on: this.$listeners,
        scopedSlots: this.$scopedSlots,
        ref: 'infoPane',
      },
      this.$slots.default,
    );
  },

  methods: {
    setResizableStyles() {
      // manual styling
      const el = this.$refs.infoPane.$el.querySelector('.v-navigation-drawer__border');

      // NOTE: width is not reactive to handle size
      el.style.width = this.handleSizeCSS;
      el.style.backgroundColor = 'transparent';
      // NOTE: dynamically setting "right" won't update the border position
      if ('right' in this.$attrs) {
        el.style.borderLeft = '2px solid rgba(0, 0, 0, 0.24)';
      } else {
        el.style.borderRight = '2px solid rgba(0, 0, 0, 0.24)';
      }
      el.style.cursor = RESIZE_CURSOR;
    },

    setEvents() {
      const el = this.$refs.infoPane.$el.querySelector('.v-navigation-drawer__border');
      el.addEventListener('mousedown', this.startResize);
    },

    clearEvents() {
      const el = this.$refs.infoPane.$el.querySelector('.v-navigation-drawer__border');
      el.removeEventListener('mousedown', this.startResize);
      document.removeEventListener('mouseup', this.stopResize);
    },

    startResize() {
      this.$refs.infoPane.$el.style.transition = 'initial';

      this.setCursor(RESIZE_CURSOR);
      this.disableSelection();
      document.addEventListener('mousemove', this.handleResize);
      document.addEventListener('mouseup', this.stopResize);
    },

    stopResize() {
      this.$refs.infoPane.$el.style.transition = '';

      this.resetCursor();
      this.resetSelection();
      document.removeEventListener('mousemove', this.handleResize);
    },

    handleResize(evt) {
      const width = 'right' in this.$attrs
        ? document.body.scrollWidth - evt.clientX
        : evt.clientX;

      const min = this.minWidth || this.handleSize;
      const max = this.maxWidth || Infinity;
      this.internalWidth = Math.min(max, Math.max(min, width));
    },

    setCursor(cursor) {
      this.oldCursor = document.body.style.cursor;
      document.body.style.cursor = cursor;
    },

    resetCursor() {
      document.body.style.cursor = this.oldCursor;
      this.oldCursor = '';
    },

    disableSelection() {
      this.oldUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
    },

    resetSelection() {
      document.body.style.userSelect = this.oldUserSelect;
      this.oldUserSelect = '';
    },
  },
};
</script>
