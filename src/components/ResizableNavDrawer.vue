<script>
import { VNavigationDrawer } from 'vuetify/lib/components';

export const RESIZE_CURSOR = 'ew-resize';

/**
 * Events: onResize(width:Number)
 */
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

  beforeUnmount() {
    this.clearEvents();
    this.stopResize();
  },

  render(h) {
    // forwards slots, scoped slots, and more to v-navigation-drawer
    return h(
      VNavigationDrawer,
      {
        ...this.$attrs,
        width: this.internalWidth,
        ref: 'infoPane',
      },
      this.$slots.default
    );
  },

  methods: {
    setResizableStyles() {
      // manual styling
      const el = this.$refs.infoPane.$el.querySelector(
        '.v-navigation-drawer__border'
      );

      // NOTE: width is not reactive to handle size
      el.style.width = this.handleSizeCSS;
      el.style.backgroundColor = 'transparent';
      el.style.touchAction = 'none';
      // NOTE: dynamically setting "right" won't update the border position
      if ('right' in this.$attrs) {
        el.style.borderLeft = '2px solid rgba(0, 0, 0, 0.24)';
      } else {
        el.style.borderRight = '2px solid rgba(0, 0, 0, 0.24)';
      }
      el.style.cursor = RESIZE_CURSOR;
    },

    setEvents() {
      this.drawerBorder = this.$refs.infoPane.$el.querySelector(
        '.v-navigation-drawer__border'
      );
      this.drawerBorder.addEventListener('pointerdown', this.startResize);
      this.drawerBorder.addEventListener('pointermove', this.handleResize);
      this.drawerBorder.addEventListener('pointerup', this.stopResize);
    },

    clearEvents() {
      this.drawerBorder.removeEventListener('pointerdown', this.startResize);
      this.drawerBorder.removeEventListener('pointermove', this.handleResize);
      this.drawerBorder.removeEventListener('pointerup', this.stopResize);
    },

    startResize(ev) {
      if (this.drawerBorder.hasPointerCapture(ev.pointerId)) return;
      this.drawerBorder.setPointerCapture(ev.pointerId);

      this.$refs.infoPane.$el.style.transition = 'initial';

      this.setCursor(RESIZE_CURSOR);
      this.disableSelection();
    },

    stopResize(ev) {
      if (ev) {
        if (!this.drawerBorder.hasPointerCapture(ev.pointerId)) return;
        this.drawerBorder.releasePointerCapture(ev.pointerId);
      }

      this.$refs.infoPane.$el.style.transition = '';

      this.resetCursor();
      this.resetSelection();
    },

    handleResize(evt) {
      if (!this.drawerBorder.hasPointerCapture(evt.pointerId)) return;

      const width =
        'right' in this.$attrs
          ? document.body.scrollWidth - evt.clientX
          : evt.clientX;

      const min = this.minWidth || this.handleSize;
      const max = this.maxWidth || Infinity;
      this.internalWidth = Math.min(max, Math.max(min, width));

      this.$emit('resize', this.internalWidth);
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
